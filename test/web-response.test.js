const test = require('node:test');
const assert = require('node:assert/strict');

test('cliente diferencia bloqueio HTML da Cloudflare de erro JSON do Sigma', async () => {
  const { readWebResponse } = await import('../renderer/src/web-response.mjs');
  const html = new Response('<html>Blocked</html>', { status: 403, headers: { 'Content-Type': 'text/html', 'cf-ray': 'test-ray' } });
  await assert.rejects(readWebResponse(html), error => error.code === 'EDGE_FORBIDDEN' && error.status === 403 && error.message.includes('test-ray'));
  const json = new Response(JSON.stringify({ success: false, code: 'BAD_ORIGIN', error: 'Abra o domínio configurado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(readWebResponse(json), error => error.code === 'BAD_ORIGIN' && error.message === 'Abra o domínio configurado.');
});
test('cliente identifica challenge e sessão expirada sem mostrar o HTML remoto', async () => {
  const { readWebResponse } = await import('../renderer/src/web-response.mjs');
  const challenge = new Response('<html>PRIVATE_CHALLENGE_BODY</html>', { status: 403, headers: { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' } });
  await assert.rejects(readWebResponse(challenge), error => error.code === 'EDGE_CHALLENGE' && !error.message.includes('PRIVATE_CHALLENGE_BODY'));
  const expired = new Response('<html>Login</html>', { status: 401, headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(readWebResponse(expired), error => error.code === 'SESSION_EXPIRED');
});
test('cliente aceita JSON válido e preserva recusa de permissão do operador', async () => {
  const { readWebResponse } = await import('../renderer/src/web-response.mjs');
  const ok = new Response(JSON.stringify({ success: true, count: 10 }), { headers: { 'Content-Type': 'application/json' } });
  assert.equal((await readWebResponse(ok)).count, 10);
  const denied = new Response(JSON.stringify({ success: false, code: 'FORBIDDEN', error: 'Ação exclusiva do proprietário.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(readWebResponse(denied), error => error.code === 'FORBIDDEN' && error.status === 403);
});
