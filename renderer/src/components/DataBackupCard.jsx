import React, { useState } from 'react';

export default function DataBackupCard() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (window.sigmaWeb || !window.electronAPI?.exportDataBackup) return null;
  const backup = async () => {
    setBusy(true); setMessage('');
    try {
      const values = {};
      for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith('sigma_')) values[key] = localStorage.getItem(key); }
      const result = await window.electronAPI.exportDataBackup(values);
      if (!result?.success) { if (!result?.cancelled) throw new Error(result?.error || 'Não foi possível exportar.'); }
      else setMessage('Backup exportado. A base desta instalação continua disponível.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <section className="settings-update-card"><h2>Backup e migração</h2><p>Exporte leads, histórico de extrações, análises, grupos, Kanban e campanhas para importar na versão web.</p><button className="btn btn-secondary" type="button" disabled={busy} onClick={backup}>{busy ? 'Exportando…' : 'Exportar backup dos dados'}</button><p role="status">{message}</p></section>;
}
