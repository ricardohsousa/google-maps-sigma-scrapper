const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAccessVerifier } = require('../server/access');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const seconds = 1900000000;
const claims = { iss: 'https://sigma-test.cloudflareaccess.com', aud: ['sigma-aud'], type: 'app', sub: 'identity-1', email: 'Owner@Example.com', exp: seconds + 300 };
function token(patch = {}, headerPatch = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', ...headerPatch })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...claims, ...patch })).toString('base64url');
  return `${header}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url')}`;
}
function verifier(fetcher = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })) {
  return createAccessVerifier({ issuer: claims.iss, audience: 'sigma-aud', now: () => seconds * 1000, fetcher });
}
test('Access valida assinatura, audiência e identidade e mantém cache das chaves', async () => {
  let requests = 0;
  const verify = verifier(async url => { requests++; assert.equal(url, `${claims.iss}/cdn-cgi/access/certs`); return { ok: true, json: async () => ({ keys: [jwk] }) }; });
  assert.deepEqual(await verify(token()), { sub: claims.sub, email: 'owner@example.com', exp: claims.exp });
  await verify(token());
  assert.equal(requests, 1);
});
for (const [name, patch] of Object.entries({ expirado: { exp: seconds }, audiencia: { aud: ['outro-app'] }, emissor: { iss: 'https://outro.cloudflareaccess.com' }, futuro: { nbf: seconds + 1000 }, servico: { email: undefined }, tipo: { type: 'org' } })) {
  test(`Access rejeita token com ${name} inválido`, async () => { await assert.rejects(verifier()(token(patch)), error => error.status === 401); });
}
test('Access rejeita assinatura adulterada e algoritmos não permitidos', async () => {
  const signed = token();
  const [header, body, signature] = signed.split('.');
  const altered = Buffer.from(JSON.stringify({ ...claims, email: 'attacker@example.com' })).toString('base64url');
  await assert.rejects(verifier()(`${header}.${altered}.${signature}`), error => error.status === 401);
  await assert.rejects(verifier()(token({}, { alg: 'none' })), error => error.status === 401);
  await assert.rejects(verifier()(undefined), error => error.status === 401);
});
test('Access falha fechado quando a Cloudflare não fornece chaves válidas', async () => {
  await assert.rejects(verifier(async () => ({ ok: false }))(token()), error => error.status === 503);
  assert.throws(() => createAccessVerifier({ issuer: 'http://localhost', audience: 'aud' }));
});
module.exports = { token, claims, publicKey };
