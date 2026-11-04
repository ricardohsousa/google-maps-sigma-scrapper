const { hasOwnWebsite } = require("./scoring-engine");

async function analyzeWithSalesAI(lead, siteAnalysis, score, settings) {
  const ai = settings?.ai || {};
  if (!ai.enabled || !ai.apiKey) {
    return fallbackSalesAnalysis(lead, siteAnalysis, score, settings);
  }
  try {
    const result = await analyzeBatchWithSalesAI([{ lead, siteAnalysis, score }], settings);
    return result[0] || fallbackSalesAnalysis(lead, siteAnalysis, score, settings);
  } catch (e) {
    return fallbackSalesAnalysis(lead, siteAnalysis, score, settings, e.message);
  }
}

async function analyzeBatchWithSalesAI(items, settings) {
  const ai = settings?.ai || {};
  const leads = (items || []).filter(Boolean);
  if (!leads.length) return [];
  if (!ai.enabled || !hasAnyProviderKey(ai)) {
    return leads.map((item) => fallbackSalesAnalysis(item.lead, item.siteAnalysis, item.score, settings));
  }

  const payload = buildBatchPromptPayload(leads, settings);
  const providers = resolveProviderChain(ai);
  let lastError = "";
  for (const providerConfig of providers) {
    try {
      const json = await attemptProvider(providerConfig, payload);
      const parsed = parseJsonResponse(extractProviderText(json));
      const rows = Array.isArray(parsed) ? parsed : parsed.leads || parsed.resultados || [];
      return leads.map((item, index) => {
        const input = rows.find((row) => String(row.leadId || row.id || "") === String(item.lead.id)) || rows[index] || {};
        const normalized = normalizeAiJson(input, item.lead, item.siteAnalysis, item.score);
        normalized.rawProvider = providerConfig.provider;
        normalized.providerModel = providerConfig.model;
        return normalized;
      });
    } catch (e) {
      lastError = `${providerConfig.provider}: ${e.message}`;
      if (!shouldTryNextProvider(e)) break;
    }
  }

  const fallback = leads.map((item) => fallbackSalesAnalysis(item.lead, item.siteAnalysis, item.score, settings, lastError));
  fallback.aiFailed = true;
  fallback.aiError = lastError;
  return fallback;
}

// Endpoints gratuitos e gateways OpenAI-compatíveis costumam recusar
// `response_format` e devolver 5xx em picos. Sem timeout, um provedor pendurado
// travava o lote inteiro sem forma de cancelar.
const REQUEST_TIMEOUT_MS = 45000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestChatCompletion(providerConfig, payload, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const body = {
    model: providerConfig.model || providerConfig.defaultModel,
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content:
          "Voce e um analista CRO e closer B2B. Avalie copy, conversao, prova social e objecoes. Use os dados ja extraidos; nao invente. Retorne apenas JSON valido no schema pedido.",
      },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };
  // Nem todo provedor aceita o modo JSON estrito; ele é opcional e cai no
  // segundo passo quando o provedor recusa.
  if (options.jsonMode !== false) body.response_format = { type: "json_object" };
  try {
    const res = await fetch(providerConfig.chatCompletionsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${providerConfig.apiKey}`,
        ...providerConfig.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      const err = new Error(`IA falhou: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error(`IA não respondeu em ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`);
      timeout.status = 408;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestResponses(providerConfig, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(providerConfig.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${providerConfig.apiKey}`,
        ...providerConfig.headers,
      },
      body: JSON.stringify({
        model: providerConfig.model || providerConfig.defaultModel,
        instructions:
          "Voce e um analista CRO e closer B2B. Avalie copy, conversao, prova social e objecoes. Use os dados ja extraidos; nao invente. Retorne apenas JSON valido no schema pedido.",
        input: JSON.stringify(payload),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      const err = new Error(`IA falhou: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error(`IA não respondeu em ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`);
      timeout.status = 408;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Uma tentativa completa por provedor: modo JSON, depois sem modo JSON (para
 * provedores que recusam `response_format`), com uma repetição em erro
 * temporário. Devolve o JSON ou lança o último erro real.
 */
async function attemptProvider(providerConfig, payload) {
  if (providerConfig.apiStyle === "responses") {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await requestResponses(providerConfig, payload);
      } catch (error) {
        lastError = error;
        if (attempt > 0 || !RETRYABLE_STATUS.has(Number(error?.status || 0))) break;
        await sleep(900);
      }
    }
    throw lastError || new Error("Falha desconhecida na chamada de IA");
  }
  const attempts = [{ jsonMode: true }, { jsonMode: false }, { jsonMode: false, retry: true }];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await requestChatCompletion(providerConfig, payload, attempt);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const isJsonModeRejection = attempt.jsonMode && [400, 404, 415, 422, 500, 501].includes(status);
      if (isJsonModeRejection) continue;
      if (attempt.retry || !RETRYABLE_STATUS.has(status)) break;
      await sleep(900);
    }
  }
  throw lastError || new Error("Falha desconhecida na chamada de IA");
}

async function testProviderConnection(ai = {}) {
  const providerConfig = resolveProviderConfig(ai);
  if (!providerConfig.apiKey) {
    throw new Error("Informe a API key antes de testar a conexão.");
  }

  const send = async (extra = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const isResponses = providerConfig.apiStyle === "responses";
      const body = isResponses
        ? {
            model: providerConfig.model || providerConfig.defaultModel,
            input: "Responda apenas OK.",
            max_output_tokens: 16,
            ...extra,
          }
        : {
            model: providerConfig.model || providerConfig.defaultModel,
            max_tokens: 4,
            temperature: 0,
            messages: [{ role: "user", content: "Responda apenas OK." }],
            ...extra,
          };
      return await fetch(providerConfig.endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${providerConfig.apiKey}`,
          ...providerConfig.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response = await send().catch((error) => {
    if (error?.name === "AbortError") {
      const timeout = new Error("O provedor não respondeu em 30s. Verifique a Base URL e a conexão.");
      timeout.status = 408;
      throw timeout;
    }
    throw new Error(`Não foi possível alcançar o provedor: ${error.message}`);
  });

  // Alguns gateways recusam limite curto. Repetir sem esse limite separa
  // "parâmetro de teste recusado" de indisponibilidade real.
  let firstFailure = "";
  if (!response.ok) {
    firstFailure = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    if ([400, 404, 422, 500, 501, 502, 503, 504].includes(response.status)) {
      response = await send(providerConfig.apiStyle === "responses"
        ? { max_output_tokens: undefined }
        : { max_tokens: undefined }).catch(() => response);
    }
  }

  if (!response.ok) {
    const body = firstFailure || (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    const error = new Error(describeHttpFailure(response.status, body));
    error.status = response.status;
    throw error;
  }

  return {
    provider: providerConfig.provider,
    model: providerConfig.model || providerConfig.defaultModel,
    endpoint: providerConfig.endpointUrl,
  };
}

/** Traduz o erro do provedor para algo acionável em português. */
function describeHttpFailure(status, body = "") {
  const detail = body ? ` Detalhe: ${body}` : "";
  if (/MissingSessionID|free tier can only be used in OpenCode/i.test(body)) {
    return "Este modelo gratuito do OpenCode só funciona dentro do próprio OpenCode. No Sigma, escolha um modelo Zen com créditos (ex.: glm-5.3-flash) ou use uma chave do OpenRouter.";
  }
  if (/CreditsError|No payment method|add a payment method/i.test(body)) {
    return "A chave foi reconhecida, mas o workspace do OpenCode Zen não tem forma de pagamento. Adicione créditos/faturamento no OpenCode ou use uma chave do OpenRouter.";
  }
  if (status === 401 || status === 403) {
    return `Chave recusada (HTTP ${status}). Confira a API key deste provedor.`;
  }
  if (status === 404) {
    return `Rota ou modelo não encontrado (HTTP 404). Confira a Base URL e o nome do modelo.${detail}`;
  }
  if (status === 429) {
    return `Limite de uso atingido (HTTP 429). Aguarde alguns minutos ou use outra chave.${detail}`;
  }
  if (status >= 500) {
    return `O provedor está instável agora (HTTP ${status}). A análise continua com as regras locais até ele voltar.${detail}`;
  }
  return `Conexão recusada: HTTP ${status}.${detail}`;
}

function resolveProviderConfig(ai = {}) {
  const provider = String(ai.provider || "openrouter").toLowerCase();
  const appName = ai.appName || "Sigma GMaps Scraper";
  if (provider === "openrouter") {
    const endpointUrl = joinApiUrl(ai.baseUrl || "https://openrouter.ai/api/v1", "chat/completions");
    return {
      provider,
      apiKey: ai.apiKey || "",
      model: ai.model || "openrouter/free",
      defaultModel: "openrouter/free",
      apiStyle: "chat-completions",
      endpointUrl,
      chatCompletionsUrl: endpointUrl,
      headers: {
        ...(ai.siteUrl ? { "HTTP-Referer": ai.siteUrl } : { "HTTP-Referer": "https://sigma-gmaps.local" }),
        "X-Title": appName,
      },
    };
  }
  if (provider === "opencode") {
    const model = ai.model || "glm-5.3-flash";
    const apiStyle = openCodeApiStyle(model);
    const endpointUrl = joinApiUrl(ai.baseUrl || "https://opencode.ai/zen/v1", apiStyle === "responses" ? "responses" : "chat/completions");
    return {
      provider: "opencode",
      apiKey: ai.apiKey || "",
      model,
      defaultModel: "glm-5.3-flash",
      apiStyle,
      endpointUrl,
      chatCompletionsUrl: endpointUrl,
      headers: {
        ...parseExtraHeaders(ai.extraHeaders),
        "X-Title": appName,
      },
    };
  }
  if (provider === "nvidia") {
    const endpointUrl = joinApiUrl(ai.baseUrl || "https://integrate.api.nvidia.com/v1", "chat/completions");
    return {
      provider: "nvidia",
      apiKey: ai.apiKey || "",
      model: ai.model || "deepseek-ai/deepseek-v4-flash",
      defaultModel: "deepseek-ai/deepseek-v4-flash",
      apiStyle: "chat-completions",
      endpointUrl,
      chatCompletionsUrl: endpointUrl,
      headers: parseExtraHeaders(ai.extraHeaders),
    };
  }
  if (provider === "custom") {
    const endpointUrl = joinApiUrl(ai.baseUrl || "", "chat/completions");
    return {
      provider,
      apiKey: ai.apiKey || "",
      model: ai.model || "gpt-4.1-mini",
      defaultModel: ai.model || "gpt-4.1-mini",
      apiStyle: "chat-completions",
      endpointUrl,
      chatCompletionsUrl: endpointUrl,
      headers: parseExtraHeaders(ai.extraHeaders),
    };
  }
  const endpointUrl = joinApiUrl(ai.baseUrl || "https://api.openai.com/v1", "chat/completions");
  return {
    provider: "openai",
    apiKey: ai.apiKey || "",
    model: ai.model || "gpt-4.1-mini",
    defaultModel: "gpt-4.1-mini",
    apiStyle: "chat-completions",
    endpointUrl,
    chatCompletionsUrl: endpointUrl,
    headers: {},
  };
}

function resolveProviderChain(ai = {}) {
  const primary = resolveProviderConfig(ai);
  const extras = parseProviderFallbacks(ai);
  const chain = [primary, ...extras.map((provider) => resolveProviderConfig({ ...ai, ...provider }))];
  const seen = new Set();
  return chain.filter((provider) => {
    const key = `${provider.provider}|${provider.endpointUrl}|${provider.model}`;
    if (!provider.apiKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseProviderFallbacks(ai = {}) {
  if (Array.isArray(ai.providers)) return ai.providers.filter((item) => item && item.enabled !== false);
  if (!ai.fallbackProviders) return [];
  try {
    const parsed = JSON.parse(ai.fallbackProviders);
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.enabled !== false) : [];
  } catch {
    return [];
  }
}

function hasAnyProviderKey(ai = {}) {
  if (ai.apiKey) return true;
  return parseProviderFallbacks(ai).some((provider) => provider.apiKey);
}

function joinApiUrl(baseUrl, route) {
  const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!clean) throw new Error("Base URL do provedor de IA nao configurada");
  if (/\/(chat\/completions|responses)$/i.test(clean)) {
    return clean.replace(/\/(chat\/completions|responses)$/i, `/${route}`);
  }
  return `${clean}/${route}`;
}

function openCodeApiStyle(model) {
  return /^(muse-|gpt-|grok-)/i.test(String(model || "")) ? "responses" : "chat-completions";
}

function extractProviderText(json = {}) {
  const chat = json?.choices?.[0]?.message?.content;
  if (typeof chat === "string" && chat.trim()) return chat;
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;
  const chunks = [];
  for (const item of Array.isArray(json.output) ? json.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n") || "{}";
}

function parseExtraHeaders(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildPromptPayload(lead, siteAnalysis, score, settings) {
  return {
    tarefa: "Determinar se vale investir tempo tentando vender um novo site, landing page ou sistema.",
    idioma: settings?.analysis?.language || "pt-BR",
    oferta: settings?.analysis?.offerType || "site_landing_sistema",
    empresa: lead.company,
    score_base: score,
    presenca_digital: describePresence(lead.company, siteAnalysis),
    ...(hasOwnWebsite(lead.company, siteAnalysis) ? {} : { regra_sem_site: NO_SITE_RULE }),
    dados_tecnicos_resumidos: {
      url: siteAnalysis.finalUrl,
      cms: siteAnalysis.cms,
      tecnologias: (siteAnalysis.technologies || []).map((t) => t.name),
      frameworks: (siteAnalysis.frameworks || []).map((t) => t.name),
      tracking: siteAnalysis.tracking,
      performance: siteAnalysis.performance,
      conteudo: siteAnalysis.content,
      conversao: siteAnalysis.conversion,
      seo: siteAnalysis.seoBasics,
      paginas: siteAnalysis.crawl?.pagesFound,
      erros: siteAnalysis.crawl?.httpErrors?.length || 0,
      mobile: siteAnalysis.mobile,
    },
    json_obrigatorio: {
      score: "0-100",
      prioridade: "ignorar | baixa | boa | alta",
      vale_prospectar: "boolean",
      chance_resposta: "baixa | media | alta",
      chance_reuniao: "baixa | media | alta",
      ticket_estimado: "baixo | medio | alto",
      grau_de_urgencia: "baixo | medio | alto",
      facilidade_de_convencer: "baixa | media | alta",
      principais_dores: ["", "", ""],
      principais_oportunidades: ["", "", ""],
      resumo: "",
      resumo_empresa: "",
      problemas_encontrados: ["", "", ""],
      argumento_principal_venda: "",
      mensagem_whatsapp: "",
      assunto_email: "",
      primeiro_email: "",
      mensagem_follow_up: "",
      objecoes_provaveis: [{ objecao: "", resposta: "" }],
    },
  };
}

const NO_SITE_RULE = "Quando presenca_digital.tem_site_proprio for false, nao ha site para auditar: ignore os dados tecnicos vazios. Avalie pelo Google Maps (avaliacoes, nota, categoria, cidade) e pelos canais de contato. A oferta e criar um site ou landing page; as mensagens nao podem citar problemas de um site que nao existe. Se a empresa usa so rede social ou pagina de links, cite isso como ponto de partida.";

function describePresence(company = {}, site = {}) {
  const own = hasOwnWebsite(company, site);
  return {
    tem_site_proprio: own,
    tipo: own ? (site.digitalPresence?.kind || "own_domain") : (company.website ? site.digitalPresence?.kind || "perfil" : "sem_site"),
    plataforma: site.digitalPresence?.platform || "",
    link_informado: company.website || "",
    site_respondeu: own ? site.digitalPresence?.reachable === true : null,
  };
}

function buildBatchPromptPayload(items, settings) {
  return {
    tarefa: "Avaliar em lote se cada lead vale prospeccao para vender site, landing page ou sistema.",
    idioma: settings?.analysis?.language || "pt-BR",
    oferta: settings?.analysis?.offerType || "site_landing_sistema",
    regra: "Use os campos siteSummary/conversion.likelyLeaks como insumo principal. Avalie copy real, clareza, CTA, confianca, quebra de objecoes e potencial comercial. Retorne JSON no formato {\"leads\": [...]} mantendo leadId.",
    regra_sem_site: NO_SITE_RULE,
    leads: items.map((item) => ({
      leadId: item.lead.id,
      empresa: item.lead.company,
      score_base: item.score,
      presenca_digital: describePresence(item.lead.company, item.siteAnalysis),
      siteSummary: item.siteAnalysis.siteSummary || {},
      dados_tecnicos_resumidos: {
        url: item.siteAnalysis.finalUrl,
        cms: item.siteAnalysis.cms,
        tecnologias: (item.siteAnalysis.technologies || []).map((t) => t.name),
        tracking: item.siteAnalysis.tracking,
        performance: item.siteAnalysis.performance,
        conteudo: item.siteAnalysis.content,
        conversao: item.siteAnalysis.conversion,
        seo: item.siteAnalysis.seoBasics,
        paginas: item.siteAnalysis.crawl?.pagesFound,
        erros: item.siteAnalysis.crawl?.httpErrors?.length || 0,
        mobile: item.siteAnalysis.mobile,
      },
    })),
    json_obrigatorio_por_lead: {
      leadId: "",
      score: "0-100",
      prioridade: "ignorar | baixa | boa | alta",
      vale_prospectar: "boolean",
      conversionScore: "0-100",
      copyScore: "0-100",
      objectionScore: "0-100",
      trustScore: "0-100",
      principal_vazamento_conversao: "",
      diagnostico_copy: "",
      objecoes_nao_quebradas: ["", "", ""],
      provas_que_faltam: ["", "", ""],
      principais_dores: ["", "", ""],
      principais_oportunidades: ["", "", ""],
      argumento_principal_venda: "",
      mensagem_whatsapp: "",
      assunto_email: "",
      primeiro_email: "",
      mensagem_follow_up: "",
      objecoes_provaveis: [{ objecao: "", resposta: "" }],
      resumo: "",
      resumo_empresa: "",
      problemas_encontrados: ["", "", ""],
      chance_resposta: "baixa | media | alta",
      chance_reuniao: "baixa | media | alta",
      ticket_estimado: "baixo | medio | alto",
      grau_de_urgencia: "baixo | medio | alto",
      facilidade_de_convencer: "baixa | media | alta",
    },
  };
}

function normalizeAiJson(input, lead, siteAnalysis, score) {
  const fb = fallbackSalesAnalysis(lead, siteAnalysis, score, {});
  const out = {
    ...fb,
    ...input,
    score: clamp(input.score ?? score.value),
    prioridade: normalizePriority(input.prioridade || score.priority),
    vale_prospectar: Boolean(input.vale_prospectar ?? score.worthProspecting),
    principais_dores: array3(input.principais_dores, fb.principais_dores),
    principais_oportunidades: array3(input.principais_oportunidades, fb.principais_oportunidades),
    problemas_encontrados: array3(input.problemas_encontrados, fb.problemas_encontrados),
    conversionScore: clamp(input.conversionScore ?? input.conversion_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.overall ?? score.value),
    copyScore: clamp(input.copyScore ?? input.copy_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.heroClarity ?? score.value),
    objectionScore: clamp(input.objectionScore ?? input.objection_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.objectionScore ?? score.value),
    trustScore: clamp(input.trustScore ?? input.trust_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.trustScore ?? score.value),
    principal_vazamento_conversao: input.principal_vazamento_conversao || input.mainLeak || siteAnalysis.siteSummary?.conversion?.likelyLeaks?.[0] || "",
    diagnostico_copy: input.diagnostico_copy || input.copyDiagnosis || "",
    objecoes_nao_quebradas: array3(input.objecoes_nao_quebradas || input.missingObjections, siteAnalysis.siteSummary?.conversion?.likelyLeaks || []),
    provas_que_faltam: array3(input.provas_que_faltam || input.missingProof, fb.principais_oportunidades),
    objecoes_provaveis: Array.isArray(input.objecoes_provaveis) && input.objecoes_provaveis.length
      ? input.objecoes_provaveis.slice(0, 6)
      : fb.objecoes_provaveis,
    rawProvider: "openai",
  };
  return out;
}

function parseJsonResponse(text) {
  const raw = String(text || "{}").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return {};
    return JSON.parse(match[0]);
  }
}

function shouldTryNextProvider(error) {
  const status = Number(error?.status || 0);
  return !status || status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

function fallbackSalesAnalysis(lead, siteAnalysis, score, settings, warning = "") {
  const c = lead.company || {};
  if (!hasOwnWebsite(c, siteAnalysis)) return fallbackNoSiteAnalysis(lead, siteAnalysis, score, settings, warning);
  const hasSite = !!c.website;
  const mainPain = pickMainPain(c, siteAnalysis);
  const opportunity = pickOpportunity(c, siteAnalysis);
  const companyName = c.name || "sua empresa";
  const service = (settings?.commercial?.services || ["site", "landing page"])[0] || "site";
  const message = `Oi, ${companyName}! Tudo bem? Vi a empresa no Google e notei uma oportunidade: ${mainPain.toLowerCase()} Trabalho com ${service} para transformar visitas em contatos pelo WhatsApp. Posso te mandar uma ideia rápida do que eu melhoraria?`;
  const priorityLabel = score.classification || "Prioridade a avaliar";
  return {
    score: score.value,
    prioridade: score.priority,
    vale_prospectar: score.worthProspecting,
    chance_resposta: score.value >= 80 ? "alta" : score.value >= 60 ? "media" : "baixa",
    chance_reuniao: score.value >= 80 ? "media" : score.value >= 60 ? "media" : "baixa",
    ticket_estimado: estimateTicket(c, siteAnalysis),
    grau_de_urgencia: score.value >= 80 ? "alto" : score.value >= 60 ? "medio" : "baixo",
    facilidade_de_convencer: c.phone || c.whatsapp ? "media" : "baixa",
    principais_dores: [
      mainPain,
      hasSite
        ? "O site existe, mas pode estar perdendo contatos que já chegam pelo Google."
        : "Sem site próprio, a empresa perde credibilidade e contatos no digital.",
      siteAnalysis.tracking?.googleAnalytics
        ? "Já mede visitas, mas ainda dá para melhorar quantos viram cliente."
        : "Não dá para saber bem o que o site está gerando de resultado.",
    ],
    principais_oportunidades: [
      opportunity,
      "Facilitar o pedido de orçamento pelo WhatsApp.",
      "Usar as avaliações do Google como prova social no site.",
    ],
    resumo: `${companyName}: nota ${score.value}/100 (${priorityLabel}). ${score.reasons?.[0] || "Vale olhar o site e a presença no Google."}`,
    resumo_empresa: `${companyName}${c.category ? ` trabalha com ${c.category}` : ""}${c.city ? ` em ${c.city}` : ""}.`,
    problemas_encontrados: [
      mainPain,
      siteAnalysis.conversion?.hasWhatsappButton
        ? "Há botão de contato, mas o caminho até a venda pode ficar mais claro."
        : "WhatsApp não aparece de forma fácil no site.",
      siteAnalysis.content?.description
        ? "A mensagem do site pode ser mais clara e persuasiva."
        : "A primeira impressão do site não explica bem o que a empresa oferece.",
    ],
    argumento_principal_venda: opportunity,
    mensagem_whatsapp: message,
    assunto_email: `Ideia para gerar mais contatos pelo site da ${companyName}`,
    primeiro_email: `Olá, ${companyName}.\n\nEncontrei vocês pelo Google e notei uma oportunidade: ${mainPain.toLowerCase()}\n\nTrabalho criando sites e páginas simples para transformar visitas em pedidos de orçamento. Acredito que a ${companyName} poderia aproveitar melhor a presença local e levar mais pessoas para o WhatsApp.\n\nPosso te mandar uma ideia objetiva do que eu mudaria?`,
    mensagem_follow_up: `Oi, ${companyName}. Passando só para reforçar: minha sugestão é melhorar a conversão digital de quem já encontra vocês no Google. Faz sentido eu te mandar uma ideia rápida?`,
    objecoes_provaveis: [
      { objecao: "Já tenho site.", resposta: "Perfeito. A ideia não é trocar por trocar — é ver se o site está gerando contatos de verdade." },
      { objecao: "Não preciso agora.", resposta: "Entendo. Posso te mandar uma análise curta para você guardar e avaliar quando fizer sentido." },
      { objecao: "Está caro.", resposta: "Podemos começar com uma página enxuta, focada em gerar orçamentos." },
    ],
    warning,
    rawProvider: "fallback",
  };
}

// Sem site próprio a conversa é outra: não há site para criticar, e sim
// clientes que já acham a empresa no Google e não têm para onde ir.
function fallbackNoSiteAnalysis(lead, siteAnalysis, score, settings, warning = "") {
  const c = lead.company || {};
  const companyName = c.name || "sua empresa";
  const reviews = Number(c.reviewCount || 0);
  const rating = Number(c.rating || 0);
  const wellRated = reviews >= 20 && rating >= 4;
  const profile = siteAnalysis.digitalPresence?.platform || "";
  const profileLabel = profile ? profile.charAt(0).toUpperCase() + profile.slice(1) : "";
  const reachable = !!(c.phone || c.whatsapp);
  const service = (settings?.commercial?.services || ["site"])[0] || "site";
  const mainPain = profileLabel
    ? `A empresa depende só do ${profileLabel}; quem pesquisa no Google não encontra uma página própria.`
    : "A empresa não tem site: quem pesquisa no Google não encontra uma página própria.";
  const hook = wellRated
    ? `vocês têm ${reviews} avaliações com nota ${rating.toFixed(1)}, mas quem busca no Google não encontra um site para conhecer melhor`
    : profileLabel
      ? `o principal canal de vocês é o ${profileLabel}, e quem pesquisa no Google não acha um site próprio`
      : "vocês ainda não têm um site, e quem pesquisa no Google acaba indo para a concorrência";
  const opportunity = wellRated
    ? "Criar um site que aproveite as avaliações do Google como prova social e leve o visitante direto para o WhatsApp."
    : "Criar um site simples e profissional para aparecer melhor no Google e receber pedidos de orçamento.";
  const priorityLabel = score.classification || "Prioridade a avaliar";
  return {
    score: score.value,
    prioridade: score.priority,
    vale_prospectar: score.worthProspecting,
    chance_resposta: reachable && score.value >= 60 ? "media" : "baixa",
    chance_reuniao: wellRated && reachable ? "media" : "baixa",
    ticket_estimado: reviews >= 100 ? "medio" : "baixo",
    grau_de_urgencia: wellRated ? "medio" : "baixo",
    facilidade_de_convencer: wellRated ? "media" : "baixa",
    principais_dores: [
      mainPain,
      wellRated
        ? "Boa reputação no Google que não vira visita a um site."
        : "Pouca prova de confiança para quem ainda não conhece a empresa.",
      reachable
        ? "Todo contato depende do telefone ou do perfil, sem página para tirar dúvidas antes."
        : "Sem site e sem telefone visível, o cliente tem dificuldade de chegar até a empresa.",
    ],
    principais_oportunidades: [
      opportunity,
      "Página com serviços, localização e botão de WhatsApp.",
      "Aparecer melhor nas buscas locais do Google.",
    ],
    resumo: `${companyName}: nota ${score.value}/100 (${priorityLabel}). ${score.reasons?.[0] || "Empresa sem site próprio."}`,
    resumo_empresa: `${companyName}${c.category ? ` trabalha com ${c.category}` : ""}${c.city ? ` em ${c.city}` : ""}.`,
    problemas_encontrados: [
      mainPain,
      wellRated ? "As avaliações positivas ficam presas no Google Maps." : "Pouca informação para o cliente decidir antes de chamar.",
      "Sem página própria para anunciar ou divulgar.",
    ],
    argumento_principal_venda: opportunity,
    mensagem_whatsapp: `Oi, ${companyName}! Tudo bem? Encontrei vocês no Google e vi que ${hook}. Trabalho com ${service} para empresas locais receberem mais pedidos pelo WhatsApp. Posso te mostrar uma ideia rápida de como ficaria?`,
    assunto_email: `Um site para a ${companyName}`,
    primeiro_email: `Olá, ${companyName}.\n\nEncontrei vocês pelo Google e vi que ${hook}.\n\nCrio sites e páginas simples para empresas locais, com os serviços, a localização e um botão direto para o WhatsApp. Isso ajuda quem já procura por vocês a virar cliente.\n\nPosso te mandar um rascunho de como ficaria?`,
    mensagem_follow_up: `Oi, ${companyName}. Passando para reforçar: posso te mostrar um rascunho de site para vocês, sem compromisso. Faz sentido?`,
    objecoes_provaveis: [
      { objecao: profileLabel ? `Já tenho ${profileLabel}.` : "Não preciso de site.", resposta: "O perfil continua. O site é o que aparece para quem busca no Google e ainda não segue vocês." },
      { objecao: "Os clientes já me acham.", resposta: "Ótimo sinal. O site serve para não perder quem pesquisa e compara antes de chamar." },
      { objecao: "Está caro.", resposta: "Dá para começar com uma página enxuta e evoluir depois." },
    ],
    warning,
    rawProvider: "fallback",
  };
}

function pickMainPain(company, site) {
  if (!company.website) return "A empresa não tem um site próprio claro.";
  if (!site.hasHttps) return "O site não está seguro (sem cadeado HTTPS).";
  if (!site.conversion?.hasWhatsappButton) return "O site não facilita o contato imediato pelo WhatsApp.";
  if (!site.conversion?.hasForm) return "O site não captura pedidos de orçamento por formulário.";
  if (!site.content?.h1 || !site.content?.description) return "A mensagem do site não deixa a oferta clara de cara.";
  if (!site.mobile?.isResponsive) return "O site pode não funcionar bem no celular.";
  if ((site.performance?.loadTimeMs || 0) > 5000) return "O site carrega devagar e pode afastar clientes.";
  return "O site existe, mas pode converter melhor (gerar mais contatos).";
}

function pickOpportunity(company, site) {
  if (!company.website) return "Criar um site simples e profissional para aumentar confiança e receber contatos.";
  if (site.tracking?.metaPixel || site.tracking?.googleAdsConversion) return "Melhorar a página para aproveitar melhor o tráfego de anúncios que já existe.";
  if (company.reviewCount >= 50) return "Usar as avaliações do Google como prova social em uma página mais persuasiva.";
  return "Reposicionar o site para gerar mais contatos qualificados.";
}

function estimateTicket(company, site) {
  const reviews = Number(company.reviewCount || 0);
  if ((site.tracking?.metaPixel || site.tracking?.googleAdsConversion) && reviews >= 50) return "alto";
  if (reviews >= 30 || site.hasOwnDomain) return "medio";
  return "baixo";
}

function normalizePriority(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("alta")) return "alta";
  if (v.includes("boa")) return "boa";
  if (v.includes("baixa")) return "baixa";
  if (v.includes("ignorar")) return "ignorar";
  return v;
}

function array3(value, fallback) {
  const arr = Array.isArray(value) ? value.filter(Boolean) : [];
  return (arr.length ? arr : fallback || []).slice(0, 3);
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

module.exports = {
  analyzeWithSalesAI,
  analyzeBatchWithSalesAI,
  fallbackSalesAnalysis,
  resolveProviderConfig,
  resolveProviderChain,
  testProviderConnection,
  extractProviderText,
  openCodeApiStyle,
};
