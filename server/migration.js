const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBackup, validateBackup, DATA_FILES } = require('../utils/data-backup');
const { atomic } = require('./storage');

function recordKey(item) {
  if (item && typeof item === 'object') return String(item.id || item.googleMapsUrl || crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'));
  return JSON.stringify(item);
}
function mergeList(current, incoming) {
  const map = new Map(current.map(item => [recordKey(item), item]));
  let added = 0, conflicts = 0;
  for (const item of incoming) {
    const key = recordKey(item);
    if (!map.has(key)) { map.set(key, item); added++; }
    else if (JSON.stringify(map.get(key)) !== JSON.stringify(item)) conflicts++;
  }
  return { value: [...map.values()], added, conflicts };
}
function rejectUnsafeKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('O backup contém uma chave inválida.');
    rejectUnsafeKeys(value[key]);
  }
}
function prepareImport(root, store, bundle) {
  const data = validateBackup(bundle);
  rejectUnsafeKeys(data);
  const next = structuredClone(store.state);
  next.operations = { ...(data.operations || {}), ...next.operations };
  const files = {};
  const report = { checksum: bundle.checksum, leadsAdded: 0, analysesAdded: 0, groupsAdded: 0, cardsAdded: 0, conflictsPreserved: 0 };
  for (const [key, serialized] of Object.entries(data.localStorage)) {
    if (key === 'sigma_leads_initialized') { next.values[key] = 'true'; continue; }
    const incoming = JSON.parse(serialized);
    const current = JSON.parse(next.values[key] || (Array.isArray(incoming) ? '[]' : '{}'));
    if (Array.isArray(incoming) && Array.isArray(current)) {
      const result = mergeList(current, incoming);
      next.values[key] = JSON.stringify(result.value);
      report.conflictsPreserved += result.conflicts;
      if (key === 'sigma_leads') report.leadsAdded += result.added;
      if (key === 'sigma_groups') report.groupsAdded += result.added;
    } else if (!Object.hasOwn(next.values, key)) next.values[key] = serialized;
    else if (next.values[key] !== serialized) report.conflictsPreserved++;
  }
  for (const [file, incoming] of Object.entries(data.files)) {
    const target = path.join(root, file);
    const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
    if (file === 'kanban.json') {
      if (!incoming.board || !Array.isArray(incoming.board.columns) || !incoming.cards || !incoming.entities) throw new Error('Kanban inválido no backup.');
      const empty = !Object.keys(current.cards || {}).length;
      files[file] = empty ? incoming : { ...current, entities: { ...incoming.entities, ...current.entities }, cards: { ...incoming.cards, ...current.cards } };
      // IDs de colunas importados precisam existir na configuração preservada.
      if (!empty) {
        const known = new Set(current.board.columns.map(column => column.id));
        for (const column of incoming.board.columns) if (!known.has(column.id)) { files[file].board = { ...files[file].board, columns: [...files[file].board.columns, column] }; known.add(column.id); }
      }
      report.cardsAdded += Object.keys(incoming.cards).filter(id => !Object.hasOwn(current.cards || {}, id)).length;
      report.conflictsPreserved += Object.keys(incoming.cards).filter(id => Object.hasOwn(current.cards || {}, id) && JSON.stringify(current.cards[id]) !== JSON.stringify(incoming.cards[id])).length;
    } else {
      files[file] = { ...incoming, ...current };
      const added = Object.keys(incoming).filter(id => !Object.hasOwn(current, id)).length;
      if (file.includes('prospecting-leads')) report.analysesAdded += added;
      if (file.includes('prospecting-groups')) report.groupsAdded += added;
      report.conflictsPreserved += Object.keys(incoming).filter(id => Object.hasOwn(current, id) && JSON.stringify(current[id]) !== JSON.stringify(incoming[id])).length;
    }
  }
  return { next, files, report };
}
function importBackup(root, store, bundle, reload) {
  const { next, files, report } = prepareImport(root, store, bundle);
  const backupDir = path.join(root, 'migration-backups', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  // Conserva o arquivo recebido e o estado anterior, inclusive operações web.
  atomic(path.join(backupDir, 'received.json'), bundle);
  atomic(path.join(backupDir, 'before.json'), createBackup(root, store.state.values, store.state.operations));
  atomic(path.join(backupDir, 'web-state.json'), store.state);
  const previousState = structuredClone(store.state);
  const previousFiles = new Map(DATA_FILES.map(file => {
    const target = path.join(root, file);
    return [file, fs.existsSync(target) ? fs.readFileSync(target) : null];
  }));
  try {
    for (const [file, value] of Object.entries(files)) atomic(path.join(root, file), value);
    store.state = next;
    store.save();
    reload();
  } catch (error) {
    for (const [file, content] of previousFiles) {
      const target = path.join(root, file);
      if (content) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, { mode: 0o600 }); }
      else fs.rmSync(target, { force: true });
    }
    store.state = previousState;
    atomic(store.file, previousState);
    reload();
    throw error;
  }
  return { ...report, backupId: path.basename(backupDir) };
}
module.exports = { prepareImport, importBackup, mergeList };
