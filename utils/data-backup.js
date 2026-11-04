const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_KEYS = ['sigma_leads', 'sigma_searches', 'sigma_groups', 'sigma_history', 'sigma_analysis', 'sigma_leads_initialized', 'sigma_whatsapp_reminders'];
const DATA_FILES = ['lead-scoring/prospecting-leads.json', 'lead-scoring/prospecting-groups.json', 'kanban.json', 'campaigns.json'];
function checksum(data) { return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'); }
function createBackup(root, localStorage = {}, operations = {}) {
  const data = { localStorage: {}, files: {}, operations };
  for (const key of DATA_KEYS) if (typeof localStorage[key] === 'string') data.localStorage[key] = localStorage[key];
  for (const file of DATA_FILES) {
    const target = path.join(root, file);
    if (fs.existsSync(target)) data.files[file] = JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  return { format: 'sigma-data-backup', version: 1, createdAt: new Date().toISOString(), data, checksum: checksum(data) };
}
function validateBackup(bundle) {
  if (bundle?.format !== 'sigma-data-backup' || bundle.version !== 1 || !bundle.data || bundle.checksum !== checksum(bundle.data)) throw new Error('Backup inválido ou incompleto: a verificação de integridade falhou.');
  const { localStorage, files } = bundle.data;
  if (bundle.data.operations != null && (typeof bundle.data.operations !== 'object' || Array.isArray(bundle.data.operations))) throw new Error('Acompanhamentos inválidos no backup.');
  if (!localStorage || !files || Array.isArray(localStorage) || Array.isArray(files)) throw new Error('Estrutura de backup inválida.');
  if (Object.keys(localStorage).some(key => !DATA_KEYS.includes(key)) || Object.keys(files).some(file => !DATA_FILES.includes(file))) throw new Error('O backup contém dados não reconhecidos.');
  for (const [key, value] of Object.entries(localStorage)) {
    if (typeof value !== 'string') throw new Error(`Dados inválidos: ${key}.`);
    if (key !== 'sigma_leads_initialized') {
      const parsed = JSON.parse(value);
      if (['sigma_leads', 'sigma_searches', 'sigma_groups', 'sigma_whatsapp_reminders'].includes(key) && !Array.isArray(parsed)) throw new Error(`Lista inválida: ${key}.`);
    }
  }
  for (const [file, value] of Object.entries(files)) if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Arquivo inválido: ${file}.`);
  return bundle.data;
}
module.exports = { DATA_FILES, DATA_KEYS, createBackup, validateBackup, checksum };
