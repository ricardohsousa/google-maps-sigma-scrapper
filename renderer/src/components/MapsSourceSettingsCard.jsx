import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, KeyRound } from 'lucide-react';

/** Seção de Configurações: origem padrão da extração e chave da Places API. */
export default function MapsSourceSettingsCard() {
  const [settings, setSettings] = useState({ defaultSource: 'scraper', hasPlacesApiKey: false, placesApiKeyMask: '' });
  const [keyInput, setKeyInput] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.electronAPI?.getMapsSettings?.().then((s) => s && setSettings(s)).catch(() => {});
  }, []);

  const save = async (patch) => {
    const res = await window.electronAPI?.setMapsSettings?.(patch);
    if (res?.success) setSettings(res.settings);
    return res;
  };

  const saveKey = async () => {
    const key = keyInput.trim();
    if (!key || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const test = await window.electronAPI?.testPlacesApiKey?.(key);
      if (!test?.success) {
        setStatus({ ok: false, text: `Chave recusada pelo Google: ${test?.error || 'erro desconhecido'}` });
        return;
      }
      await save({ placesApiKey: key });
      setKeyInput('');
      setStatus({ ok: true, text: 'Chave validada e salva.' });
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    await save({ placesApiKey: '', defaultSource: 'scraper' });
    setStatus({ ok: true, text: 'Chave removida.' });
  };

  return (
    <section className="settings-update-card" aria-labelledby="mapsSourceTitle">
      <div className="settings-update-head">
        <div>
          <div className="eyebrow">Extração</div>
          <h2 id="mapsSourceTitle">Origem dos dados do Maps</h2>
          <p>
            O scraper abre o Google Maps num navegador oculto. A API oficial (Places API) é mais rápida e estável,
            traz até 60 empresas por busca e é cobrada na sua conta Google Cloud.
          </p>
        </div>
      </div>

      <div className="field">
        <label>Origem padrão em novas extrações</label>
        <div className="extraction-source" role="group" aria-label="Origem padrão">
          <button type="button" className={settings.defaultSource === 'scraper' ? 'active' : ''} aria-pressed={settings.defaultSource === 'scraper'} onClick={() => save({ defaultSource: 'scraper' })}>
            Scraper do Maps
          </button>
          <button
            type="button"
            className={settings.defaultSource === 'places-api' ? 'active' : ''}
            aria-pressed={settings.defaultSource === 'places-api'}
            disabled={!settings.hasPlacesApiKey}
            title={settings.hasPlacesApiKey ? undefined : 'Salve uma chave primeiro'}
            onClick={() => save({ defaultSource: 'places-api' })}
          >
            API oficial (Places)
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="placesApiKey">Chave da Google Places API (New)</label>
        <div className="settings-maps-key">
          <input
            id="placesApiKey"
            type="password"
            autoComplete="off"
            placeholder={settings.hasPlacesApiKey ? `Salva: ${settings.placesApiKeyMask}` : 'AIza…'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
          />
          <button type="button" className="btn btn-primary" disabled={!keyInput.trim() || busy} onClick={saveKey}>
            <KeyRound size={14} /> {busy ? 'Validando…' : 'Validar e salvar'}
          </button>
          {settings.hasPlacesApiKey ? (
            <button type="button" className="btn btn-secondary" onClick={removeKey}>Remover</button>
          ) : null}
        </div>
      </div>

      {status ? (
        <p className={`settings-update-status ${status.ok ? '' : 'warn'}`} role="status">
          {status.ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />} {status.text}
        </p>
      ) : null}
    </section>
  );
}
