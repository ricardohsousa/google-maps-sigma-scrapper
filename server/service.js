const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SharedStore, Users, atomic } = require('./storage');
const { authorize, exactFields, httpError } = require('./access');
const { prepareImport, importBackup } = require('./migration');
const { createBackup } = require('../utils/data-backup');
const { LeadScoringService } = require('../lead-scoring');
const { KanbanStore } = require('../kanban/kanban-store');
const { CampaignStore } = require('../campaigns/campaign-store');
const mapsSettings = require('../utils/maps-settings');

const STATUSES = ['not_contacted', 'contacted', 'responded', 'qualified', 'meeting', 'proposal', 'closed', 'lost'];
function text(value, max = 2000) { return String(value ?? '').slice(0, max); }
function mergeLeads(current, incoming) {
  const { mergeList } = require('./migration');
  return mergeList(current, incoming).value;
}
function download(value, filename, mime = 'application/json') {
  return { success: true, download: { filename, mime, base64: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2)).toString('base64') } };
}
class SigmaService {
  constructor({ root, ownerEmail, emit = () => {}, scraper }) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.store = new SharedStore(root);
    this.users = new Users(root, ownerEmail);
    this.emit = emit;
    this.scraper = scraper || require('../scraper').scrapeGoogleMaps;
    this.activeScrapes = new Map();
    mapsSettings.setPath(path.join(root, 'maps-settings.json'));
    this.reload();
  }
  reload() {
    this.scoring = new LeadScoringService(this.root, payload => this.emit('lead-scoring-progress', payload));
    this.kanban = new KanbanStore(this.root);
    this.campaigns = new CampaignStore(this.root);
    this.syncBoard();
  }
  audit(user, action, target = '') {
    fs.appendFileSync(path.join(this.root, 'web-audit.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), userId: user.id, email: user.email, action, target: text(target, 180) })}\n`, { mode: 0o600 });
  }
  syncBoard() {
    this.kanban.syncLeads(this.store.array('sigma_leads'), 'maps');
    this.kanban.syncLeads(this.scoring.getAll({}).leads, 'scoring');
    this.kanban.syncCampaigns(this.campaigns.getAll());
    return this.kanban.getBoard();
  }
  session(user) {
    return { success: true, user: { id: user.id, email: user.email, role: user.role }, statuses: STATUSES, state: user.role === 'owner' ? this.store.snapshot() : null };
  }
  leads() {
    const board = this.syncBoard();
    return { success: true, columns: board.board.columns, leads: board.cards.map(card => ({
      id: card.entityKey, profile: card.entity.profile, columnId: card.columnId, cardRevision: card.revision,
      operation: this.store.state.operations[card.entityKey] || { status: card.entity.profile.prospectingStatus || 'not_contacted', notes: (card.entity.sourceRefs?.scoringIds || []).map(id => this.scoring.getLead(id)?.prospecting?.notes).find(Boolean) || card.dealNote || '', revision: 0 },
    })) };
  }
  updateOperation(user, payload) {
    exactFields(payload, ['id', 'status', 'notes', 'expectedRevision']);
    const id = text(payload.id, 180);
    const card = this.kanban.getBoard().cards.find(item => item.entityKey === id);
    if (!card) throw httpError(404, 'Lead não encontrado.');
    if (!STATUSES.includes(payload.status) || typeof payload.notes !== 'string' || payload.notes.length > 2000) throw httpError(400, 'Status ou anotação inválidos.');
    const current = this.store.state.operations[id] || { revision: 0 };
    if (payload.expectedRevision !== current.revision) throw httpError(409, 'Este acompanhamento foi alterado. Atualize antes de salvar.', 'LEAD_CONFLICT');
    this.audit(user, 'lead.operation.update', id);
    this.store.state.operations[id] = { status: payload.status, notes: payload.notes, revision: current.revision + 1, updatedAt: Date.now(), updatedBy: user.id };
    this.store.save();
    for (const scoringId of card.entity.sourceRefs?.scoringIds || []) {
      if (this.scoring.getLead(scoringId)) this.scoring.updateOutcome(scoringId, { status: payload.status, notes: payload.notes });
    }
    this.emit('changed', {});
    return { success: true, operation: this.store.state.operations[id] };
  }
  async scrape(payload) {
    if (this.activeScrapes.size) throw httpError(409, 'Já há uma extração em execução.');
    const query = text(payload.query, 240).trim();
    if (!query) throw httpError(400, 'Informe a pesquisa.');
    const maxResults = Math.max(1, Math.min(500, Number(payload.maxResults) || 30));
    const queryId = text(payload.queryId || crypto.randomUUID(), 80);
    const token = { cancelled: false };
    this.activeScrapes.set(queryId, token);
    try {
      const settings = mapsSettings.load();
      const source = payload.source || settings.defaultSource;
      const run = source === 'places-api' ? (...args) => require('../places-api').searchPlacesApi(...args, { apiKey: settings.placesApiKey }) : this.scraper;
      const result = await run(query, maxResults, event => this.emit('progress', { ...(payload.progressContext || {}), ...(typeof event === 'object' ? event : { message: event }), queryId, status: 'running' }), token);
      if (!result || result.success === false) throw new Error(result?.error || 'Extração não concluída.');
      const data = (result.data || []).map(lead => ({ ...lead, id: lead.id || `web_${crypto.createHash('sha256').update(JSON.stringify([lead.name, lead.address, lead.phone])).digest('hex').slice(0, 24)}`, searchId: queryId, query }));
      this.store.state.values.sigma_leads = JSON.stringify(mergeLeads(this.store.array('sigma_leads'), data));
      this.store.state.values.sigma_searches = JSON.stringify(mergeLeads(this.store.array('sigma_searches'), [{ id: queryId, query, source: 'maps', timestamp: Date.now() }]));
      this.store.save();
      this.syncBoard();
      this.emit('progress', { queryId, status: 'completed', current: data.length, total: data.length, message: 'Extração salva no servidor.' });
      this.emit('changed', {});
      return { ...result, success: true, data, count: data.length, preview: data.slice(0, 3) };
    } finally { this.activeScrapes.delete(queryId); }
  }
  async dispatch(user, channel, p = {}) {
    authorize(user, channel);
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw httpError(400, 'Dados inválidos.');
    switch (channel) {
      case 'session-get': return this.session(user);
      case 'leads-list': return this.leads();
      case 'lead-operation-update': return this.updateOperation(user, p);
      case 'users-list': return { success: true, users: this.users.list() };
      case 'users-update': {
        exactFields(p, ['email', 'role', 'active']);
        this.audit(user, channel, p.email);
        return { success: true, users: this.users.update(p) };
      }
      case 'state-get': return { success: true, ...this.store.snapshot() };
      case 'state-set': {
        exactFields(p, ['key', 'value', 'revision']);
        this.audit(user, channel, p.key);
        const result = this.store.set(p.key, p.value, p.revision);
        if (p.key === 'sigma_leads') {
          // A base é autoritativa somente na alteração explícita do proprietário.
          this.kanban.syncLeads(this.store.array('sigma_leads'), 'maps', { replace: true });
          this.syncBoard();
        }
        this.emit('changed', {});
        return { success: true, ...result };
      }
      case 'backup-export': return download(createBackup(this.root, this.store.state.values, this.store.state.operations), `sigma-backup-${Date.now()}.json`);
      case 'backup-preview': return { success: true, report: prepareImport(this.root, this.store, p.bundle).report };
      case 'backup-import': {
        if (this.activeScrapes.size || this.scoring.activeJobs.size) throw httpError(409, 'Aguarde as extrações e análises terminarem antes de importar.');
        this.audit(user, channel);
        const report = importBackup(this.root, this.store, p.bundle, () => this.reload());
        this.emit('changed', {});
        return { success: true, report };
      }
      case 'migrate-existing-data': return { success: true, changed: false, localStorageUpdates: {} };
      case 'start-scrape': this.audit(user, channel); return this.scrape(p);
      case 'cancel-scrape': {
        const token = this.activeScrapes.get(p.queryId);
        if (token) token.cancelled = true;
        return { success: true, cancelled: Boolean(token) };
      }
      case 'maps-settings-get': return mapsSettings.getPublic();
      case 'maps-settings-set': this.audit(user, channel); return { success: true, settings: mapsSettings.update(p) };
      case 'maps-test-places-key': return require('../places-api').testPlacesApiKey(p.apiKey);
      case 'repair-map-addresses': {
        const { normalizeAddress } = require('../utils/address-normalizer');
        const { geocodeAddress, isValidCoord } = require('../utils/geocode');
        const repaired = [], failures = [], seen = new Set();
        for (const raw of (Array.isArray(p.leads) ? p.leads : []).slice(0, 500)) {
          const key = text(raw?.key, 300), address = normalizeAddress(raw?.address);
          if (!key || !address || seen.has(key)) continue;
          seen.add(key);
          const item = { key, address };
          try {
            const geo = await geocodeAddress(address, [text(raw.city, 120), text(raw.state, 8)].filter(Boolean).join(', '));
            if (!geo || !isValidCoord(Number(geo.lat), Number(geo.lng))) throw new Error('Endereço não localizado.');
            Object.assign(item, { latitude: geo.lat, longitude: geo.lng, coordSource: 'nominatim', geocodeConfidence: geo.confidence || 'approximate' });
          } catch (error) { item.error = text(error.message, 220); failures.push({ key, error: item.error }); }
          repaired.push(item);
        }
        return { success: true, partial: failures.length > 0, repaired, failures };
      }
      case 'kanban-get-board': return { success: true, board: this.syncBoard(), thresholds: this.scoring.getSettings().rules?.thresholds };
      case 'kanban-sync-maps': return { success: true, board: this.syncBoard() };
      case 'kanban-move-card': {
        exactFields(p, user.role === 'owner' ? ['entityKey', 'toColumnId', 'expectedRevision', 'manual'] : ['entityKey', 'toColumnId', 'expectedRevision']);
        if (!Number.isInteger(p.expectedRevision)) throw httpError(400, 'Atualize o card antes de mover.');
        this.audit(user, channel, p.entityKey);
        const board = this.kanban.moveCard({ ...p, manual: true });
        this.emit('changed', {});
        return { success: true, board };
      }
      case 'kanban-record-deal': this.audit(user, channel, p.entityKey); return { success: true, board: this.kanban.recordDeal(p) };
      case 'kanban-save-config': return { success: true, board: this.kanban.saveConfig(p.board, p.expectedRevision) };
      case 'kanban-reset': return { success: true, board: this.kanban.reset() };
      case 'kanban-apply-rules': return { success: true, ...this.kanban.applyRules({ force: p.force === true }) };
      case 'kanban-resume-automation': return { success: true, board: this.kanban.resumeAutomation(p.entityKey) };
      case 'lead-scoring-get-settings': return { success: true, settings: this.scoring.getSettings() };
      case 'lead-scoring-update-settings': return { success: true, settings: this.scoring.updateSettings(p.patch || {}) };
      case 'lead-scoring-test-connection': return { success: true, ...await this.scoring.testConnection(p.ai || {}) };
      case 'lead-scoring-get-all': return { success: true, ...this.scoring.getAll(p.filters || {}) };
      case 'lead-scoring-get-lead': return { success: true, lead: this.scoring.getLead(p.id) };
      case 'lead-scoring-analyze-lead': return { success: true, lead: await this.scoring.analyzeLead(p.lead, p.options || {}) };
      case 'lead-scoring-analyze-batch': return { success: true, ...await this.scoring.analyzeBatch(p.leads || [], p.options || {}) };
      case 'lead-scoring-cancel': return { success: true, cancelled: this.scoring.cancel(p.jobId) };
      case 'lead-scoring-clear': return { success: true, ...this.scoring.clearAnalyses(p) };
      case 'lead-scoring-open-screenshot': {
        const root = path.resolve(this.root, 'lead-scoring', 'screenshots');
        const file = path.resolve(String(p.filePath || ''));
        if (!file.startsWith(`${root}${path.sep}`) || !['.png', '.jpg', '.webp'].includes(path.extname(file)) || !fs.existsSync(file) || fs.statSync(file).size > 10 * 1024 * 1024) throw httpError(404, 'Captura não disponível nesta instalação.');
        return { success: true, download: { filename: path.basename(file), mime: `image/${path.extname(file).slice(1).replace('jpg', 'jpeg')}`, base64: fs.readFileSync(file).toString('base64') } };
      }
      case 'lead-scoring-update-outcome': return { success: true, lead: this.scoring.updateOutcome(p.id, p.outcome || {}) };
      case 'lead-scoring-list-groups': return { success: true, groups: this.scoring.listGroups() };
      case 'lead-scoring-sync-groups': {
        const groups = new Map(this.scoring.listGroups().map(group => [group.id, group]));
        for (const group of p.groups || []) if (group?.id) groups.set(group.id, group);
        return { success: true, groups: this.scoring.syncGroups([...groups.values()]) };
      }
      case 'lead-scoring-create-group': return { success: true, group: this.scoring.createGroup(p) };
      case 'lead-scoring-update-group': return { success: true, group: this.scoring.updateGroup(p.id, p.patch || {}) };
      case 'lead-scoring-delete-group': return { success: true, ...this.scoring.deleteGroup(p.id, p) };
      case 'lead-scoring-add-to-group': return { success: true, group: this.scoring.addLeadsToGroup(p.groupId, p.leadIds) };
      case 'lead-scoring-remove-from-group': return { success: true, group: this.scoring.removeLeadsFromGroup(p.groupId, p.leadIds) };
      case 'lead-scoring-create-group-from-filters': return { success: true, group: this.scoring.createGroupFromFilters(p.name, p.filters, p) };
      case 'export-leads': case 'lead-scoring-export': {
        const rows = channel === 'export-leads' ? p.leads || [] : this.scoring.getAll(p.filters || {}).leads;
        if (p.format === 'json') return download(rows, 'sigma-leads.json');
        const XLSX = require('xlsx');
        const plain = rows.map(row => row.company ? { id: row.id, ...row.company, score: row.score?.value, status: row.prospecting?.status } : row);
        const sheet = XLSX.utils.json_to_sheet(plain);
        if (p.format === 'xlsx') {
          const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Leads');
          return { success: true, download: { filename: 'sigma-leads.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: XLSX.write(book, { type: 'base64', bookType: 'xlsx' }) } };
        }
        return download(XLSX.utils.sheet_to_csv(sheet), 'sigma-leads.csv', 'text/csv;charset=utf-8');
      }
      case 'campaign-get-all': return { success: true, campaigns: this.campaigns.getAll() };
      case 'campaign-get': return { success: true, campaign: this.campaigns.get(p.id) };
      case 'campaign-delete': this.audit(user, channel, p.id); this.campaigns.delete(p.id); return { success: true };
      case 'campaign-recovery-list': return { success: true, campaigns: [] };
      case 'whatsapp-status': return { status: 'disabled', connected: false };
      case 'whatsapp-list-connections': return { success: true, connections: [] };
      case 'update-status': return { status: 'unavailable', message: 'Atualizações gerenciadas pela pipeline.' };
      case 'metrics-get': return { success: true, metrics: {} };
      case 'metrics-track': return { success: true };
      case 'metrics-settings-get': return { success: true, enabled: false };
      case 'delete-temp-files': return { success: true, message: 'A base compartilhada foi preservada.' };
      default: throw httpError(404, 'Ação não disponível nesta versão web.', 'UNKNOWN_ACTION');
    }
  }
}
module.exports = { SigmaService, STATUSES, download };
