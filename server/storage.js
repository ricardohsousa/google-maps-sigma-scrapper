const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { httpError } = require('./access');

function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Não foi possível ler ${path.basename(file)}; restaure um backup antes de iniciar.`); }
}
const SHARED_KEYS = new Set(['sigma_leads', 'sigma_searches', 'sigma_groups', 'sigma_history', 'sigma_analysis', 'sigma_leads_initialized', 'sigma_whatsapp_reminders']);
class SharedStore {
  constructor(root) {
    this.file = path.join(root, 'web-state.json');
    this.state = read(this.file, { revision: 0, values: { sigma_leads: '[]', sigma_searches: '[]', sigma_groups: '[]', sigma_leads_initialized: 'true' }, operations: {} });
    if (!this.state || !Number.isInteger(this.state.revision) || !this.state.values || !this.state.operations || Array.isArray(this.state.values) || Array.isArray(this.state.operations)) throw new Error('Estado web inválido; restaure um backup antes de iniciar.');
  }
  snapshot() { return { revision: this.state.revision, values: { ...this.state.values } }; }
  array(key) { try { const value = JSON.parse(this.state.values[key] || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  save() { this.state.revision++; atomic(this.file, this.state); }
  set(key, value, revision) {
    if (!SHARED_KEYS.has(key)) throw httpError(400, 'Chave de dados não permitida.');
    if (revision !== this.state.revision) throw httpError(409, 'A base foi atualizada em outra sessão. Recarregue antes de alterar.', 'STATE_CONFLICT');
    if (typeof value !== 'string' || Buffer.byteLength(value) > 30 * 1024 * 1024) throw httpError(400, 'Dados inválidos ou muito grandes.');
    if (key !== 'sigma_leads_initialized') {
      const parsed = JSON.parse(value);
      if (['sigma_leads', 'sigma_searches', 'sigma_groups', 'sigma_whatsapp_reminders'].includes(key) && !Array.isArray(parsed)) throw httpError(400, 'Esperada uma lista de dados.');
    }
    this.state.values[key] = value;
    this.save();
    return this.snapshot();
  }
}
class Users {
  constructor(root, ownerEmail) {
    this.file = path.join(root, 'web-users.json');
    const existed = fs.existsSync(this.file);
    this.users = read(this.file, null);
    if (existed && (!Array.isArray(this.users) || !this.users.some(user => user?.active && user.role === 'owner')
      || this.users.some(user => !user || !user.id || typeof user.email !== 'string' || !['owner', 'operator'].includes(user.role) || typeof user.active !== 'boolean')
      || new Set(this.users.map(user => user.email)).size !== this.users.length)) throw new Error('Cadastro de usuários inválido; restaure o arquivo antes de iniciar.');
    if (!this.users) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail || '')) throw new Error('Configure SIGMA_OWNER_EMAIL para cadastrar o proprietário inicial.');
      this.users = [{ id: crypto.randomUUID(), email: ownerEmail.trim().toLowerCase(), role: 'owner', active: true, sub: null }];
      atomic(this.file, this.users);
    }
  }
  resolve(identity) {
    const user = this.users.find(item => item.email === identity.email && item.active);
    if (!user || (user.sub && user.sub !== identity.sub)) throw httpError(403, 'Seu usuário não está autorizado no Sigma.', 'FORBIDDEN');
    if (!user.sub) { user.sub = identity.sub; atomic(this.file, this.users); }
    return { ...user };
  }
  list() { return this.users.map(({ sub, ...user }) => user); }
  update({ email, role, active }) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || !['owner', 'operator'].includes(role) || typeof active !== 'boolean') throw httpError(400, 'Informe e-mail, perfil e estado válidos.');
    email = email.trim().toLowerCase();
    const current = this.users.find(user => user.email === email);
    if (current?.role === 'owner' && current.active && (role !== 'owner' || !active) && this.users.filter(user => user.role === 'owner' && user.active).length === 1) throw httpError(409, 'Mantenha pelo menos um proprietário ativo.');
    if (current) Object.assign(current, { role, active });
    else this.users.push({ id: crypto.randomUUID(), email, role, active, sub: null });
    atomic(this.file, this.users);
    return this.list();
  }
}
module.exports = { atomic, read, SharedStore, Users, SHARED_KEYS };
