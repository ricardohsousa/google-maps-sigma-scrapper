const test = require('node:test');
const assert = require('node:assert/strict');

const stageModule = import('../renderer/src/kanbanStage.mjs');
const managerModule = import('../renderer/src/groupsManagerRequest.mjs');

const card = (entityKey, profile, refs = {}, extra = {}) => ({
  entityKey,
  columnId: 'new',
  revision: 1,
  entity: { entityKey, profile, sourceRefs: { mapsIds: [], scoringIds: [], ...refs } },
  ...extra,
});

test('encontra o card pelo id do lead antes de comparar identidade', async () => {
  const { findKanbanCard } = await stageModule;
  const cards = [
    card('outro', { name: 'Clínica A', address: 'Rua 1, 10', phone: '21999990000' }),
    card('certo', { name: 'Outro nome', address: 'Rua 9', phone: '' }, { mapsIds: ['lead-1'] }),
  ];
  const found = findKanbanCard(cards, { id: 'lead-1', name: 'Clínica A', address: 'Rua 1, 10', phone: '21999990000' });
  assert.equal(found.entityKey, 'certo');
});

test('sem id conhecido, usa nome + endereço e depois telefone', async () => {
  const { findKanbanCard } = await stageModule;
  const cards = [
    card('por-endereco', { name: 'Café Aurora', address: 'Rua B, 42', phone: '' }),
    card('por-telefone', { name: 'Nome no Kanban', address: '', phone: '+55 21 98765-0142' }),
  ];
  assert.equal(findKanbanCard(cards, { id: 'x', name: 'CAFÉ aurora', address: 'rua b, 42' }).entityKey, 'por-endereco');
  assert.equal(findKanbanCard(cards, { id: 'y', name: 'Outro', phone: '(21) 98765-0142' }).entityKey, 'por-telefone');
});

test('lead sem correspondência não recebe card de outra empresa', async () => {
  const { findKanbanCard } = await stageModule;
  const cards = [card('a', { name: 'Clínica A', address: 'Rua 1, 10', phone: '21999990000' })];
  assert.equal(findKanbanCard(cards, { id: 'z', name: 'Clínica A', address: 'Rua 2, 20' }), null);
  assert.equal(findKanbanCard(cards, { id: 'z', name: 'Sem dados' }), null);
  assert.equal(findKanbanCard(undefined, { id: 'z' }), null);
});

test('etapa final segue a mesma regra do quadro', async () => {
  const { stageAction } = await stageModule;
  const open = { columnId: 'new', dealStatus: 'open' };
  assert.equal(stageAction(open, { id: 'new' }), 'none');
  assert.equal(stageAction(open, { id: 'proposal', dealOutcome: null }), 'move');
  assert.equal(stageAction(open, { id: 'won', dealOutcome: 'won' }), 'won');
  assert.equal(stageAction(open, { id: 'lost', dealOutcome: 'lost' }), 'lost');
  assert.equal(stageAction({ columnId: 'proposal', dealStatus: 'won' }, { id: 'won', dealOutcome: 'won' }), 'move');
});

test('valor da venda aceita formato brasileiro e recusa valor vazio', async () => {
  const { parseDealValue } = await stageModule;
  assert.equal(parseDealValue('1.500,50'), 1500.5);
  assert.equal(parseDealValue('R$ 2.000'), 2000);
  assert.equal(parseDealValue('300'), 300);
  assert.equal(parseDealValue(''), 0);
  assert.equal(parseDealValue('abc'), 0);
});

test('pedido para abrir os grupos sobrevive à troca de tela e vale uma vez', async () => {
  const { requestGroupsManager, consumeGroupsManagerRequest } = await managerModule;
  const previous = globalThis.window;
  globalThis.window = { location: { hash: '#scoring' } };
  try {
    assert.equal(consumeGroupsManagerRequest(), false);
    requestGroupsManager();
    assert.equal(globalThis.window.location.hash, '#base');
    assert.equal(consumeGroupsManagerRequest(), true);
    assert.equal(consumeGroupsManagerRequest(), false);
  } finally {
    globalThis.window = previous;
  }
});
