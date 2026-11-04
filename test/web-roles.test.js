const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SigmaService } = require('../server/service');
const { SharedStore } = require('../server/storage');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-roles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new SigmaService({ root, ownerEmail: 'owner@example.com', scraper: async () => ({ success: true, data: [{ name: 'Nova empresa', phone: '11912345678', address: 'Rua Nova' }] }) });
  const owner = service.users.resolve({ sub: 'owner-identity', email: 'owner@example.com' });
  service.users.update({ email: 'operator@example.com', role: 'operator', active: true });
  const operator = service.users.resolve({ sub: 'operator-identity', email: 'operator@example.com' });
  service.store.set('sigma_leads', JSON.stringify([{ id: 'existing-id', name: 'Empresa original', phone: '11999999999', address: 'Rua Teste', website: 'https://example.com' }]), 0);
  service.syncBoard();
  return { root, service, owner, operator };
}

test('operador consulta, anota e move leads, sem alterar dados cadastrais ou valores', async t => {
  const { service, operator } = fixture(t);
  const row = (await service.dispatch(operator, 'leads-list')).leads[0];
  const before = structuredClone(service.store.state.values);
  const result = await service.dispatch(operator, 'lead-operation-update', { id: row.id, status: 'contacted', notes: 'Retornar após a reunião.', expectedRevision: 0 });
  assert.equal(result.operation.notes, 'Retornar após a reunião.');
  const stage = (await service.dispatch(operator, 'kanban-get-board')).board.board.columns.find(column => column.id === 'proposal');
  const board = await service.dispatch(operator, 'kanban-move-card', { entityKey: row.id, toColumnId: stage.id, expectedRevision: row.cardRevision });
  assert.equal(board.board.cards[0].columnId, 'proposal');
  assert.deepEqual(service.store.state.values, before);
  assert.equal(board.board.cards[0].dealValue, 0);
  assert.match(fs.readFileSync(path.join(service.root, 'web-audit.jsonl'), 'utf8'), /operator@example.com/);
});
test('operador não consegue usar APIs administrativas diretamente', async t => {
  const { service, operator } = fixture(t);
  for (const action of ['users-list', 'users-update', 'state-set', 'start-scrape', 'export-leads', 'backup-import', 'backup-export', 'kanban-reset', 'kanban-save-config', 'kanban-record-deal', 'lead-scoring-analyze-batch', 'lead-scoring-update-settings', 'lead-scoring-update-outcome', 'whatsapp-connect', 'unknown-channel']) {
    await assert.rejects(service.dispatch(operator, action, {}), error => error.status === 403, action);
  }
});
test('operador não pode injetar campos extras em notas ou movimentos', async t => {
  const { service, operator } = fixture(t);
  const row = service.leads().leads[0];
  for (const patch of [{ role: 'owner' }, { phone: '000' }, { value: 999 }, { closedValue: 999 }, { entity: { profile: { name: 'Alterado' } } }]) {
    await assert.rejects(service.dispatch(operator, 'lead-operation-update', { id: row.id, notes: '', status: 'contacted', expectedRevision: 0, ...patch }), error => error.status === 403);
  }
  await assert.rejects(service.dispatch(operator, 'kanban-move-card', { entityKey: row.id, toColumnId: 'proposal', expectedRevision: row.cardRevision, manual: false }), error => error.status === 403);
  assert.equal(service.leads().leads[0].profile.name, 'Empresa original');
});
test('edições concorrentes são rejeitadas sem perder a primeira anotação', async t => {
  const { service, operator } = fixture(t);
  const id = service.leads().leads[0].id;
  await service.dispatch(operator, 'lead-operation-update', { id, notes: 'Primeira anotação', status: 'contacted', expectedRevision: 0 });
  await assert.rejects(service.dispatch(operator, 'lead-operation-update', { id, notes: 'Anotação obsoleta', status: 'lost', expectedRevision: 0 }), error => error.status === 409);
  assert.equal(service.leads().leads[0].operation.notes, 'Primeira anotação');
});
test('usuários não cadastrados, desativados ou com identidade trocada são rejeitados', t => {
  const { service } = fixture(t);
  assert.throws(() => service.users.resolve({ sub: 'x', email: 'unknown@example.com' }), error => error.status === 403);
  assert.throws(() => service.users.resolve({ sub: 'changed', email: 'owner@example.com' }), error => error.status === 403);
  service.users.update({ email: 'operator@example.com', role: 'operator', active: false });
  assert.throws(() => service.users.resolve({ sub: 'operator-identity', email: 'operator@example.com' }), error => error.status === 403);
  assert.throws(() => service.users.update({ email: 'owner@example.com', role: 'operator', active: true }), error => error.status === 409);
});
test('extração salva o resultado no servidor mesmo sem participação do navegador', async t => {
  const { service, owner, root } = fixture(t);
  const result = await service.dispatch(owner, 'start-scrape', { query: 'Pesquisa', queryId: 'search-1', maxResults: 2 });
  assert.equal(result.success, true);
  const persisted = new SharedStore(root);
  assert.equal(persisted.array('sigma_leads').length, 2);
  assert.equal(persisted.array('sigma_searches')[0].id, 'search-1');
});
test('escritas na base exigem revisão atual e não sobrescrevem outra sessão', async t => {
  const { service, owner } = fixture(t);
  await assert.rejects(service.dispatch(owner, 'state-set', { key: 'sigma_leads', value: '[]', revision: 0 }), error => error.status === 409);
  assert.equal(service.store.array('sigma_leads').length, 1);
});

test('configurações do Maps mantêm o contrato da interface e não retornam a chave', async t => {
  const { service, owner } = fixture(t);
  const response = await service.dispatch(owner, 'maps-settings-set', { defaultSource: 'places-api', placesApiKey: 'test-key-not-for-renderer' });
  assert.equal(response.settings.defaultSource, 'places-api');
  assert.equal(response.settings.hasPlacesApiKey, true);
  assert.doesNotMatch(JSON.stringify(response), /test-key-not-for-renderer/);
});
