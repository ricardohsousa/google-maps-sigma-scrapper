import React, { useCallback, useEffect, useMemo, useState } from 'react';
import App from './App';
import './web.css';

const STATUS = { not_contacted: 'Não contatado', contacted: 'Contatado', responded: 'Respondeu', qualified: 'Qualificado', meeting: 'Reunião', proposal: 'Proposta', closed: 'Fechado', lost: 'Perdido' };
const call = (channel, payload) => window.sigmaWeb.call(channel, payload);

function LeadsWorkspace() {
  const [data, setData] = useState({ leads: [], columns: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await call('leads-list')); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const refresh = () => load(); window.addEventListener('sigma:web-changed', refresh); return () => window.removeEventListener('sigma:web-changed', refresh); }, [load]);
  const selected = data.leads.find(lead => lead.id === selectedId);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return data.leads.filter(lead => `${lead.profile.name} ${lead.profile.phone} ${lead.profile.category} ${lead.profile.city}`.toLocaleLowerCase('pt-BR').includes(needle));
  }, [data, query]);
  const pick = lead => { setSelectedId(lead.id); setDraft({ ...lead.operation }); setError(''); setNotice(''); };
  const save = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await call('lead-operation-update', { id: selected.id, status: draft.status, notes: draft.notes, expectedRevision: draft.revision });
      setDraft(result.operation); setNotice('Acompanhamento salvo.'); await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const move = async toColumnId => {
    setBusy(true); setError(''); setNotice('');
    try { await call('kanban-move-card', { entityKey: selected.id, toColumnId, expectedRevision: selected.cardRevision }); await load(); setNotice('Etapa atualizada.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <main className="web-content">
    <header className="web-page-head"><div><h1>Trabalhar leads</h1><p>Consulte a base e registre o andamento de cada contato.</p></div><button className="btn" onClick={load}>Atualizar lista</button></header>
    {error && <p role="alert" className="web-error">{error}</p>}
    {notice && <p role="status" className="web-notice">{notice}</p>}
    <div className="web-lead-layout">
      <section className="web-panel" aria-label="Base de leads">
        <label className="web-field">Buscar empresa, telefone ou cidade<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
        {loading ? <p role="status">Carregando leads…</p> : !filtered.length ? <p>{query ? 'Nenhum lead corresponde à busca.' : 'A base ainda não tem leads. O proprietário pode importar um backup ou executar uma extração.'}</p> : <>
          <div className="web-table-scroll"><table className="web-table"><thead><tr><th>Empresa</th><th>Cidade</th><th>Status</th><th>Etapa</th></tr></thead><tbody>
            {filtered.slice(page * 30, (page + 1) * 30).map(lead => <tr key={lead.id} aria-selected={lead.id === selectedId}>
              <td><button className="web-lead-name" disabled={busy} onClick={() => pick(lead)}>{lead.profile.name || 'Sem nome'}</button><small>{lead.profile.category}</small></td>
              <td>{lead.profile.city || '—'}</td><td>{STATUS[lead.operation.status] || lead.operation.status}</td><td>{data.columns.find(column => column.id === lead.columnId)?.name || '—'}</td>
            </tr>)}
          </tbody></table></div>
          <div className="web-pagination"><button className="btn" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Anterior</button><span>{filtered.length} leads · página {page + 1}</span><button className="btn" disabled={(page + 1) * 30 >= filtered.length} onClick={() => setPage(value => value + 1)}>Próxima</button></div>
        </>}
      </section>
      <aside className="web-panel" aria-label="Detalhes e acompanhamento">
        {!selected || !draft ? <p>Selecione uma empresa para consultar e atualizar o atendimento.</p> : <>
          <h2>{selected.profile.name}</h2>
          <dl className="web-profile"><dt>Telefone</dt><dd>{selected.profile.phone || '—'}</dd><dt>E-mail</dt><dd>{selected.profile.email || '—'}</dd><dt>Endereço</dt><dd>{selected.profile.address || '—'}</dd><dt>Site</dt><dd>{selected.profile.website || '—'}</dd><dt>Score</dt><dd>{selected.profile.score ?? '—'}</dd></dl>
          <label className="web-field">Etapa no Kanban<select disabled={busy} value={selected.columnId} onChange={event => move(event.target.value)}>{data.columns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
          <form onSubmit={save}>
            <label className="web-field">Status do atendimento<select disabled={busy} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>{Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="web-field">Anotações<textarea rows="7" maxLength="2000" disabled={busy} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
            <div className="web-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar acompanhamento'}</button><button className="btn" type="button" disabled={busy} onClick={() => pick(selected)}>Recarregar lead</button></div>
          </form>
        </>}
      </aside>
    </div>
  </main>;
}

function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('operator');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = async payload => {
    setBusy(true); setError('');
    try { setUsers((await call('users-update', payload)).users); setEmail(''); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { call('users-list').then(result => setUsers(result.users)).catch(err => setError(err.message)); }, []);
  return <main className="web-content web-narrow"><h1>Usuários e perfis</h1><p>O login é feito pela Cloudflare. Cadastre aqui o e-mail e o perfil de quem pode usar o Sigma; permita esse e-mail também no Access.</p>
    {error && <p role="alert" className="web-error">{error}</p>}
    <form className="web-panel" onSubmit={event => { event.preventDefault(); update({ email, role, active: true }); }}>
      <label className="web-field">E-mail<input required type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label className="web-field">Perfil<select value={role} onChange={event => setRole(event.target.value)}><option value="operator">Operador</option><option value="owner">Proprietário</option></select></label>
      <button className="btn btn-primary" disabled={busy}>Salvar usuário</button>
    </form>
    <div className="web-panel web-table-scroll"><table className="web-table"><thead><tr><th>E-mail</th><th>Perfil</th><th>Acesso</th><th>Ação</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.role === 'owner' ? 'Proprietário' : 'Operador'}</td><td>{user.active ? 'Ativo' : 'Desativado'}</td><td><button className="btn" disabled={busy} onClick={() => update({ email: user.email, role: user.role, active: !user.active })}>{user.active ? 'Desativar' : 'Ativar'}</button><button className="btn" disabled={busy} onClick={() => { setEmail(user.email); setRole(user.role); }}>Editar perfil</button></td></tr>)}</tbody></table></div>
  </main>;
}

function MigrationPanel() {
  const [bundle, setBundle] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const preview = async file => {
    if (!file) return;
    setError(''); setBusy(true); setBundle(null); setReport(null); setDone(false);
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('O backup deve ter até 64 MiB.');
      await window.sigmaWeb.flush();
      const value = JSON.parse(await file.text());
      const result = await call('backup-preview', { bundle: value });
      setBundle(value); setReport(result.report);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true); setError('');
    try { const result = await call('backup-import', { bundle }); setReport(result.report); setDone(true); setBundle(null); await window.sigmaWeb.refreshState(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <main className="web-content web-narrow"><h1>Backup e migração</h1><p>No Sigma instalado, abra Configurações → Backup e migração → Exportar backup dos dados. A exportação preserva a base local.</p>
    {error && <p role="alert" className="web-error">{error}</p>}
    <section className="web-panel"><h2>Trazer os dados locais</h2><p>Selecione o backup para verificar a integridade e revisar os registros que serão adicionados.</p><label className="web-field">Backup Sigma (.json)<input type="file" accept=".json,application/json" disabled={busy} onChange={event => preview(event.target.files[0])} /></label>
      {report && <><dl className="web-profile"><dt>Leads novos</dt><dd>{report.leadsAdded}</dd><dt>Análises novas</dt><dd>{report.analysesAdded}</dd><dt>Grupos novos</dt><dd>{report.groupsAdded}</dd><dt>Cards novos</dt><dd>{report.cardsAdded}</dd><dt>Conflitos preservados</dt><dd>{report.conflictsPreserved}</dd></dl><p>Em conflitos, o registro atual do servidor é mantido. O backup recebido e uma cópia do estado anterior ficam guardados no servidor para conferência.</p></>}
      {bundle && <button className="btn btn-primary" disabled={busy} onClick={restore}>{busy ? 'Importando…' : 'Importar preservando os dados existentes'}</button>}
      {done && <p role="status" className="web-notice">Importação concluída. Confira a base e o Kanban antes de encerrar o uso da instalação local.</p>}
    </section>
    <section className="web-panel"><h2>Salvar uma cópia do servidor</h2><p>Baixe os dados comerciais do Sigma para guardar uma cópia externa.</p><button className="btn" disabled={busy} onClick={() => call('backup-export').catch(err => setError(err.message))}>Baixar backup</button></section>
  </main>;
}

export default function WebWorkspace({ session }) {
  const owner = session.user.role === 'owner';
  const [tab, setTab] = useState(owner ? 'app' : 'leads');
  const [appVisit, setAppVisit] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const failed = event => setError(event.detail);
    window.addEventListener('sigma:web-conflict', failed); window.addEventListener('sigma:web-session-error', failed);
    return () => { window.removeEventListener('sigma:web-conflict', failed); window.removeEventListener('sigma:web-session-error', failed); };
  }, []);
  const change = async value => {
    await window.sigmaWeb.flush();
    if (['app', 'settings'].includes(value)) setAppVisit(visit => visit + 1);
    setTab(value);
  };
  const draft = () => {
    const content = JSON.stringify({ format: 'sigma-unsaved-draft', localStorage: window.sigmaWeb.draft() }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sigma-rascunho-${Date.now()}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  return <div className="web-workspace"><header className="web-session-bar"><strong>Σ Sigma</strong><nav aria-label="Navegação do Sigma">{owner && <button aria-current={tab === 'app' ? 'page' : undefined} onClick={() => change('app')}>Painel</button>}<button aria-current={tab === 'leads' ? 'page' : undefined} onClick={() => change('leads')}>Trabalhar leads</button>{owner && <><button aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => change('settings')}>Configurações</button><button aria-current={tab === 'users' ? 'page' : undefined} onClick={() => change('users')}>Usuários</button><button aria-current={tab === 'migration' ? 'page' : undefined} onClick={() => change('migration')}>Backup e migração</button></>}</nav><span>{session.user.email} · {owner ? 'Proprietário' : 'Operador'}</span><a href="/cdn-cgi/access/logout">Sair</a></header>
    {error && <div className="web-blocker"><section className="web-panel" role="alert"><h1>Atualize sua sessão</h1><p>{error}</p>{owner && <button className="btn" onClick={draft}>Baixar rascunho desta aba</button>}<button className="btn btn-primary" onClick={() => location.reload()}>Recarregar dados do servidor</button></section></div>}
    {owner && ['app', 'settings'].includes(tab) ? <div className="web-owner-app"><App key={`${tab}:${appVisit}`} initialTab={tab === 'settings' ? 'settings' : undefined} /></div> : tab === 'users' && owner ? <UsersPanel /> : tab === 'migration' && owner ? <MigrationPanel /> : <LeadsWorkspace />}
  </div>;
}
