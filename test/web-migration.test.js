const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackup, checksum } = require('../utils/data-backup');
const { atomic } = require('../server/storage');
const { SigmaService } = require('../server/service');
const { KanbanStore } = require('../kanban/kanban-store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'desktop');
  const destination = path.join(directory, 'web');
  const lead = { id: 'original-lead-id', name: 'Empresa coletada', phone: '11988887777', address: 'Rua do Lead' };
  fs.mkdirSync(source);
  atomic(path.join(source, 'lead-scoring/prospecting-leads.json'), { analysis1: { id: 'analysis1', company: lead, score: { value: 71 }, prospecting: { notes: 'Nota anterior', closedValue: 1200 } } });
  atomic(path.join(source, 'lead-scoring/prospecting-groups.json'), { group1: { id: 'group1', name: 'Grupo original', leadIds: ['analysis1'] } });
  atomic(path.join(source, 'campaigns.json'), { campaign1: { id: 'campaign1', name: 'Histórico', status: 'completed', leads: [] } });
  atomic(path.join(source, 'maps-settings.json'), { placesApiKey: 'sensitive-key-not-exported' });
  const kanban = new KanbanStore(source);
  kanban.syncLeads([lead]);
  const card = kanban.getBoard().cards[0];
  kanban.moveCard({ entityKey: card.entityKey, toColumnId: 'proposal', expectedRevision: card.revision });
  const local = { sigma_leads: JSON.stringify([lead]), sigma_searches: JSON.stringify([{ id: 'search-old', query: 'Consulta antiga' }]), sigma_groups: JSON.stringify([{ id: 'local-group', name: 'Grupo local' }]), sigma_history: JSON.stringify({ imported: 5, extracted: 1 }) };
  const bundle = createBackup(source, local);
  const service = new SigmaService({ root: destination, ownerEmail: 'owner@example.com' });
  const owner = service.users.users[0];
  return { source, destination, bundle, service, owner, lead };
}
test('migração preserva IDs, análises, grupos, campanha, posição no Kanban e origem local', async t => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.source, 'kanban.json'));
  const preview = await f.service.dispatch(f.owner, 'backup-preview', { bundle: f.bundle });
  assert.equal(preview.report.leadsAdded, 1);
  assert.equal(f.service.store.array('sigma_leads').length, 0);
  const result = await f.service.dispatch(f.owner, 'backup-import', { bundle: f.bundle });
  assert.equal(result.report.analysesAdded, 1);
  assert.equal(f.service.store.array('sigma_leads')[0].id, f.lead.id);
  assert.equal(f.service.scoring.getLead('analysis1').score.value, 71);
  assert.equal(f.service.scoring.getLead('analysis1').prospecting.closedValue, 1200);
  assert.equal(f.service.scoring.listGroups()[0].id, 'group1');
  await f.service.dispatch(f.owner, 'lead-scoring-sync-groups', { groups: [] });
  assert.equal(f.service.scoring.listGroups()[0].id, 'group1');
  assert.equal(f.service.campaigns.getAll()[0].id, 'campaign1');
  assert.equal(f.service.kanban.getBoard().cards[0].columnId, 'proposal');
  assert.deepEqual(fs.readFileSync(path.join(f.source, 'kanban.json')), original);
  assert.equal(fs.existsSync(path.join(f.destination, 'migration-backups', result.report.backupId, 'before.json')), true);
  assert.doesNotMatch(JSON.stringify(f.bundle), /sensitive-key-not-exported/);
});
test('reimportar o mesmo backup não duplica registros nem substitui dados atualizados', async t => {
  const f = fixture(t);
  await f.service.dispatch(f.owner, 'backup-import', { bundle: f.bundle });
  f.service.scoring.updateOutcome('analysis1', { notes: 'Nota nova no servidor' });
  const repeated = await f.service.dispatch(f.owner, 'backup-import', { bundle: f.bundle });
  assert.equal(repeated.report.leadsAdded, 0);
  assert.equal(repeated.report.analysesAdded, 0);
  assert.equal(repeated.report.cardsAdded, 0);
  assert.equal(f.service.store.array('sigma_leads').length, 1);
  assert.equal(f.service.scoring.getLead('analysis1').prospecting.notes, 'Nota nova no servidor');
  assert.ok(repeated.report.conflictsPreserved > 0);
});
test('backup adulterado ou com caminhos extras não altera a base', async t => {
  const f = fixture(t);
  const changed = structuredClone(f.bundle);
  changed.data.localStorage.sigma_leads = '[]';
  await assert.rejects(f.service.dispatch(f.owner, 'backup-import', { bundle: changed }), /integridade/);
  const extra = structuredClone(f.bundle);
  extra.data.files['../outside.json'] = {};
  extra.checksum = checksum(extra.data);
  await assert.rejects(f.service.dispatch(f.owner, 'backup-import', { bundle: extra }), /não reconhecidos/);
  assert.equal(f.service.store.array('sigma_leads').length, 0);
});

test('backup web conserva os acompanhamentos ao importar em outra instalação', async t => {
  const f = fixture(t);
  await f.service.dispatch(f.owner, 'backup-import', { bundle: f.bundle });
  const row = f.service.leads().leads[0];
  await f.service.dispatch(f.owner, 'lead-operation-update', { id: row.id, status: 'contacted', notes: 'Anotação feita na web', expectedRevision: 0 });
  const exported = await f.service.dispatch(f.owner, 'backup-export');
  const bundle = JSON.parse(Buffer.from(exported.download.base64, 'base64'));
  const other = new SigmaService({ root: path.join(f.destination, 'another-installation'), ownerEmail: 'owner@example.com' });
  await other.dispatch(other.users.users[0], 'backup-import', { bundle });
  assert.equal(other.leads().leads[0].operation.notes, 'Anotação feita na web');
  assert.equal(other.scoring.getLead('analysis1').prospecting.closedValue, 1200);
});
