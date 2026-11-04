const test = require('node:test');
const assert = require('node:assert/strict');

test('recupera cidade, UF e bairro dos endereços já coletados', async () => {
  const { normalizeLeadCollection } = await import('../renderer/src/leadData.js');
  const { filterLeads } = await import('../renderer/src/leadGroups.mjs');
  const leads = normalizeLeadCollection([
    { id: 'a', address: 'Rua das Flores, 10 - Centro, Niterói - RJ, 24000-000, Brasil' },
    { id: 'b', address: 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100' },
    { id: 'c', address: 'Rua sem cidade, 15' },
  ]);
  assert.deepEqual(leads.map(({ city, state, neighborhood }) => ({ city, state, neighborhood })), [
    { city: 'Niterói', state: 'RJ', neighborhood: 'Centro' },
    { city: 'São Paulo', state: 'SP', neighborhood: 'Bela Vista' },
    { city: '', state: '', neighborhood: '' },
  ]);
  assert.deepEqual(filterLeads(leads, { city: 'niteroi', state: 'rj', neighborhood: 'centro' }).map(l => l.id), ['a']);
  assert.deepEqual(filterLeads(leads, { city: 'Niterói', state: 'SP' }), []);
  assert.equal(normalizeLeadCollection(leads)[0], leads[0]);
});

test('preserva localização explícita e não inventa cidade a partir de ruas ou UFs inválidas', async () => {
  const { leadLocation } = await import('../utils/lead-location.mjs');
  assert.deepEqual(leadLocation({ city: 'Maricá', uf: 'rj', bairro: 'Inoã', address: 'Niterói - RJ' }), { city: 'Maricá', state: 'RJ', neighborhood: 'Inoã' });
  assert.equal(leadLocation({ address: 'Rua Brasil - SP' }).city, '');
  assert.equal(leadLocation({ address: 'Cidade - XX' }).state, '');
  assert.equal(leadLocation({ address: '123 Street, Miami, FL 33101' }).state, '');
  assert.deepEqual(leadLocation({ company: { city: 'Recife', state: 'PE' } }), { city: 'Recife', state: 'PE', neighborhood: '' });
  assert.deepEqual(leadLocation({ address: 'Brasília/DF, Brasil' }), { city: 'Brasília', state: 'DF', neighborhood: '' });
});

test('busca textual encontra e-mail, site e telefone sem depender da formatação', async () => {
  const { filterLeads } = await import('../renderer/src/leadGroups.mjs');
  const leads = [{ id: 'a', email: 'contato@exemplo.com.br', website: 'https://exemplo.com.br', phone: '(21) 98765-4321' }];
  for (const text of ['contato@exemplo.com.br', 'https://exemplo.com.br', '21987654321']) {
    assert.equal(filterLeads(leads, { text }).length, 1, text);
  }
  assert.equal(filterLeads(leads, { text: '99999999999' }).length, 0);
});

test('trocar preset de canal substitui a condição anterior e tanto faz limpa a restrição', async () => {
  const { filterLeads, applyPreset, FILTER_PRESETS } = await import('../renderer/src/leadGroups.mjs');
  const leads = [{ id: 'com', website: 'https://exemplo.com' }, { id: 'sem' }];
  let filters = applyPreset({}, FILTER_PRESETS.find(p => p.id === 'with-site'));
  assert.deepEqual(filterLeads(leads, filters).map(l => l.id), ['com']);
  filters = applyPreset(filters, FILTER_PRESETS.find(p => p.id === 'no-site'));
  assert.deepEqual(filterLeads(leads, filters).map(l => l.id), ['sem']);
  filters = { ...filters, channels: { site: 'any' } };
  assert.equal(filterLeads(leads, filters).length, 2);
});
