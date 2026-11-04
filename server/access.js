const crypto = require('node:crypto');

function httpError(status, message, code = 'REQUEST_FAILED') {
  return Object.assign(new Error(message), { status, code });
}

function createAccessVerifier({ issuer, audience, fetcher = fetch, now = () => Date.now() }) {
  let url;
  try { url = new URL(issuer); } catch { throw new Error('Configure SIGMA_ACCESS_ISSUER.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.cloudflareaccess.com') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new Error('SIGMA_ACCESS_ISSUER deve ser https://EQUIPE.cloudflareaccess.com.');
  }
  if (!audience || typeof audience !== 'string') throw new Error('Configure SIGMA_ACCESS_AUD.');
  const expectedIssuer = url.origin;
  let keys = new Map();
  let expiresAt = 0;
  let lastRefresh = -Infinity;
  let refreshing;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      lastRefresh = now();
      const response = await fetcher(`${expectedIssuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) throw httpError(503, 'Não foi possível validar o acesso. Tente novamente.', 'IDENTITY_UNAVAILABLE');
      const document = await response.json();
      const next = new Map();
      for (const jwk of document.keys || []) {
        if (jwk.kty !== 'RSA' || !jwk.kid || (jwk.alg && jwk.alg !== 'RS256') || (jwk.use && jwk.use !== 'sig')) continue;
        if (Buffer.from(jwk.n || '', 'base64url').length < 256) continue;
        next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
      }
      if (!next.size) throw httpError(503, 'Chaves de autenticação indisponíveis.', 'IDENTITY_UNAVAILABLE');
      keys = next;
      expiresAt = now() + 300000;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  return async function verify(token) {
    const denied = () => httpError(401, 'Entre novamente pelo Cloudflare Access.', 'UNAUTHENTICATED');
    if (typeof token !== 'string' || token.length > 16384) throw denied();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw denied();
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch { throw denied(); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) throw denied();
    try {
      if (now() >= expiresAt || (!keys.has(header.kid) && now() - lastRefresh > 30000)) await refresh();
    } catch (error) {
      if (error.status) throw error;
      throw httpError(503, 'Autenticação temporariamente indisponível.', 'IDENTITY_UNAVAILABLE');
    }
    const key = keys.get(header.kid);
    if (!key || !crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw denied();
    const seconds = now() / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== expectedIssuer || !audiences.includes(audience) || !Number.isFinite(claims.exp) || claims.exp <= seconds
      || (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 30))
      || typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email.includes('@')
      || claims.type !== 'app') throw denied();
    return { sub: claims.sub, email: claims.email.trim().toLowerCase(), exp: claims.exp };
  };
}

const OPERATOR_CHANNELS = new Set([
  'session-get', 'leads-list', 'lead-operation-update', 'kanban-get-board',
  'kanban-move-card', 'lead-scoring-get-all', 'lead-scoring-get-lead',
]);
function authorize(user, channel) {
  if (!user?.active || !['owner', 'operator'].includes(user.role)) throw httpError(403, 'Seu usuário não tem acesso ao Sigma.', 'FORBIDDEN');
  if (user.role !== 'owner' && !OPERATOR_CHANNELS.has(channel)) throw httpError(403, 'Esta ação é exclusiva do proprietário.', 'FORBIDDEN');
}
function exactFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Dados inválidos.');
  if (Object.keys(value).some(key => !allowed.includes(key))) throw httpError(403, 'A alteração contém campos não permitidos.', 'FORBIDDEN_FIELD');
  return value;
}
module.exports = { createAccessVerifier, authorize, exactFields, httpError };
