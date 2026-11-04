import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  EyeOff,
  Search,
  Menu,
  Minus,
  Square,
  X,
  LayoutDashboard,
  Map,
  Database,
  Sparkles,
  Kanban,
  MessageCircle,
  Settings2,
} from 'lucide-react';
import Overview from './components/Overview';
import MapScraperView from './components/MapScraperView';
import LeadsManager from './components/LeadsManager';
import LeadScoring from './components/LeadScoring';
import KanbanBoard from './components/KanbanBoard';
import WhatsAppPanel from './components/WhatsAppPanel';
import NewExtractionModal from './components/NewExtractionModal';
import OnboardingTour from './components/OnboardingTour';
import { NotificationProvider, useNotifications } from './components/NotificationCenter';
import UpdateBanner from './components/UpdateBanner';
import UpdateSettingsCard from './components/UpdateSettingsCard';
import MapsSourceSettingsCard from './components/MapsSourceSettingsCard';
import DataBackupCard from './components/DataBackupCard';
import { dedupeLeads, normalizeLeadCollection, readLocalArray } from './leadData';
import { splitBatchInput, buildExtractionTargets, MAX_MATRIX_TARGETS } from './batchSplit.mjs';

const WHATSAPP_ENABLED = __WHATSAPP_ENABLED__;
const WHATSAPP_TABS = ['whatsapp', 'campaigns'];
const isTabAvailable = (tab) => WHATSAPP_ENABLED || !WHATSAPP_TABS.includes(tab);

const EXTRACTION_JOBS_KEY = 'sigma_extraction_jobs';

function readExtractionJobs() {
  try {
    const raw = JSON.parse(localStorage.getItem(EXTRACTION_JOBS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeExtractionJobs(jobs) {
  try {
    localStorage.setItem(EXTRACTION_JOBS_KEY, JSON.stringify(Array.isArray(jobs) ? jobs : []));
  } catch {}
}

function updateExtractionJob(id, patch) {
  const jobs = readExtractionJobs();
  writeExtractionJobs(jobs.map((job) => (
    String(job?.id) === String(id) ? { ...job, ...patch, updatedAt: Date.now() } : job
  )));
}

function remainingJobTargets(job) {
  const done = new Set([...(job?.completedKeys || []), ...(job?.failedKeys || [])]);
  return (job?.targets || []).filter((target) => !done.has(target.key));
}

const CLEAR_DATA_OPTIONS = [
  { id: 'leads', label: 'Leads da base', hint: 'Empresas e contatos salvos' },
  { id: 'searches', label: 'Últimas extrações', hint: 'Histórico das buscas do Maps' },
  { id: 'groups', label: 'Grupos e listas', hint: 'Agrupamentos criados no app' },
  { id: 'history', label: 'Histórico local', hint: 'Registros auxiliares da instalação' },
  { id: 'analysis', label: 'Análises e scoring', hint: 'Resultados e pontuações salvas' },
  { id: 'kanban', label: 'Kanban e negócios', hint: 'Cards, etapas, valores e lembretes' },
  { id: 'campaigns', label: 'Histórico de campanhas', hint: 'Campanhas, envios e respostas salvos' },
  { id: 'whatsapp', label: 'Conversas do WhatsApp', hint: 'Histórico local; a sessão continua conectada' },
];

const DEFAULT_CLEAR_DATA_SELECTION = Object.fromEntries(CLEAR_DATA_OPTIONS.map(({ id }) => [id, true]));

function organizeStoredLeads() {
  const raw = readLocalArray('sigma_leads');
  const organized = normalizeLeadCollection(raw);
  try {
    if (organized.some((lead, index) => (
      lead?.category !== raw[index]?.category
      || lead?.address !== raw[index]?.address
      || Boolean(lead?.needsMapAddressRepair) !== Boolean(raw[index]?.needsMapAddressRepair)
    ))) {
      localStorage.setItem('sigma_leads', JSON.stringify(organized));
    }
  } catch {}
  return organized;
}

function readStoredSigmaData() {
  const snapshot = {};
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith('sigma_')) snapshot[key] = localStorage.getItem(key);
    }
  } catch {}
  return snapshot;
}

class ErrorBoundaryLite extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(`[UI ERROR] ${this.props.label || 'view'}:`, error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 30, color: 'var(--fg)', overflow: 'auto' }}>
          <h3 style={{ color: 'var(--danger)', marginTop: 0 }}>
            Erro ao carregar componente ({this.props.label || 'Tela'})
          </h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--surface-warm)', padding: 16, borderRadius: 8 }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Recarregar Tela
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function CommandPalette({ open, onClose, onNavigate, onNewExtraction }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setQ('');
    }
  }, [open]);
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onClose?.( !open ); }
      if (e.key === 'Escape' && open) onClose?.(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const items = [
    { id: 'scraper', label: 'Ir para Scraper Maps', desc: 'Mapa + feed de leads', icon: '◎', action: () => { onNavigate('scraper'); onClose(false); } },
    { id: 'overview', label: 'Ir para Visão Geral', desc: 'Centro de comando', icon: '▦', action: () => { onNavigate('overview'); onClose(false); } },
    { id: 'base', label: 'Ir para Base de Leads', desc: 'Filtrar, organizar e exportar', icon: '▤', action: () => { onNavigate('base'); onClose(false); } },
    { id: 'scoring', label: 'Ir para Lead Scoring', desc: 'Quem ligar primeiro', icon: '✦', action: () => { onNavigate('scoring'); onClose(false); } },
    { id: 'kanban', label: 'Ir para Kanban', desc: 'Funil comercial de todos os leads', icon: '▤', action: () => { onNavigate('kanban'); onClose(false); } },
    { id: 'whatsapp', label: 'Ir para WhatsApp', desc: 'Chats e campanhas', icon: '◐', action: () => { onNavigate('whatsapp'); onClose(false); } },
    { id: 'new', label: 'Nova Extração…', desc: 'Criar busca no Google Maps', icon: '＋', action: () => { onClose(false); onNewExtraction(); } },
  ].filter((item) => isTabAvailable(item.id));
  const filtered = q.trim() ? items.filter(i => (`${i.label} ${i.desc}`.toLowerCase().includes(q.toLowerCase()))) : items;
  return (
    <div className="overlay on" id="cmdkOv" data-od-id="cmdk" onClick={() => onClose(false)}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Busca global" onClick={e=>e.stopPropagation()}>
        <div className="cmdk-row">
          <span aria-hidden="true">⌕</span>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar leads, campanhas, ações…" />
          <span className="tag-lote">ESC</span>
        </div>
        <div className="cmdk-list">
          {filtered.length===0 ? <div className="empty"><b>Nenhum resultado</b><span>Tente outro termo.</span></div> : filtered.map(it=> (
            <button key={it.id} className="cmdk-item" onClick={it.action}>
              <span className="cmdk-ic">{it.icon}</span>
              <span style={{ minWidth:0 }}><b style={{ display:'block', fontSize:13 }}>{it.label}</b><span style={{ display:'block', fontSize:12, color:'var(--muted)' }}>{it.desc}</span></span>
            </button>
          ))}
        </div>
        <div className="cmdk-row" style={{ fontSize:11, color:'var(--muted)', gap:12 }}>
          <span><b>↵</b> selecionar</span><span><b>↑↓</b> navegar</span><span><b>⌘K</b> abrir/fechar</span>
        </div>
      </div>
    </div>
  );
}

function AppInner() {
  const [activeTab, setActiveTabRaw] = useState(() => {
    try { const h = location.hash.slice(1); if(['overview','scraper','base','scoring','kanban','whatsapp','settings'].includes(h) && isTabAvailable(h)) return h; } catch{}
    return 'overview';
  });
  const setActiveTab = useCallback((tab) => setActiveTabRaw(isTabAvailable(tab) ? tab : 'overview'), []);
  const [isNewExtractionOpen, setIsNewExtractionOpen] = useState(false);
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sigma_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [uiZoom, setUiZoom] = useState(1);
  const [streamingMode, setStreamingMode] = useState(() => {
    try { return localStorage.getItem('sigma_streaming_mode') === 'true'; } catch { return false; }
  });
  const [isClearLeadBaseOpen, setIsClearLeadBaseOpen] = useState(false);
  const [clearDataSelection, setClearDataSelection] = useState(() => ({ ...DEFAULT_CLEAR_DATA_SELECTION, whatsapp: false }));
  const [waStatus, setWaStatus] = useState('disconnected');
  const [leadsCount, setLeadsCount] = useState(() => dedupeLeads(organizeStoredLeads()).length);
  const [scoringCount, setScoringCount] = useState(0);
  const [activeExtraction, setActiveExtraction] = useState(null);

  const { addNotification } = useNotifications();
  const mapScraperRef = useRef(null);

  // O indicador global vive no shell do app, portanto não pode depender da
  // tela WhatsApp estar aberta para receber o snapshot das conexões.
  useEffect(() => {
    if (!window.whatsappAPI) return undefined;
    let mounted = true;
    const applyStatus = (payload) => {
      const data = payload?.data || payload || {};
      const aggregate = payload?.aggregateStatus || data.aggregateStatus;
      const anyConnected = payload?.anyConnected ?? data.anyConnected ?? data.connected;
      const next = aggregate || (anyConnected ? 'connected' : payload?.status || data.status || 'disconnected');
      if (mounted && next) setWaStatus(next);
    };
    const off = typeof window.whatsappAPI.onStatus === 'function'
      ? window.whatsappAPI.onStatus(applyStatus)
      : null;
    const refresh = async () => {
      try {
        const snapshot = await window.whatsappAPI.getStatus?.();
        if (mounted && snapshot) applyStatus(snapshot);
      } catch { /* status indisponível durante o boot; o evento seguinte atualiza */ }
    };
    refresh();
    return () => {
      mounted = false;
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const migrate = async () => {
      if (typeof window.electronAPI?.migrateExistingData !== 'function') return;
      try {
        const report = await window.electronAPI.migrateExistingData(readStoredSigmaData());
        if (cancelled || !report?.success) return;
        const updates = report.localStorageUpdates || {};
        Object.entries(updates).forEach(([key, value]) => {
          try { localStorage.setItem(key, value); } catch {}
        });
        if (Object.keys(updates).length) {
          window.dispatchEvent(new CustomEvent('sigma:leads-updated', { detail: { migrated: true } }));
        }
        if (report.changed) {
          addNotification({
            type: 'success',
            category: 'system',
            title: 'Base tratada',
            message: 'Dados antigos foram normalizados e continuam disponíveis no mapa, scoring e Kanban.',
          });
        }
      } catch (error) {
        console.warn('[DATA-MIGRATION] renderer:', error?.message || error);
      }
    };
    migrate();
    return () => { cancelled = true; };
  }, [addNotification]);

  // Persist hash + shortcuts ⌘1-5
  useEffect(()=>{ try{ history.replaceState(null,'','#'+activeTab); }catch{} }, [activeTab]);
  useEffect(() => {
    const onHashChange = () => {
      const next = String(location.hash || '').slice(1);
      if (['overview', 'scraper', 'base', 'scoring', 'kanban', 'whatsapp', 'settings'].includes(next)) setActiveTab(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(()=>{
    const onKey=(e)=>{
      if((e.metaKey||e.ctrlKey) && /^[1-6]$/.test(e.key)){
        e.preventDefault();
        const map=['overview','scraper','base','scoring','kanban','whatsapp'];
        const i=Number(e.key)-1; if(map[i]) setActiveTab(map[i]);
      }
      if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k' && activeTab === 'overview'){
        e.preventDefault();
        setIsCmdOpen(v=>!v);
      }
    };
    window.addEventListener('keydown', onKey);
    return()=> window.removeEventListener('keydown', onKey);
  }, [activeTab]);

  const updateUiZoom = useCallback(async (nextZoom) => {
    const safeZoom = Math.max(0.8, Math.min(1.5, Math.round(nextZoom * 100) / 100));
    try {
      const stored = await window.electronAPI?.setUiZoom?.(safeZoom);
      setUiZoom(typeof stored === 'number' ? stored : safeZoom);
    } catch {
      setUiZoom(safeZoom);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    window.electronAPI?.getUiZoom?.()
      ?.then((zoom) => { if (mounted && typeof zoom === 'number') setUiZoom(zoom); })
      ?.catch(() => {});
    const onZoomKey = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (['Equal', 'NumpadAdd'].includes(event.code)) {
        event.preventDefault();
        updateUiZoom(uiZoom + 0.1);
      } else if (['Minus', 'NumpadSubtract'].includes(event.code)) {
        event.preventDefault();
        updateUiZoom(uiZoom - 0.1);
      } else if (event.code === 'Digit0' || event.code === 'Numpad0') {
        event.preventDefault();
        updateUiZoom(1);
      }
    };
    window.addEventListener('keydown', onZoomKey);
    return () => {
      mounted = false;
      window.removeEventListener('keydown', onZoomKey);
    };
  }, [uiZoom, updateUiZoom]);

  useEffect(() => {
    try { localStorage.setItem('sigma_sidebar_collapsed', String(isSidebarCollapsed)); } catch {}
  }, [isSidebarCollapsed]);

  useEffect(() => {
    try { localStorage.setItem('sigma_streaming_mode', String(streamingMode)); } catch {}
    document.documentElement.setAttribute('data-streaming-mode', String(streamingMode));
  }, [streamingMode]);

  useEffect(() => {
    document.body.classList.toggle('side-collapsed', isSidebarCollapsed);
    document.body.classList.toggle('nav-open', isMobileNavOpen);
    document.body.classList.toggle('route-whatsapp', activeTab === 'whatsapp');
    document.body.classList.toggle('route-kanban', activeTab === 'kanban');
    return () => {
      document.body.classList.remove('side-collapsed', 'nav-open', 'route-whatsapp', 'route-kanban');
    };
  }, [isSidebarCollapsed, isMobileNavOpen, activeTab]);

  const navigate = (tab) => {
    setActiveTab(tab);
    setIsMobileNavOpen(false);
  };

  const handleMinimize = () => window.electronAPI?.winMinimize();
  const handleMaximize = () => window.electronAPI?.winMaximize();
  const handleClose = () => window.electronAPI?.winClose();

  const clearSelectedData = async () => {
    const selected = Object.entries(clearDataSelection).filter(([, checked]) => checked).map(([id]) => id);
    if (!selected.length) {
      addNotification({ type: 'info', category: 'system', title: 'Nada selecionado', message: 'Marque pelo menos um tipo de dado para limpar.' });
      return;
    }
    const count = dedupeLeads(normalizeLeadCollection(readLocalArray('sigma_leads'))).length;
    const localStorageKeys = {
      leads: 'sigma_leads',
      searches: 'sigma_searches',
      groups: 'sigma_groups',
      history: 'sigma_history',
      analysis: 'sigma_analysis',
    };
    selected.forEach((id) => {
      const key = localStorageKeys[id];
      if (key) {
        try { localStorage.removeItem(key); } catch {}
      }
    });
    if (clearDataSelection.leads) {
      // Evita que a tela de Base recrie dados de demonstração após uma limpeza explícita.
      try { localStorage.setItem('sigma_leads_initialized', 'true'); } catch {}
    }

    const cleanupTasks = [];
    if (clearDataSelection.analysis) cleanupTasks.push(window.leadScoringAPI?.clearAnalyses?.({ all: true }));
    if (clearDataSelection.kanban) cleanupTasks.push(window.kanbanAPI?.reset?.());
    if (clearDataSelection.campaigns) {
      cleanupTasks.push((async () => {
        const response = await window.campaignAPI?.getAll?.();
        const campaigns = Array.isArray(response) ? response : (response?.campaigns || []);
        await Promise.allSettled(campaigns.map((campaign) => window.campaignAPI?.delete?.(campaign.id)));
      })());
    }
    if (clearDataSelection.whatsapp) cleanupTasks.push(window.chatAPI?.clearHistory?.());
    const cleanup = await Promise.allSettled(cleanupTasks);
    const cleanupFailed = cleanup.some((result) => result.status === 'rejected' || result.value?.success === false);
    if (clearDataSelection.leads) setLeadsCount(0);
    if (clearDataSelection.analysis) setScoringCount(0);
    if (selected.some((id) => ['leads', 'searches', 'groups', 'history'].includes(id))) {
      window.dispatchEvent(new CustomEvent('sigma:leads-updated', { detail: { leads: [], searches: [] } }));
    }
    const selectedLabels = CLEAR_DATA_OPTIONS.filter(({ id }) => selected.includes(id)).map(({ label }) => label.toLowerCase());
    addNotification({
      type: cleanupFailed ? 'warning' : 'success',
      category: 'system',
      title: 'Dados locais limpos',
      message: cleanupFailed
        ? `${count} lead${count === 1 ? '' : 's'} e os itens selecionados foram processados. Parte dos dados não pôde ser limpa; reinicie o aplicativo e tente novamente.`
        : `${selectedLabels.join(', ')} removido${selectedLabels.length === 1 ? '' : 's'} desta instalação.`,
      duration: 5000,
    });
    setIsClearLeadBaseOpen(false);
  };

  const extractionRunningRef = useRef(false);

  const saveExtractionPartial = ({ searchId, newLeads, job }) => {
    const withIds = (Array.isArray(newLeads) ? newLeads : []).map((lead) => ({
      ...lead,
      searchId,
      id: lead.id || Math.random().toString(36).slice(2),
    }));
    const current = dedupeLeads(normalizeLeadCollection(readLocalArray('sigma_leads')));
    const combined = dedupeLeads(normalizeLeadCollection([...current, ...withIds]));
    const addedCount = Math.max(0, combined.length - current.length);
    const currentSearches = readLocalArray('sigma_searches');
    const record = {
      id: searchId,
      query: job.qstr,
      niche: job.niches[0] || '',
      niches: job.niches,
      neighborhoods: job.neighborhoods,
      municipality: job.municipality,
      uf: job.uf,
      label: job.label,
      source: 'maps',
      timestamp: Date.now(),
    };
    const nextSearches = currentSearches.some((search) => String(search?.id) === String(searchId))
      ? currentSearches.map((search) => (String(search?.id) === String(searchId) ? { ...search, timestamp: Date.now() } : search))
      : [...currentSearches, record];
    localStorage.setItem('sigma_leads', JSON.stringify(combined));
    localStorage.setItem('sigma_searches', JSON.stringify(nextSearches));
    setLeadsCount(dedupeLeads(combined).length);
    window.dispatchEvent(new CustomEvent('sigma:leads-updated', {
      detail: { leads: combined, searches: nextSearches },
    }));
    return addedCount;
  };

  const runExtractionJob = async (job, { navigate = true } = {}) => {
    const searchId = job.id;
    if (extractionRunningRef.current) return;
    if (!window.electronAPI || typeof window.electronAPI.startScrape !== 'function') {
      addNotification({ type: 'error', category: 'scraper', title: 'Extração indisponível', message: 'A ponte do desktop não está disponível. Reinicie o aplicativo.' });
      return;
    }
    extractionRunningRef.current = true;
    if (navigate) setActiveTab('scraper');
    const remaining = remainingJobTargets(job);
    const displayNeighborhoods = job.neighborhoods.length ? job.neighborhoods : [job.city || 'Pesquisa regional'];
    setActiveExtraction({
      id: searchId,
      query: job.qstr,
      startedAt: job.createdAt,
      niches: job.niches,
      neighborhoods: displayNeighborhoods,
      targets: job.targets,
      hasNeighborhoodPlan: job.neighborhoods.length > 0,
      completedNeighborhoods: [],
      completedKeys: [...(job.completedKeys || [])],
      failedNeighborhoods: [],
      failedKeys: [...(job.failedKeys || [])],
      currentNeighborhood: '',
      foundCount: job.foundCount || 0,
    });
    const warnings = [];
    let addedThisRun = 0;
    let cancelled = false;
    try {
      for (const target of remaining) {
        const display = target.neighborhood ? `${target.niche} — ${target.neighborhood}` : target.niche;
        const targetQuery = [target.niche, target.neighborhood, job.city].filter(Boolean).join(' ').trim();
        const flatIndex = Math.max(0, job.targets.findIndex((item) => item.key === target.key));
        setActiveExtraction((current) => (current && current.id === searchId
          ? { ...current, currentNeighborhood: display }
          : current));
        let res = null;
        try {
          res = await window.electronAPI.startScrape(targetQuery, job.limit, searchId, {
            neighborhood: display,
            neighborhoodIndex: flatIndex,
            totalNeighborhoods: job.targets.length,
            batchComplete: flatIndex === job.targets.length - 1,
          }, job.source);
        } catch (err) {
          res = { success: false, error: err?.message || 'Falha na busca.' };
        }
        if (!res?.success) {
          if (res?.cancelled) {
            cancelled = true;
            break;
          }
          warnings.push(`${display}: ${res?.error || 'sem resultados válidos'}`);
          const failedKeys = [...new Set([...(readExtractionJobs().find((item) => String(item?.id) === String(searchId))?.failedKeys || []), target.key])];
          updateExtractionJob(searchId, { failedKeys });
          setActiveExtraction((current) => (current && current.id === searchId
            ? { ...current, failedNeighborhoods: [...new Set([...current.failedNeighborhoods, display])], failedKeys: [...new Set([...current.failedKeys, target.key])] }
            : current));
          continue;
        }
        const targetLeads = Array.isArray(res.data) ? res.data : [];
        if (res.partial && Array.isArray(res.warnings)) warnings.push(...res.warnings);
        addedThisRun += saveExtractionPartial({ searchId, newLeads: targetLeads, job });
        const stored = readExtractionJobs().find((item) => String(item?.id) === String(searchId)) || {};
        const completedKeys = [...new Set([...(stored.completedKeys || []), target.key])];
        const foundCount = (stored.foundCount || 0) + targetLeads.length;
        updateExtractionJob(searchId, { completedKeys, foundCount });
        setActiveExtraction((current) => (current && current.id === searchId
          ? {
            ...current,
            completedNeighborhoods: [...new Set([...current.completedNeighborhoods, display])],
            completedKeys: [...new Set([...current.completedKeys, target.key])],
            foundCount,
          }
          : current));
      }

      if (cancelled) {
        updateExtractionJob(searchId, { status: 'cancelled' });
        addNotification({
          type: 'info',
          category: 'scraper',
          title: 'Extração pausada',
          message: `O que já foi coletado continua salvo na base (${addedThisRun} novos leads nesta sessão).`,
        });
        return;
      }
      const hadPriorProgress = (job.completedKeys || []).length > 0;
      if (addedThisRun === 0 && !hadPriorProgress) {
        throw new Error(warnings[0] || 'A busca foi concluída, mas não retornou leads válidos.');
      }
      updateExtractionJob(searchId, { status: 'done' });
      addNotification({
        type: warnings.length ? 'info' : 'success',
        category: 'scraper',
        title: warnings.length ? 'Extração concluída parcialmente' : 'Extração concluída',
        message: warnings.length
          ? `${addedThisRun} novos leads adicionados. ${warnings[0]}`
          : `${addedThisRun} novos leads adicionados à base.`,
        duration: 5000,
      });
    } catch (err) {
      addNotification({
        type: 'error',
        category: 'scraper',
        title: 'Erro na extração',
        message: err?.message || 'Não foi possível concluir a busca. Tente novamente.',
      });
    } finally {
      extractionRunningRef.current = false;
      setActiveExtraction(null);
    }
  };

  const handleStartExtraction = async ({ niche, niches, neigh, neighborhoods, city, limit, source }) => {
    if (activeExtraction || extractionRunningRef.current) {
      addNotification({
        type: 'info',
        category: 'scraper',
        title: 'Extração em andamento',
        message: 'Aguarde a busca atual terminar ou cancele-a antes de iniciar outra.',
      });
      return;
    }
    const nicheList = (Array.isArray(niches) && niches.length ? niches : splitBatchInput(niche, { max: 20 })).slice(0, 20);
    const neighList = (Array.isArray(neighborhoods) && neighborhoods.length
      ? neighborhoods
      : splitBatchInput(neigh, { max: 50 })).slice(0, 50);
    if (!nicheList.length) {
      addNotification({ type: 'error', category: 'scraper', title: 'Falta o nicho', message: 'Informe ao menos um nicho para iniciar a extração.' });
      return;
    }
    const rawCount = nicheList.length * Math.max(1, neighList.length);
    const targets = buildExtractionTargets(nicheList, neighList);
    if (!targets.length) {
      addNotification({ type: 'error', category: 'scraper', title: 'Nada para buscar', message: 'Confira nichos e bairros e tente novamente.' });
      return;
    }
    if (rawCount > targets.length) {
      addNotification({
        type: 'info',
        category: 'scraper',
        title: 'Extração limitada',
        message: `São ${rawCount} buscas no total; começando pelas ${targets.length} primeiras.`,
      });
    }
    const cityParts = String(city || '').split(',').map((part) => part.trim()).filter(Boolean);
    const uf = cityParts.find((part) => /^[A-Z]{2}$/i.test(part))?.toUpperCase() || '';
    const municipality = cityParts.filter((part) => !/^[A-Z]{2}$/i.test(part)).join(', ');
    const searchId = `scrape_${Date.now()}`;
    const qstr = [nicheList.join(', '), neighList.join(', '), city].filter(Boolean).join(' ').trim();
    const job = {
      id: searchId,
      niches: nicheList,
      neighborhoods: neighList,
      city: String(city || ''),
      municipality,
      uf,
      qstr,
      label: `${nicheList.length > 1 ? `${nicheList.length} nichos` : nicheList[0]} · ${neighList.length ? `${neighList.length} bairro(s)` : 'município inteiro'}${city ? ` · ${city}` : ''}`,
      limit: Number.isFinite(Number(limit)) ? Number(limit) : 1000,
      source: source === 'places-api' ? 'places-api' : 'scraper',
      targets,
      status: 'running',
      completedKeys: [],
      failedKeys: [],
      foundCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Uma extração nova aposenta jobs interrompidos anteriores.
    writeExtractionJobs([
      job,
      ...readExtractionJobs().map((item) => (item?.status === 'running' && String(item?.id) !== searchId
        ? { ...item, status: 'cancelled', updatedAt: Date.now() }
        : item)),
    ]);
    addNotification({
      type: 'info',
      category: 'scraper',
      title: 'Iniciando extração gigante',
      message: targets.length > 1 ? `${job.label} — ${targets.length} buscas em sequência.` : `Buscando ${job.label}...`,
    });
    await runExtractionJob(job, { navigate: true });
  };

  // Retomada automática: se o app fechou no meio de uma extração gigante,
  // volta de onde parou ao abrir.
  useEffect(() => {
    try {
      const jobs = readExtractionJobs();
      const pending = jobs.find((item) => item?.status === 'running' && remainingJobTargets(item).length > 0);
      if (pending && window.electronAPI?.startScrape) {
        const doneCount = (pending.completedKeys || []).length;
        addNotification({
          type: 'info',
          category: 'scraper',
          title: 'Extração retomada',
          message: `Continuando de onde parou (${doneCount}/${pending.targets.length} buscas prontas, resultados já salvos).`,
        });
        runExtractionJob(pending, { navigate: false });
      }
    } catch {}
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return <Overview onNavigate={navigate} onNewExtraction={() => setIsNewExtractionOpen(true)} waStatus={waStatus} leadsCount={leadsCount} scoringCount={scoringCount} />;
      case 'scraper':
        return (
          <ErrorBoundaryLite label="Scraper">
            <MapScraperView
              onUpdateLeadsCount={setLeadsCount}
              addLog={(msg) => console.log(msg)}
              onOpenNewExtraction={() => setIsNewExtractionOpen(true)}
              activeExtraction={activeExtraction}
            />
          </ErrorBoundaryLite>
        );
      case 'scoring':
        return (
          <ErrorBoundaryLite label="Lead Scoring">
            <LeadScoring onUpdateScoringCount={setScoringCount} addLog={(msg) => console.log(msg)} />
          </ErrorBoundaryLite>
        );
      case 'kanban':
        return (
          <ErrorBoundaryLite label="Kanban">
            <KanbanBoard onNavigate={navigate} addLog={(msg) => console.log(msg)} />
          </ErrorBoundaryLite>
        );
      case 'base':
        return (
          <ErrorBoundaryLite label="Base de Leads">
            <LeadsManager onUpdateLeadsCount={setLeadsCount} addLog={(msg) => console.log(msg)} />
          </ErrorBoundaryLite>
        );
      case 'whatsapp':
        return (
          <ErrorBoundaryLite label="WhatsApp">
            <WhatsAppPanel waStatus={waStatus} setWaStatus={setWaStatus} addLog={(msg) => console.log(msg)} />
          </ErrorBoundaryLite>
        );
      case 'campaigns': // compat: alias → whatsapp/campanhas tab
        return (
          <ErrorBoundaryLite label="Campanhas">
            <WhatsAppPanel waStatus={waStatus} setWaStatus={setWaStatus} addLog={(msg) => console.log(msg)} initialTab="campaigns" />
          </ErrorBoundaryLite>
        );
      case 'settings':
        return (
          <section className="settings-open-design-view">
            <div className="page-head">
              <div><h1 style={{ fontSize: 20 }}>Configurações</h1></div>
            </div>
            <div className="table-wrap settings-open-design-card">
              <div className="field">
                <label htmlFor="themeSel">Modo de interface</label>
                <select id="themeSel" defaultValue="light">
                  <option value="light">Claro (padrão travado)</option>
                  <option value="dark">Escuro (override futuro)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="uiZoom">Zoom de acessibilidade</label>
                <div className="settings-zoom-controls" id="uiZoom">
                  <button type="button" className="btn" onClick={() => updateUiZoom(uiZoom - 0.1)} disabled={uiZoom <= 0.8}>−</button>
                  <output aria-live="polite">{Math.round(uiZoom * 100)}%</output>
                  <button type="button" className="btn" onClick={() => updateUiZoom(uiZoom + 0.1)} disabled={uiZoom >= 1.5}>+</button>
                  <button type="button" className="btn" onClick={() => updateUiZoom(1)} disabled={uiZoom === 1}>Redefinir</button>
                </div>
              </div>
              <section className="settings-streaming-mode" aria-labelledby="streamingModeTitle">
                <span className="settings-streaming-icon"><EyeOff size={18} /></span>
                <div>
                  <h2 id="streamingModeTitle">Modo streaming</h2>
                  <p>Borra números de telefone em todas as telas e nas mensagens para proteger seus contatos durante lives e gravações.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={streamingMode}
                  className={`settings-switch ${streamingMode ? 'on' : ''}`}
                  onClick={() => setStreamingMode((enabled) => !enabled)}
                >
                  <span />
                  <b>{streamingMode ? 'Ativado' : 'Desativado'}</b>
                </button>
              </section>
              <div>
                <button className="btn btn-primary" onClick={() => addNotification({ type: 'info', title: 'Preferências salvas', message: 'Modo de interface atualizado.' })}>
                  Salvar preferências
                </button>
              </div>
              <p>Use Ctrl/Cmd +, − ou 0 para ajustar o zoom. A preferência é restaurada nesta instalação.</p>
              <MapsSourceSettingsCard />
              <DataBackupCard />
              <UpdateSettingsCard />
              <section className="settings-danger-zone" aria-labelledby="clearLeadBaseTitle">
                <div>
                  <div className="eyebrow">Dados locais</div>
                  <h2 id="clearLeadBaseTitle">Limpar dados locais</h2>
                  <p>Escolha exatamente o que remover, incluindo o histórico de campanhas. Arquivos CSV/XLSX exportados não são apagados.</p>
                </div>
                <button type="button" className="btn btn-danger" data-od-id="settings-clear-leads" onClick={() => setIsClearLeadBaseOpen(true)}>
                  Limpar dados
                </button>
              </section>
              {isClearLeadBaseOpen && (
                <div className="overlay on modal-overlay" role="presentation" onClick={() => setIsClearLeadBaseOpen(false)}>
                  <div className="modal modal-content settings-clear-modal" role="dialog" aria-modal="true" aria-labelledby="clearLeadBaseDialog" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-head"><h2 id="clearLeadBaseDialog">O que deseja limpar?</h2></div>
                    <div className="modal-body" style={{ gridTemplateColumns: '1fr' }}>
                      <p>Marque apenas o que deseja remover. A ação é local e não apaga arquivos CSV/XLSX exportados.</p>
                      <div className="settings-clear-options" role="group" aria-label="Tipos de dados para remover">
                        <label className="settings-clear-select-all">
                          <input
                            type="checkbox"
                            checked={CLEAR_DATA_OPTIONS.every(({ id }) => clearDataSelection[id])}
                            onChange={(event) => setClearDataSelection(event.target.checked ? { ...DEFAULT_CLEAR_DATA_SELECTION } : Object.fromEntries(CLEAR_DATA_OPTIONS.map(({ id }) => [id, false])))}
                          />
                          <span><b>Selecionar tudo</b><small>Inclui histórico de campanhas e conversas locais</small></span>
                        </label>
                        {CLEAR_DATA_OPTIONS.map(({ id, label, hint }) => (
                          <label key={id} className="settings-clear-option">
                            <input
                              type="checkbox"
                              checked={!!clearDataSelection[id]}
                              onChange={(event) => setClearDataSelection((current) => ({ ...current, [id]: event.target.checked }))}
                            />
                            <span><b>{label}</b><small>{hint}</small></span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="modal-foot">
                      <button type="button" className="btn btn-ghost" onClick={() => setIsClearLeadBaseOpen(false)}>Cancelar</button>
                      <button type="button" className="btn btn-danger" disabled={!Object.values(clearDataSelection).some(Boolean)} onClick={clearSelectedData}>Limpar selecionados</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      default:
        return (
          <MapScraperView
            onUpdateLeadsCount={setLeadsCount}
            addLog={(msg) => console.log(msg)}
            onOpenNewExtraction={() => setIsNewExtractionOpen(true)}
            activeExtraction={activeExtraction}
          />
        );
    }
  };

  return (
    <div className="app-layout-root">
      {/* Left Sidebar */}
      <aside className="app-sidebar">
        {/* Brand Header */}
        <button
          type="button"
          className="sidebar-brand"
          onClick={() => setIsSidebarCollapsed((value) => !value)}
          aria-expanded={!isSidebarCollapsed}
          title={isSidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          <div className="brand-icon-box">
            Σ
          </div>
          <div className="brand-text-col">
            <span className="brand-name">Sigma Scraper</span>
            <span className="brand-tag">GMaps</span>
          </div>
        </button>

        {/* Primary CTA Button */}
        <div className="sidebar-action-wrap">
          <button
            className="btn-new-extraction"
            onClick={() => setIsNewExtractionOpen(true)}
          >
            <span className="sidebar-plus" aria-hidden="true">+</span>
            <span>Nova Extração</span>
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="sidebar-nav">
          <div className="sidebar-nav-label">Painel administrativo</div>
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => navigate('overview')}
          >
            <span className="ico" aria-hidden="true"><LayoutDashboard size={17} /></span>
            <span className="nav-label-text">Visão Geral</span><span className="nav-kbd">1</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'scraper' ? 'active' : ''}`}
            onClick={() => navigate('scraper')}
          >
            <span className="ico" aria-hidden="true"><Map size={17} /></span>
            <span className="nav-label-text">Scraper Maps</span><span className="nav-kbd">2</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'base' ? 'active' : ''}`}
            onClick={() => navigate('base')}
          >
            <span className="ico" aria-hidden="true"><Database size={17} /></span>
            <span className="nav-label-text">Base de Leads</span><span className="nav-kbd">3</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'scoring' ? 'active' : ''}`}
            onClick={() => navigate('scoring')}
          >
            <span className="ico" aria-hidden="true"><Sparkles size={17} /></span>
            <span className="nav-label-text">Lead Scoring</span><span className="nav-kbd">4</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'kanban' ? 'active' : ''}`}
            onClick={() => navigate('kanban')}
          >
            <span className="ico" aria-hidden="true"><Kanban size={17} /></span>
            <span className="nav-label-text">Kanban</span><span className="nav-kbd">5</span>
          </button>

          {WHATSAPP_ENABLED && (
            <button
              className={`nav-item ${activeTab === 'whatsapp' ? 'active' : ''}`}
              onClick={() => navigate('whatsapp')}
            >
              <span className="ico" aria-hidden="true"><MessageCircle size={17} /></span>
              <span className="nav-label-text">WhatsApp</span><span className="nav-kbd">6</span>
            </button>
          )}

        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
            <span className="ico" aria-hidden="true"><Settings2 size={17} /></span>
            <span className="nav-label-text">Configurações</span>
          </button>
        </div>
      </aside>
      <button type="button" className="app-nav-scrim" aria-label="Fechar navegação" onClick={() => setIsMobileNavOpen(false)} />

      {/* Main Container (Header + Main Screen Area) */}
      <div className="app-main-viewport">
        {/* Top Header Bar — 48px, light, blur */}
        <header className="app-header-bar" onDoubleClick={(event) => {
          if (event.target === event.currentTarget || event.target.closest('.header-drag-spacer')) handleMaximize();
        }}>
          <button type="button" className="mobile-menu-btn" onClick={() => setIsMobileNavOpen(true)} aria-label="Abrir navegação"><Menu size={18} /></button>
          {activeTab === 'overview' ? (
            <button type="button" className="header-search-wrap" onClick={() => setIsCmdOpen(true)} title="Abrir busca global (Ctrl/Cmd+K)">
              <Search size={14} className="header-search-icon" />
              <span>Buscar leads, campanhas, ações…</span>
            </button>
          ) : <div className="header-drag-spacer" aria-hidden="true" />}

          {/* Right Header Actions */}
          <div className="header-right-actions">
            {WHATSAPP_ENABLED && (
              <button type="button" className="wa-status-pill" onClick={() => navigate('whatsapp')}>
                <span className={`wa-status-dot ${waStatus === 'connected' ? 'online' : ''}`} />
                <span>{waStatus === 'connected' ? '1 WhatsApp online' : 'WhatsApp desconectado'}</span>
              </button>
            )}

            {/* Window Controls (Frameless Drag/Close) */}
            <div className="window-control-buttons">
              <button type="button" onClick={handleMinimize} title="Minimizar para a bandeja" className="win-btn"><Minus size={13} /></button>
              <button type="button" onClick={handleMaximize} title="Maximizar ou restaurar" className="win-btn"><Square size={11} /></button>
              <button type="button" onClick={handleClose} title="Fechar" className="win-btn win-close"><X size={13} /></button>
            </div>
          </div>
        </header>

        {/* Screen Content — view-transition */}
        <main className="app-screen-container">
          <UpdateBanner />
          <div key={activeTab} className="view-transition" style={{ flex:1, display:'flex', flexDirection:'column' }}>
            {renderContent()}
          </div>
        </main>
        {activeTab === 'overview' && <CommandPalette open={isCmdOpen} onClose={setIsCmdOpen} onNavigate={setActiveTab} onNewExtraction={() => setIsNewExtractionOpen(true)} />}
        <OnboardingTour onNavigate={setActiveTab} />
      </div>

      {/* New Extraction Modal */}
      <NewExtractionModal
        isOpen={isNewExtractionOpen}
        onClose={() => setIsNewExtractionOpen(false)}
        onStartExtraction={handleStartExtraction}
        onAddToQueue={({ niche, neigh, city }) => {
          addNotification({
            type: 'info',
            category: 'scraper',
            title: 'Adicionado à Fila',
            message: `${niche} em ${neigh}, ${city}`
          });
        }}
        isProcessing={Boolean(activeExtraction)}
      />
    </div>
  );
}

export default function App() {
  return (
    <NotificationProvider>
      <AppInner />
    </NotificationProvider>
  );
}
