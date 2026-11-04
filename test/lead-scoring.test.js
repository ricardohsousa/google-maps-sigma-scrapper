const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateScore, classify, DEFAULT_RULES } = require("../lead-scoring/scoring-engine");
const { defaultRules, defaultSettings } = require("../lead-scoring/prospecting-store");
const {
  fallbackSalesAnalysis,
  resolveProviderConfig,
  resolveProviderChain,
  analyzeBatchWithSalesAI,
  extractProviderText,
  testProviderConnection,
} = require("../lead-scoring/ai-sales-analyzer");
const { buildSiteSummary } = require("../lead-scoring/site-summary-builder");

test("website with digital pains ranks higher than no website", () => {
  const commercial = {
    category: "Clinica odontologica",
    phone: "(21) 99999-9999",
    whatsapp: "+5521999999999",
    rating: 4.8,
    reviewCount: 120,
  };

  const brokenSiteLead = {
    company: { ...commercial, name: "Clinica Site Ruim", website: "https://clinica-ruim.example" },
  };
  const brokenSite = {
    hasHttps: false,
    hasOwnDomain: true,
    performance: { loadTimeMs: 6000 },
    content: { title: "Clinica", description: "", h1: "" },
    mobile: { isResponsive: false },
    conversion: { hasWhatsappButton: false, hasForm: false, ctaStrength: "baixa" },
    tracking: {},
    crawl: { httpErrors: [] },
  };

  const noSiteLead = {
    company: { ...commercial, name: "Clinica Sem Site", website: "" },
  };

  const healthyLead = {
    company: { ...commercial, name: "Clinica Ok", website: "https://clinica-ok.example" },
  };
  const healthySite = {
    hasHttps: true,
    hasOwnDomain: true,
    performance: { loadTimeMs: 900 },
    content: { title: "Clinica completa e moderna", description: "Atendimento", h1: "Sorrisos" },
    mobile: { isResponsive: true },
    conversion: { hasWhatsappButton: true, hasForm: true, ctaStrength: "alta" },
    tracking: { metaPixel: true, googleAnalytics: true },
    crawl: { httpErrors: [] },
  };

  const broken = calculateScore(brokenSiteLead, brokenSite);
  const noSite = calculateScore(noSiteLead, {});
  const healthy = calculateScore(healthyLead, healthySite);

  assert.equal(broken.priority, "alta");
  assert.ok(broken.value >= noSite.value, "site com falhas deve pontuar >= sem site");
  assert.equal(noSite.worthProspecting, true);
  assert.ok(noSite.priority === "boa" || noSite.priority === "alta");
  assert.ok(noSite.priority !== "alta" || broken.value >= noSite.value);
  assert.ok(["baixa", "ignorar"].includes(healthy.priority));
  assert.ok(broken.reasons.some((reason) => /pixel|HTTPS|celular|WhatsApp|falhas/i.test(reason)));
  assert.ok(noSite.reasons.some((reason) => reason.includes("sem site")));
});

test("fallback sales analysis returns ready commercial messages", () => {
  const lead = {
    company: {
      name: "Academia Centro",
      category: "Academia",
      phone: "(11) 98888-7777",
      website: "https://example.com",
      rating: 4.6,
      reviewCount: 80,
    },
  };
  const site = {
    hasHttps: true,
    hasOwnDomain: true,
    tracking: {},
    conversion: { hasWhatsappButton: false, hasForm: false },
    content: { title: "Academia", description: "", h1: "" },
    mobile: { isResponsive: true },
  };
  const score = calculateScore(lead, site);
  const analysis = fallbackSalesAnalysis(lead, site, score, {});
  assert.equal(typeof analysis.mensagem_whatsapp, "string");
  assert.ok(analysis.mensagem_whatsapp.includes("Academia Centro"));
  assert.equal(analysis.principais_dores.length, 3);
  assert.equal(analysis.objecoes_provaveis.length, 3);
});

test("AI provider config supports OpenRouter headers and URL", () => {
  const config = resolveProviderConfig({
    provider: "openrouter",
    apiKey: "secret",
    baseUrl: "https://openrouter.ai/api/v1/",
    siteUrl: "https://sigma.local",
    appName: "Sigma Test",
  });
  assert.equal(config.chatCompletionsUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(config.headers["HTTP-Referer"], "https://sigma.local");
  assert.equal(config.headers["X-Title"], "Sigma Test");
});

test("AI provider config supports custom OpenAI-compatible endpoint", () => {
  const config = resolveProviderConfig({
    provider: "custom",
    baseUrl: "http://localhost:11434/v1/chat/completions",
    model: "local-model",
    extraHeaders: "{\"X-Test\":\"ok\"}",
  });
  assert.equal(config.chatCompletionsUrl, "http://localhost:11434/v1/chat/completions");
  assert.equal(config.defaultModel, "local-model");
  assert.equal(config.headers["X-Test"], "ok");
});

test("OpenCode provider uses Zen free endpoint by default", () => {
  const config = resolveProviderConfig({
    provider: "opencode",
    apiKey: "zen-key",
    model: "deepseek-v4-flash",
  });
  assert.equal(config.provider, "opencode");
  assert.equal(config.chatCompletionsUrl, "https://opencode.ai/zen/v1/chat/completions");
  assert.equal(config.model, "deepseek-v4-flash");
  assert.equal(config.apiStyle, "chat-completions");
});

test("OpenCode Muse uses the Responses endpoint required by Zen", () => {
  const config = resolveProviderConfig({
    provider: "opencode",
    apiKey: "zen-key",
    model: "muse-spark-1.3-contributor-free",
  });
  assert.equal(config.apiStyle, "responses");
  assert.equal(config.endpointUrl, "https://opencode.ai/zen/v1/responses");
});

test("fresh scoring settings use OpenRouter free as the real default", () => {
  const settings = defaultSettings();
  assert.equal(settings.ai.provider, "openrouter");
  assert.equal(settings.ai.model, "openrouter/free");
  assert.equal(settings.ai.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(settings.ai.fallbackProviders, "[]");
});

test("NVIDIA Build provider resolves its chat completions endpoint", () => {
  const config = resolveProviderConfig({ provider: "nvidia", apiKey: "nv-key" });
  assert.equal(config.model, "deepseek-ai/deepseek-v4-flash");
  assert.equal(config.apiStyle, "chat-completions");
  assert.equal(config.endpointUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
});

test("default free providers resolve openrouter and opencode chain", () => {
  const chain = resolveProviderChain({
    provider: "openrouter",
    apiKey: "or-key",
    model: "openrouter/free",
    siteUrl: "https://sigma.local",
    fallbackProviders: JSON.stringify([
      {
        provider: "opencode",
        enabled: true,
        apiKey: "zen-key",
        model: "mimo-v2.5-free",
      },
    ]),
  });
  assert.equal(chain.length, 2);
  assert.equal(chain[0].provider, "openrouter");
  assert.equal(chain[1].provider, "opencode");
  assert.match(chain[1].chatCompletionsUrl, /opencode\.ai\/zen/);
});

test("Responses payload text is extracted from OpenCode output", () => {
  assert.equal(extractProviderText({
    output: [{ type: "message", content: [{ type: "output_text", text: '{"leads":[]}' }] }],
  }), '{"leads":[]}');
});

test("connection test sends Muse through Responses schema", async () => {
  const originalFetch = global.fetch;
  let request = null;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const result = await testProviderConnection({
      provider: "opencode",
      apiKey: "zen-key",
      model: "muse-spark-1.3-contributor-free",
      baseUrl: "https://opencode.ai/zen/v1",
    });
    assert.equal(result.endpoint, "https://opencode.ai/zen/v1/responses");
    assert.equal(request.url, result.endpoint);
    assert.equal(request.body.input, "Responda apenas OK.");
    assert.equal(request.body.messages, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenCode free-only rejection becomes an actionable message", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":{"type":"MissingSessionID","message":"OpenCode free tier can only be used in OpenCode"}}',
  });
  try {
    await assert.rejects(
      () => testProviderConnection({ provider: "opencode", apiKey: "zen-key", model: "muse-spark-1.3-contributor-free" }),
      /só funciona dentro do próprio OpenCode.*glm-5\.3-flash/s,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenCode billing rejection distinguishes a valid key without payment", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ type: "error", error: { type: "CreditsError", message: "No payment method." } }),
  });
  try {
    await assert.rejects(
      () => testProviderConnection({ provider: "opencode", apiKey: "zen-key", model: "glm-5.3-flash" }),
      /chave foi reconhecida.*não tem forma de pagamento/i,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("site summary extracts copy, CTA, trust and objection signals", () => {
  const lead = { company: { name: "Clinica Teste", category: "Clinica", reviewCount: 80 } };
  const site = {
    finalUrl: "https://example.com",
    hasHttps: true,
    hasOwnDomain: true,
    tracking: {},
    performance: { loadTimeMs: 1200 },
    mobile: { isResponsive: true },
    content: { title: "Clinica Teste", description: "Atendimento especializado", hasSchema: true },
    conversion: { hasWhatsappButton: true, hasForm: true, ctaStrength: "alta" },
    crawl: {
      pages: [{
        h1: "Tratamento odontologico rapido e seguro",
        title: "Clinica Teste",
        visibleText: "Orcamento gratis pelo WhatsApp. Garantia, parcelamento, anos de experiencia, depoimentos de clientes e prazo claro.",
        buttons: ["Agendar pelo WhatsApp"],
        ctaLinks: ["Fale conosco"],
        paragraphs: ["Atendimento com especialistas e processo simples para reduzir duvidas."],
      }],
    },
  };
  const summary = buildSiteSummary(lead, site);
  assert.ok(summary.conversion.localCopyScore.overall > 50);
  assert.ok(summary.conversion.trustSignals.includes("garantia"));
  assert.ok(summary.conversion.objectionSignals.includes("prazo"));
});

test("provider chain supports fallback providers", () => {
  const chain = resolveProviderChain({
    provider: "openrouter",
    apiKey: "primary",
    siteUrl: "https://sigma.local",
    fallbackProviders: JSON.stringify([
      { provider: "openai", apiKey: "fallback", model: "gpt-4.1-mini" },
    ]),
  });
  assert.equal(chain.length, 2);
  assert.equal(chain[0].provider, "openrouter");
  assert.equal(chain[1].provider, "openai");
});

test("site crawler parses HTML without playwright", () => {
  const { parseHtmlDocument } = require("../lead-scoring/site-crawler");
  const html = `
    <html><head>
      <title>Clinica Teste</title>
      <meta name="description" content="Atendimento odontologico">
      <meta name="viewport" content="width=device-width">
      <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
    </head>
    <body>
      <h1>Clinica Teste</h1>
      <a href="https://wa.me/5521999999999">WhatsApp</a>
      <form action="/contato"></form>
    </body></html>`;
  const parsed = parseHtmlDocument(html, "https://clinica.example");
  assert.equal(parsed.title, "Clinica Teste");
  assert.ok(parsed.whatsappLinks.length >= 1);
  assert.equal(parsed.forms, 1);
  assert.ok(parsed.hasOpenGraph === false);
});

test("prospecting store supports groups and clear analyses", () => {
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const { ProspectingStore } = require("../lead-scoring/prospecting-store");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigma-ls-"));
  const store = new ProspectingStore(dir);
  store.upsert({
    id: "lead_a",
    company: { name: "A", website: "https://a.example" },
    score: { value: 90, priority: "alta" },
  });
  store.upsert({
    id: "lead_b",
    company: { name: "B", website: "https://b.example" },
    score: { value: 70, priority: "boa" },
  });
  const group = store.createGroup({ name: "Alta", leadIds: ["lead_a"] });
  assert.equal(group.count, 1);
  assert.ok(store.get("lead_a").groupIds.includes(group.id));
  assert.equal(store.listGroups().length, 1);
  assert.equal(store.getAll({ groupId: group.id }).length, 1);
  const cleared = store.clearAnalyses({ ids: ["lead_a"] });
  assert.equal(cleared.removed, 1);
  assert.equal(store.get("lead_a"), null);
  const all = store.clearAnalyses({ all: true });
  assert.ok(all.removed >= 1);
  assert.equal(Object.keys(store.leads).length, 0);
});

test("batch AI falls back locally when no provider key exists", async () => {
  const lead = { id: "lead_1", company: { name: "Academia Centro", website: "https://example.com", phone: "123" } };
  const siteAnalysis = {
    finalUrl: "https://example.com",
    hasHttps: true,
    tracking: {},
    conversion: {},
    content: {},
    mobile: {},
    siteSummary: { conversion: { localCopyScore: { overall: 42 } } },
  };
  const score = calculateScore(lead, siteAnalysis);
  const rows = await analyzeBatchWithSalesAI([{ lead, siteAnalysis, score }], { ai: { enabled: true } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawProvider, "fallback");
});

test("unreachable website does not fabricate digital defects", () => {
  const { emptySiteAnalysis } = require("../lead-scoring/site-crawler");
  const lead = {
    company: {
      name: "Clinica Indisponivel",
      category: "Clinica odontologica",
      website: "https://timeout.example",
      phone: "5521999999999",
      rating: 4.8,
      reviewCount: 120,
    },
  };
  const result = calculateScore(lead, emptySiteAnalysis("Timeout"));
  assert.equal(result.components.digitalPain, 0);
  assert.equal(result.components.conversionPotential, 0);
  assert.deepEqual(result.sitePains, []);
  assert.ok(result.reasons.some((reason) => /não respondeu/i.test(reason)));
  assert.ok(result.reasons.every((reason) => !/sem pixel|sem cadeado|celular|formulário visível/i.test(reason)));
});

test("OpenCode settings survive store round-trip", () => {
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const { ProspectingStore } = require("../lead-scoring/prospecting-store");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigma-ls-opencode-"));
  const store = new ProspectingStore(dir);
  const updated = store.updateSettings({
    ai: {
      provider: "opencode",
      model: "deepseek-v4-flash-free",
      baseUrl: "https://opencode.ai/zen/v1",
    },
  });
  assert.equal(updated.ai.provider, "opencode");
  assert.equal(updated.ai.baseUrl, "https://opencode.ai/zen/v1");
  const reloaded = new ProspectingStore(dir).getSettings();
  assert.equal(reloaded.ai.provider, "opencode");
  assert.equal(reloaded.ai.model, "deepseek-v4-flash-free");
  assert.equal(reloaded.ai.baseUrl, "https://opencode.ai/zen/v1");
});

test("AI score is blended exactly once and reasons follow final score", () => {
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const { LeadScoringService } = require("../lead-scoring");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigma-ls-blend-"));
  const service = new LeadScoringService(dir);
  const normalized = {
    id: "lead_blend",
    company: { name: "Lead Blend", category: "Serviços", website: "" },
  };
  const saved = service._saveAnalyzedLead(
    normalized,
    {},
    { value: 20 },
    { score: 100 },
    service.store.getSettings(),
  );
  assert.equal(saved.score.value, 44);
  assert.equal(saved.score.components.baseScore, 20);
  assert.equal(saved.score.components.aiScore, 100);
  assert.ok(saved.score.reasons.every((reason) => !/vale menos a pena/i.test(reason)));
});

test("perfil de rede social como site conta como sem site próprio", () => {
  const company = { name: "Studio Bella", category: "Estética", phone: "(21) 98888-1111", rating: 4.7, reviewCount: 90 };
  const instagramSite = {
    digitalPresence: { kind: "social", platform: "instagram", reachable: null },
    finalUrl: "https://instagram.com/studiobella",
    conversion: {},
    tracking: {},
  };
  const viaInstagram = calculateScore({ company: { ...company, website: "https://instagram.com/studiobella" } }, instagramSite);
  const noSite = calculateScore({ company: { ...company, website: "" } }, {});

  assert.equal(viaInstagram.value, noSite.value);
  assert.ok(viaInstagram.components.digitalPain > 0);
  assert.ok(viaInstagram.reasons.some((reason) => reason.includes("Instagram")));
});

test("fallback de lead sem site não fala de problemas de um site inexistente", () => {
  const lead = {
    company: { name: "Padaria Sol", category: "Padaria", phone: "(11) 97777-0000", website: "", rating: 4.8, reviewCount: 150 },
  };
  const score = calculateScore(lead, {});
  const analysis = fallbackSalesAnalysis(lead, {}, score, {});
  const text = [analysis.mensagem_whatsapp, ...analysis.problemas_encontrados, ...analysis.principais_dores].join(" ");
  assert.ok(analysis.mensagem_whatsapp.includes("Padaria Sol"));
  assert.ok(analysis.mensagem_whatsapp.includes("150 avaliações"));
  assert.doesNotMatch(text, /no site|do site não|o site existe/i);
  assert.equal(analysis.principais_dores.length, 3);
  assert.equal(analysis.objecoes_provaveis.length, 3);
});
