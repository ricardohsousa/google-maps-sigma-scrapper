const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable, Writable } = require('node:stream');
const { createApp } = require('../server/http');
const { SigmaService } = require('../server/service');
const { httpError } = require('../server/access');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-http-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = new SigmaService({ root, ownerEmail: 'owner@example.com', scraper: async () => ({ success: true, data: [{ id: 'new', name: 'Empresa teste' }] }) });
  service.users.update({ email: 'operator@example.com', role: 'operator', active: true });
  const app = createApp({ service, origin: 'https://sigma.example.com', verify: async token => {
    if (!['owner', 'operator'].includes(token)) throw httpError(401, 'Identidade ausente.');
    return { sub: `sub-${token}`, email: `${token}@example.com`, exp: Date.now() / 1000 + 300 };
  } });
  t.after(() => app.close());
  return { service, async request(url, { method = 'GET', token = 'owner', payload, headers = {} } = {}) {
    const req = Readable.from(payload == null ? [] : [Buffer.from(JSON.stringify(payload))]);
    Object.assign(req, { url, method, headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json', origin: 'https://sigma.example.com', 'x-sigma-request': '1', ...headers } });
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    const responseHeaders = {};
    res.setHeader = (name, value) => { responseHeaders[name] = value; };
    res.writeHead = (status, extra = {}) => { res.statusCode = status; Object.assign(responseHeaders, extra); };
    await app(req, res);
    const text = Buffer.concat(chunks).toString('utf8');
    return { status: res.statusCode, headers: responseHeaders, text, json: () => JSON.parse(text) };
  } };
}
test('HTTP protege sessão, interface e ponte mesmo com e-mail forjado no header', async t => {
  const f = fixture(t);
  for (const url of ['/', '/api/session', '/web-preload.js']) {
    const response = await f.request(url, { token: undefined, headers: { 'cf-access-jwt-assertion': undefined, 'cf-access-authenticated-user-email': 'owner@example.com' } });
    assert.equal(response.status, 401);
  }
  assert.equal((await f.request('/healthz', { token: undefined })).status, 200);
});
test('HTTP rejeita origem externa e bloqueia escrita administrativa do operador', async t => {
  const f = fixture(t);
  const forged = await f.request('/api/rpc', { method: 'POST', payload: { channel: 'users-list' }, headers: { origin: 'https://evil.example' } });
  assert.equal(forged.status, 403);
  const denied = await f.request('/api/rpc', { method: 'POST', token: 'operator', payload: { channel: 'state-set', payload: { key: 'sigma_leads', value: '[]', revision: 0 } } });
  assert.equal(denied.status, 403);
  assert.equal((await f.request('/api/session', { token: 'operator' })).json().state, null);
});
test('HTTP expõe tarefas somente ao proprietário que iniciou a execução', async t => {
  const f = fixture(t);
  const response = await f.request('/api/rpc', { method: 'POST', payload: { channel: 'start-scrape', payload: { query: 'Empresa', queryId: 'http-search' } } });
  assert.equal(response.status, 202);
  const { taskId } = response.json();
  await new Promise(resolve => setImmediate(resolve));
  const completed = await f.request(`/api/tasks/${taskId}`);
  assert.equal(completed.json().status, 'completed');
  assert.equal(completed.json().result.count, 1);
  assert.equal((await f.request(`/api/tasks/${taskId}`, { token: 'operator' })).status, 404);
});
test('HTTP gera ponte de compatibilidade sem carregar Electron no navegador', async t => {
  const f = fixture(t);
  const response = await f.request('/web-preload.js');
  assert.equal(response.status, 200);
  assert.match(response.text, /window.sigmaTransport/);
  assert.doesNotMatch(response.text, /require\("electron"\)/);
});
