const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { httpError, authorize } = require('./access');

const BACKGROUND = new Set(['start-scrape', 'lead-scoring-analyze-lead', 'lead-scoring-analyze-batch', 'repair-map-addresses']);
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw httpError(415, 'Use JSON para esta requisição.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024) throw httpError(413, 'O arquivo excede o limite de 64 MiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'JSON inválido.'); }
}
function createApp({ service, verify, origin, dist = path.join(__dirname, '../renderer/dist') }) {
  const clients = new Set();
  const tasks = new Map();
  const priorEmit = service.emit;
  service.emit = (channel, payload) => {
    priorEmit(channel, payload);
    for (const client of clients) {
      const current = service.users.users.find(user => user.id === client.user.id && user.active);
      if (!current || current.role !== client.user.role || Date.now() / 1000 >= client.identity.exp) { client.res.end(); clients.delete(client); continue; }
      if (current.role === 'owner' || channel === 'changed') client.res.write(`data: ${JSON.stringify({ channel, payload })}\n\n`);
    }
  };
  async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Os tiles OSM exigem Referer. Em HTTPS externo, enviar apenas a origem,
    // sem caminho, parâmetros do Access ou dados da tela.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self' https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    try {
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
      const identity = await verify(req.headers['cf-access-jwt-assertion']);
      const user = service.users.resolve(identity);
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['x-sigma-request'] !== '1') throw httpError(403, `Origem da requisição não autorizada. Abra o Sigma por ${origin} e entre novamente.`, 'BAD_ORIGIN');
        if (url.pathname !== '/api/rpc') throw httpError(404, 'Rota não encontrada.');
        const input = await body(req);
        if (typeof input?.channel !== 'string') throw httpError(400, 'Informe a ação.');
        authorize(user, input.channel);
        if (BACKGROUND.has(input.channel)) {
          for (const [id, task] of tasks) if (Date.now() - task.createdAt > 1800000 && task.status !== 'running') tasks.delete(id);
          if ([...tasks.values()].filter(task => task.status === 'running').length >= 4 || tasks.size >= 100) throw httpError(429, 'Aguarde as tarefas atuais terminarem.');
          const taskId = crypto.randomUUID();
          const task = { userId: user.id, createdAt: Date.now(), status: 'running' };
          tasks.set(taskId, task);
          Promise.resolve().then(() => service.dispatch(user, input.channel, input.payload)).then(
            result => Object.assign(task, { status: 'completed', result }),
            error => Object.assign(task, { status: 'failed', error: error.message, code: error.code || 'JOB_FAILED' }),
          );
          return json(res, 202, { success: true, taskId });
        }
        return json(res, 200, await service.dispatch(user, input.channel, input.payload));
      }
      if (req.method !== 'GET') throw httpError(405, 'Método não permitido.');
      if (url.pathname === '/api/session') return json(res, 200, service.session(user));
      if (url.pathname.startsWith('/api/tasks/')) {
        const task = tasks.get(url.pathname.slice('/api/tasks/'.length));
        if (user.role !== 'owner' || !task || task.userId !== user.id) throw httpError(404, 'Tarefa não encontrada.');
        return json(res, 200, { success: true, status: task.status, result: task.result, error: task.error, code: task.code });
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        const client = { user, identity, res };
        clients.add(client);
        const timer = setInterval(() => {
          const current = service.users.users.find(item => item.id === user.id && item.active && item.role === user.role);
          if (!current || Date.now() / 1000 >= identity.exp) { res.end(); clearInterval(timer); clients.delete(client); }
          else res.write(': heartbeat\n\n');
        }, 15000);
        req.on('close', () => { clearInterval(timer); clients.delete(client); });
        return;
      }
      if (url.pathname === '/web-preload.js') {
        const source = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
        const first = 'const { contextBridge, ipcRenderer } = require("electron");';
        if (!source.startsWith(first)) throw new Error('A ponte do desktop mudou; revise a ponte web.');
        res.writeHead(200, { 'Content-Type': MIME['.js'] });
        return res.end(source.replace(first, 'const { contextBridge, ipcRenderer } = window.sigmaTransport;'));
      }
      if (url.pathname.startsWith('/api/')) throw httpError(404, 'Rota não encontrada.');
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(dist, `.${relative}`);
      if (!file.startsWith(`${path.resolve(dist)}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !MIME[path.extname(file)]) throw httpError(404, 'Arquivo não encontrado.');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.end();
      json(res, error.status || (error.code === 'KANBAN_CONFLICT' ? 409 : 400), { success: false, error: error.message || 'Não foi possível concluir a ação.', code: error.code || 'REQUEST_FAILED' });
    }
  }
  handler.close = () => { for (const client of clients) client.res.end(); clients.clear(); };
  return handler;
}
module.exports = { createApp };
