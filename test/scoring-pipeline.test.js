const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LeadScoringService } = require('../lead-scoring');

function withService(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-ls-auto-'));
  try {
    return fn(new LeadScoringService(dir, () => {}), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SCRAPED_LEAD = {
  id: 'maps-1',
  name: 'Odonto Lume',
  category: 'Dentista',
  address: 'Avenida Atlântica, 1000, Rio de Janeiro, RJ',
  city: 'Rio de Janeiro',
  state: 'RJ',
  phone: '+55 21 98765-0142',
  website: '',
  instagram: '@odonto.lume',
  rating: 4.8,
  reviewCount: 120,
};

test('análise automática fica desligada por padrão', () => withService((service) => {
  assert.equal(service.getSettings().analysis.autoAnalyzeAfterScrape, false);
}));

test('liga a análise automática pelas configurações', () => withService((service) => {
  service.updateSettings({ analysis: { autoAnalyzeAfterScrape: true } });
  assert.equal(service.getSettings().analysis.autoAnalyzeAfterScrape, true);
  assert.equal(service.store.getSettings().analysis.autoAnalyzeAfterScrape, true);
}));

test('lote devolve todos os leads salvos, com ou sem etapa de IA', () => withService(async (service) => {
  const result = await service.analyzeBatch([SCRAPED_LEAD], { query: 'dentistas', skipNoWebsite: false });
  assert.equal(result.count, 1);
  assert.equal(result.analyzedCount, 1);
  assert.equal(result.failures, 0);
  assert.equal(result.results[0].success, true);
  assert.ok(result.results[0].lead.score.value > 0);

  const stored = service.getAll({}).leads;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].company.instagram, '@odonto.lume');
  assert.equal(stored[0].score.priority.length > 0, true);
}));

test('site e instagram do lead extraído chegam ao scoring sem lixo', () => withService(async (service) => {
  await service.analyzeBatch([{
    ...SCRAPED_LEAD,
    id: 'maps-2',
    name: 'Café Aurora',
    website: 'https://maps.app.goo.gl/abc123',
    instagram: 'https://www.instagram.com/cafe.aurora/?igsh=xyz',
  }], { skipNoWebsite: false });

  const [lead] = service.getAll({}).leads;
  assert.equal(lead.company.website, '');
  assert.equal(lead.company.instagram, '@cafe.aurora');
  assert.equal(lead.score.components.digitalPain > 0, true);
}));

test('lote ignora leads sem site em vez de avaliar', () => withService(async (service) => {
  const events = [];
  const skipping = new LeadScoringService(service.userDataPath, (payload) => events.push(payload));
  const result = await skipping.analyzeBatch([{ ...SCRAPED_LEAD, id: 'sem-site' }], { query: 'dentistas' });
  assert.equal(result.count, 1);
  assert.equal(result.analyzedCount, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.failures, 0);
  assert.equal(result.results[0].skipped, true);
  assert.ok(events.some((event) => event.event === 'skipped'));
  assert.equal(skipping.getAll({}).leads.length, 0);
}));

test('análise avulsa recusa lead sem site com erro codificado', () => withService(async (service) => {
  await assert.rejects(
    service.analyzeLead({ ...SCRAPED_LEAD }, {}),
    (err) => err.code === 'NO_WEBSITE',
  );
}));

test('opção analyzeNoWebsite passa a avaliar leads sem site', () => withService(async (service) => {
  assert.equal(service.getSettings().analysis.analyzeNoWebsite, false);
  service.updateSettings({ analysis: { analyzeNoWebsite: true } });
  const result = await service.analyzeBatch([{ ...SCRAPED_LEAD, id: 'sem-site-ok' }], { query: 'dentistas' });
  assert.equal(result.skipped, 0);
  assert.equal(result.analyzedCount, 1);
  const saved = await service.analyzeLead({ ...SCRAPED_LEAD }, {});
  assert.ok(saved.score.value > 0);
  assert.ok(saved.aiAnalysis.mensagem_whatsapp.includes('Odonto Lume'));
}));

test('skipNoWebsite explícito vence a configuração', () => withService(async (service) => {
  service.updateSettings({ analysis: { analyzeNoWebsite: true } });
  const result = await service.analyzeBatch([SCRAPED_LEAD], { skipNoWebsite: true });
  assert.equal(result.skipped, 1);
}));

test('score salvo é reencontrado por identidade depois de reimportar a base', () => withService(async (service) => {
  await service.analyzeBatch([SCRAPED_LEAD], { skipNoWebsite: false });
  const [saved] = service.getAll({}).leads;

  // O id do renderer muda a cada importação; o telefone é o que amarra o score.
  const reimported = { ...SCRAPED_LEAD, id: 'outro-id-do-renderer' };
  assert.equal(saved.company.phone, reimported.phone);

  const { buildScoringIndex, findScoringLead } = await import('../renderer/src/leadMatch.mjs');
  const found = findScoringLead(buildScoringIndex(service.getAll({}).leads), reimported, 0);
  assert.equal(found?.id, saved.id);
}));
