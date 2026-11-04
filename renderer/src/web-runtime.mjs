import { readWebResponse } from './web-response.mjs';

const SHARED = new Set(['sigma_leads', 'sigma_searches', 'sigma_groups', 'sigma_history', 'sigma_analysis', 'sigma_leads_initialized', 'sigma_whatsapp_reminders']);

export function saveDownload(download) {
  const bytes = Uint8Array.from(atob(download.base64), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: download.mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function initializeWeb() {
  if (window.electronAPI) return null;
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    return readWebResponse(response);
  }
  const session = await request('/api/session');
  let state = session.state || { revision: 0, values: {} };
  let cache = { ...state.values };
  let queue = Promise.resolve();
  let pending = 0;
  let blocked = false;
  const listeners = new Map();
  function notify(channel, payload) { for (const listener of listeners.get(channel) || []) listener(null, payload); }
  async function rpc(channel, payload = {}) {
    let result = await request('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sigma-Request': '1' }, body: JSON.stringify({ channel, payload }) });
    if (result.taskId) {
      const id = result.taskId;
      do {
        await new Promise(resolve => setTimeout(resolve, 1200));
        result = await request(`/api/tasks/${encodeURIComponent(id)}`);
      } while (result.status === 'running');
      if (result.status === 'failed') throw Object.assign(new Error(result.error), { code: result.code });
      result = result.result;
      if (!pending) await refreshState();
    }
    if (result.download) saveDownload(result.download);
    return result;
  }
  async function refreshState() {
    if (session.user.role !== 'owner' || pending || blocked) return;
    const snapshot = await request('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sigma-Request': '1' }, body: JSON.stringify({ channel: 'state-get' }) });
    if (pending || blocked) return;
    if (snapshot.revision !== state.revision) {
      state = snapshot;
      cache = { ...snapshot.values };
      window.dispatchEvent(new CustomEvent('sigma:leads-updated'));
    }
  }
  function fail(error) {
    blocked = true;
    window.dispatchEvent(new CustomEvent('sigma:web-conflict', { detail: error.message }));
  }
  // Adaptador para as telas desktop existentes. Dados compartilhados ficam
  // em memória nesta aba; cada escrita exige a revisão atual no servidor.
  const original = { get: Storage.prototype.getItem, set: Storage.prototype.setItem, remove: Storage.prototype.removeItem, clear: Storage.prototype.clear };
  Storage.prototype.getItem = function(key) { return this === localStorage && SHARED.has(key) ? cache[key] ?? null : original.get.call(this, key); };
  function write(key, value) {
    if (session.user.role !== 'owner') throw new Error('Somente o proprietário pode alterar a base.');
    if (blocked) throw new Error('Recarregue os dados antes de continuar.');
    if (cache[key] === value) return;
    cache[key] = value;
    pending++;
    queue = queue.then(async () => {
      if (blocked) return;
      const result = await rpc('state-set', { key, value, revision: state.revision });
      state = result;
    }).catch(fail).finally(() => { pending--; });
  }
  Storage.prototype.setItem = function(key, value) { if (this === localStorage && SHARED.has(key)) write(key, String(value)); else original.set.call(this, key, value); };
  Storage.prototype.removeItem = function(key) {
    if (this === localStorage && SHARED.has(key)) write(key, key === 'sigma_leads_initialized' ? 'true' : ['sigma_history', 'sigma_analysis'].includes(key) ? '{}' : '[]');
    else original.remove.call(this, key);
  };
  Storage.prototype.clear = function() { if (this === localStorage) throw new Error('Use as ações de limpeza da base.'); return original.clear.call(this); };
  const local = async (channel, p = {}) => {
    if (['open-external', 'open-site-window'].includes(channel)) {
      const url = new URL(p.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL inválida.');
      window.open(url.href, '_blank', 'noopener,noreferrer');
      return { success: true };
    }
    if (channel === 'reload-ui') { location.reload(); return { success: true }; }
    if (channel === 'ui-zoom-get') return Number(original.get.call(localStorage, 'sigma_web_zoom') || 1);
    if (channel === 'ui-zoom-set' || channel === 'ui-zoom-reset') { const zoom = channel.endsWith('reset') ? 1 : Math.max(0.8, Math.min(1.5, Number(p.zoom) || 1)); original.set.call(localStorage, 'sigma_web_zoom', String(zoom)); return zoom; }
    if (channel.startsWith('win-')) return false;
    if (channel === 'theme-get') return original.get.call(localStorage, 'sigma-theme') || 'light';
    if (channel === 'theme-set') { original.set.call(localStorage, 'sigma-theme', p.theme); return { success: true }; }
    return rpc(channel, p);
  };
  window.sigmaTransport = {
    contextBridge: { exposeInMainWorld: (name, api) => { window[name] = api; } },
    ipcRenderer: {
      invoke: async (channel, payload) => { try { return await local(channel, payload); } catch (error) { return { success: false, error: error.message, code: error.code }; } },
      on: (channel, callback) => { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(callback); },
      removeListener: (channel, callback) => listeners.get(channel)?.delete(callback),
    },
  };
  await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/web-preload.js'; script.onload = resolve; script.onerror = () => reject(new Error('Não foi possível carregar o Sigma.')); document.head.append(script);
  });
  window.sigmaWeb = { session, call: rpc, refreshState, flush: () => queue, draft: () => ({ ...cache }) };
  document.documentElement.classList.add('sigma-web');
  const events = new EventSource('/api/events');
  events.onmessage = event => {
    const { channel, payload } = JSON.parse(event.data);
    notify(channel, payload);
    if (channel === 'changed') {
      refreshState().catch(error => window.dispatchEvent(new CustomEvent('sigma:web-session-error', { detail: error.message })));
      window.dispatchEvent(new CustomEvent('sigma:web-changed'));
    }
  };
  setInterval(() => refreshState().catch(error => window.dispatchEvent(new CustomEvent('sigma:web-session-error', { detail: error.message }))), 10000);
  return session;
}
