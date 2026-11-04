const http = require('node:http');
const path = require('node:path');
const { createAccessVerifier } = require('./access');
const { SigmaService } = require('./service');
const { createApp } = require('./http');

function start() {
  const origin = new URL(process.env.SIGMA_PUBLIC_ORIGIN || 'https://sigma.ricardohenrique.com').origin;
  const verify = createAccessVerifier({ issuer: process.env.SIGMA_ACCESS_ISSUER, audience: process.env.SIGMA_ACCESS_AUD });
  const service = new SigmaService({ root: path.resolve(process.env.SIGMA_DATA_DIR || './sigma-data'), ownerEmail: process.env.SIGMA_OWNER_EMAIL });
  const handler = createApp({ service, verify, origin });
  const server = http.createServer(handler);
  server.requestTimeout = 90000;
  server.listen(Number(process.env.PORT || 3000), process.env.SIGMA_BIND || '127.0.0.1', () => console.log('Sigma web iniciado com autenticação Cloudflare Access.'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    handler.close();
    for (const token of service.activeScrapes.values()) token.cancelled = true;
    for (const id of service.scoring.activeJobs.keys()) service.scoring.cancel(id);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 30000).unref();
  });
  return server;
}
if (require.main === module) {
  try { start(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { start };
