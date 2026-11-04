import React, { useState, useRef, useEffect } from 'react';
import { splitBatchInput } from '../batchSplit.mjs';

const NICHOS = [
  'Dentistas', 'Clínica odontológica', 'Ortodontista', 'Odontologia', 'Aparelho ortodôntico',
  'Academias', 'Personal trainer', 'Crossfit', 'Restaurantes', 'Pizzarias', 'Hamburguerias',
  'Comida japonesa', 'Escritório de advocacia', 'Advogados', 'Advocacia trabalhista',
  'Advocacia empresarial', 'Contabilidade', 'Escritório de contabilidade', 'Imobiliárias',
  'Corretores de imóveis', 'Clínicas de estética', 'Salão de beleza', 'Barbearias',
  'Pet shops', 'Veterinários', 'Autoescolas', 'Oficinas mecânicas', 'Escolas',
  'Cursos profissionalizantes', 'Psicólogos', 'Fisioterapeutas', 'Arquitetos', 'Designers',
  'Agências de marketing', 'Padarias', 'Farmácias', 'Hotéis', 'Lava-jatos', 'Clínicas médicas', 'Laboratórios'
];

const CIDADES = [
  ['São Paulo', 'SP'], ['Guarulhos', 'SP'], ['Campinas', 'SP'], ['São Bernardo do Campo', 'SP'],
  ['Santo André', 'SP'], ['São José dos Campos', 'SP'], ['Osasco', 'SP'], ['Ribeirão Preto', 'SP'],
  ['Sorocaba', 'SP'], ['Santos', 'SP'], ['Mauá', 'SP'], ['São José do Rio Preto', 'SP'],
  ['Diadema', 'SP'], ['Jundiaí', 'SP'], ['Mogi das Cruzes', 'SP'], ['Piracicaba', 'SP'],
  ['Rio de Janeiro', 'RJ'], ['São Gonçalo', 'RJ'], ['Duque de Caxias', 'RJ'], ['Nova Iguaçu', 'RJ'],
  ['Niterói', 'RJ'], ['Belford Roxo', 'RJ'], ['São João de Meriti', 'RJ'], ['Petrópolis', 'RJ'],
  ['Belo Horizonte', 'MG'], ['Contagem', 'MG'], ['Uberlândia', 'MG'], ['Juiz de Fora', 'MG'],
  ['Curitiba', 'PR'], ['Londrina', 'PR'], ['Maringá', 'PR'],
  ['Porto Alegre', 'RS'], ['Caxias do Sul', 'RS'], ['Canoas', 'RS'],
  ['Salvador', 'BA'], ['Feira de Santana', 'BA'],
  ['Florianópolis', 'SC'], ['Joinville', 'SC'], ['Blumenau', 'SC'],
  ['Goiânia', 'GO'], ['Aparecida de Goiânia', 'GO'],
  ['Recife', 'PE'], ['Jaboatão dos Guararapes', 'PE'], ['Olinda', 'PE'],
  ['Fortaleza', 'CE'], ['Belém', 'PA'], ['São Luís', 'MA'], ['Maceió', 'AL'],
  ['Natal', 'RN'], ['João Pessoa', 'PB'], ['Aracaju', 'SE'], ['Teresina', 'PI'],
  ['Vitória', 'ES'], ['Vila Velha', 'ES'], ['Campo Grande', 'MS'], ['Cuiabá', 'MT'],
  ['Palmas', 'TO'], ['Porto Velho', 'RO'], ['Rio Branco', 'AC'], ['Manaus', 'AM'],
  ['Boa Vista', 'RR'], ['Macapá', 'AP'], ['Brasília', 'DF']
].map(([n, uf]) => ({ n, uf, estado: false }));

const ESTADOS = [
  ['Acre', 'AC'], ['Alagoas', 'AL'], ['Amapá', 'AP'], ['Amazonas', 'AM'], ['Bahia', 'BA'],
  ['Ceará', 'CE'], ['Espírito Santo', 'ES'], ['Goiás', 'GO'], ['Maranhão', 'MA'],
  ['Mato Grosso', 'MT'], ['Mato Grosso do Sul', 'MS'], ['Minas Gerais', 'MG'], ['Pará', 'PA'],
  ['Paraíba', 'PB'], ['Paraná', 'PR'], ['Pernambuco', 'PE'], ['Piauí', 'PI'],
  ['Rio de Janeiro', 'RJ'], ['Rio Grande do Norte', 'RN'], ['Rio Grande do Sul', 'RS'],
  ['Rondônia', 'RO'], ['Roraima', 'RR'], ['Santa Catarina', 'SC'], ['São Paulo', 'SP'],
  ['Sergipe', 'SE'], ['Tocantins', 'TO'], ['Distrito Federal', 'DF']
].map(([n, uf]) => ({ n, uf, estado: true }));

const POP_CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília', 'Distrito Federal (DF)', 'Curitiba', 'Porto Alegre', 'Salvador', 'Recife', 'Fortaleza', 'Goiânia'];

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export default function NewExtractionModal({
  isOpen,
  onClose,
  onStartExtraction,
  onAddToQueue,
  isProcessing
}) {
  const [step, setStep] = useState(1);
  const [nicho, setNicho] = useState('');
  const [nichoError, setNichoError] = useState(false);
  const [nichoSuggestions, setNichoSuggestions] = useState([]);
  const [showNichoList, setShowNichoList] = useState(false);

  const [cidadeObj, setCidadeObj] = useState(null);
  const [cidadeInput, setCidadeInput] = useState('');
  const [cidadeUf, setCidadeUf] = useState('SP');
  const [cidadeError, setCidadeError] = useState(false);
  const [locSuggestions, setLocSuggestions] = useState([]);
  const [showLocList, setShowLocList] = useState(false);

  const [bairroInput, setBairroInput] = useState('');
  const [bairros, setBairros] = useState([]);

  const [source, setSource] = useState('scraper');
  const [hasPlacesKey, setHasPlacesKey] = useState(false);

  const carViewRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setNicho('');
      setNichoError(false);
      setCidadeObj(null);
      setCidadeInput('');
      setCidadeUf('SP');
      setCidadeError(false);
      setBairroInput('');
      setBairros([]);
      window.electronAPI?.getMapsSettings?.()
        .then((settings) => {
          setSource(settings?.defaultSource || 'scraper');
          setHasPlacesKey(!!settings?.hasPlacesApiKey);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const wzTitles = {
    1: 'Qual nicho você quer pesquisar?',
    2: 'Em qual município?',
    3: 'Quais bairros?'
  };

  const handleNichoChange = (val) => {
    setNicho(val);
    setNichoError(false);
    const nq = norm(val).trim();
    if (!nq) {
      setNichoSuggestions([]);
      setShowNichoList(false);
      return;
    }
    const pre = [];
    const mid = [];
    NICHOS.forEach((t) => {
      const nt = norm(t);
      if (nt.indexOf(nq) === 0) pre.push(t);
      else if (nt.indexOf(nq) >= 0) mid.push(t);
    });
    const results = pre.concat(mid).slice(0, 7);
    setNichoSuggestions(results);
    setShowNichoList(results.length > 0);
  };

  const pickNicho = (val) => {
    setNicho(val);
    setNichoError(false);
    setShowNichoList(false);
    setStep(2);
  };

  const handleLocChange = (val) => {
    setCidadeInput(val);
    setCidadeObj(null);
    setCidadeError(false);
    setLocSuggestions([]);
    setShowLocList(false);
  };

  const pickLoc = (item) => {
    setCidadeObj(item);
    setCidadeInput(item.n);
    setCidadeUf(item.uf);
    setCidadeError(false);
    setShowLocList(false);
  };

  const addBairro = () => {
    const items = splitBatchInput(bairroInput, { max: 50, maxLen: 80 });
    if (!items.length) return;
    setBairros((prev) => {
      const next = [...prev];
      for (const item of items) {
        if (!next.some((b) => b.toLowerCase() === item.toLowerCase())) next.push(item);
      }
      return next;
    });
    setBairroInput('');
  };

  const removeBairro = (index) => {
    setBairros(bairros.filter((_, i) => i !== index));
  };

  const cidadeLabel = () => {
    return `${cidadeObj?.n || cidadeInput} — ${cidadeObj?.uf || cidadeUf}`;
  };

  const handleNext = () => {
    if (isProcessing) return;
    if (step === 1) {
      if (!nicho.trim()) {
        setNichoError(true);
        return;
      }
      setNichoError(false);
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!cidadeInput.trim() && !cidadeObj) {
        setCidadeError(true);
        return;
      }
      setCidadeError(false);
      setStep(3);
      return;
    }
    // Step 3 - Start extraction!
    if (source === 'places-api' && !hasPlacesKey) return;
    const niches = splitBatchInput(nicho, { max: 20, maxLen: 80 });
    const neigh = bairros.length > 0 ? bairros.join(', ') : '';
    const city = `${cidadeObj?.n || cidadeInput.trim()}, ${cidadeObj?.uf || cidadeUf}`;
    onStartExtraction?.({
      niche: niches[0] || nicho.trim(),
      niches,
      neigh,
      neighborhoods: [...bairros],
      city,
      limit: 1000,
      source,
    });
    onClose();
  };

  const detectedNiches = splitBatchInput(nicho, { max: 20, maxLen: 80 });
  const matrixCount = detectedNiches.length * Math.max(1, bairros.length);

  return (
    <div className="overlay on modal-overlay" onClick={onClose} style={{ display: 'grid' }}>
      <div className="modal modal-content new-extraction-modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 94vw)' }}>
        <div className="modal-head">
          <div className="eyebrow">Etapa {step} de 3</div>
          <h2 id="mTitle" style={{ fontSize: '20px', fontWeight: 600, marginTop: '4px' }}>
            {wzTitles[step]}
          </h2>
        </div>

        <div className="modal-body" style={{ gridTemplateColumns: '1fr', padding: '16px 20px' }}>
          <div className="wz-dots" aria-hidden="true">
            <i className={step >= 1 ? 'on' : ''} />
            <i className={step >= 2 ? 'on' : ''} />
            <i className={step >= 3 ? 'on' : ''} />
          </div>

          {/* STEP 1: NICHO */}
          {step === 1 && (
            <div className="wz-step">
              <div className={`field ${nichoError ? 'invalid' : ''}`}>
                <label htmlFor="wzNicho">Nicho</label>
                <div className="ac-wrap">
                  <input
                    id="wzNicho"
                    placeholder="Ex.: dentistas, advogados, pizzarias"
                    autoComplete="off"
                    value={nicho}
                    onChange={(e) => handleNichoChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleNext();
                      }
                    }}
                    autoFocus
                  />
                  {showNichoList && nichoSuggestions.length > 0 && (
                    <div className="ac-list" role="listbox">
                      {nichoSuggestions.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="ac-item"
                          onClick={() => pickNicho(item)}
                        >
                          <span><span>{item}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {nichoError && <span className="field-err" style={{ display: 'block' }}>Diga o nicho para continuar.</span>}
                {detectedNiches.length > 1 && (
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    {detectedNiches.length} nichos detectados: {detectedNiches.slice(0, 5).join(' · ')}{detectedNiches.length > 5 ? '…' : ''} — cada um vira uma busca.
                  </span>
                )}
                {!nichoError && detectedNiches.length <= 1 && (
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    Dica: cole vários nichos separados por vírgula.
                  </span>
                )}
              </div>

              <div className="car" style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="car-nav"
                  onClick={() => carViewRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}
                  aria-label="Sugestões anteriores"
                >
                  ‹
                </button>
                <div className="car-view" ref={carViewRef} role="list">
                  {NICHOS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="chip"
                      onClick={() => pickNicho(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="car-nav"
                  onClick={() => carViewRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}
                  aria-label="Próximas sugestões"
                >
                  ›
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: CIDADE */}
          {step === 2 && (
            <div className="wz-step">
              <div className={`field ${cidadeError ? 'invalid' : ''}`}>
                <div className="location-fields">
                  <div className="field">
                    <label htmlFor="wzCidade">Município</label>
                  <input
                    id="wzCidade"
                    placeholder="Ex.: Taguatinga, Campinas, Niterói"
                    autoComplete="address-level2"
                    value={cidadeInput}
                    onChange={(e) => handleLocChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleNext();
                      }
                    }}
                    autoFocus
                  />
                  </div>
                  <div className="field">
                    <label htmlFor="wzUf">UF</label>
                    <select id="wzUf" value={cidadeUf} onChange={(event) => { setCidadeUf(event.target.value); setCidadeObj(null); }}>
                      {ESTADOS.map((estado) => <option key={estado.uf} value={estado.uf}>{estado.uf} · {estado.n}</option>)}
                    </select>
                  </div>
                </div>
                {cidadeError && <span className="field-err" style={{ display: 'block' }}>Escolha uma localização para continuar.</span>}
              </div>

              <div className="ex-chips" style={{ marginTop: '12px' }}>
                {POP_CITIES.map((name) => {
                  const hit = CIDADES.concat(ESTADOS).find((c) => c.n === name || `${c.n} (${c.uf})` === name);
                  if (!hit) return null;
                  return (
                    <button
                      key={name}
                      type="button"
                      className="chip"
                      onClick={() => {
                        pickLoc(hit);
                        setStep(3);
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: BAIRROS */}
          {step === 3 && (
            <div className="wz-step">
              <div className="field">
                <label htmlFor="wzBairro">Bairros (opcional — deixe em branco para o município inteiro)</label>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                  Pode colar vários de uma vez separados por vírgula.
                </span>
                <div className="hood-add">
                  <input
                    id="wzBairro"
                    placeholder="Ex.: Copacabana, Pinheiros, Centro"
                    autoComplete="off"
                    value={bairroInput}
                    onChange={(e) => setBairroInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addBairro();
                      }
                    }}
                    autoFocus
                  />
                  <button type="button" className="btn btn-sm" onClick={addBairro}>
                    + Adicionar
                  </button>
                </div>
              </div>

              <div className="hood-list">
                {bairros.map((h, idx) => (
                  <div key={h} className="hood-row">
                    <span>{h}</span>
                    <button type="button" onClick={() => removeBairro(idx)} aria-label={`Remover ${h}`}>
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="field" style={{ marginTop: '12px' }}>
                <label>Origem dos dados</label>
                <div className="extraction-source" role="group" aria-label="Origem dos dados">
                  <button type="button" className={source === 'scraper' ? 'active' : ''} aria-pressed={source === 'scraper'} onClick={() => setSource('scraper')}>
                    Scraper do Maps
                  </button>
                  <button type="button" className={source === 'places-api' ? 'active' : ''} aria-pressed={source === 'places-api'} onClick={() => setSource('places-api')}>
                    API oficial (Places)
                  </button>
                </div>
                {source === 'places-api' ? (
                  <span className={`extraction-source-hint ${hasPlacesKey ? '' : 'warn'}`}>
                    {hasPlacesKey
                      ? 'Até 60 empresas por busca. Para cobrir mais, adicione bairros. Cobrado na sua conta Google Cloud.'
                      : 'Nenhuma chave configurada. Adicione a chave da Places API em Configurações antes de iniciar.'}
                  </span>
                ) : (
                  <span className="extraction-source-hint">Abre o Google Maps em um navegador oculto. Sem custo, mas mais lento e sujeito a bloqueios.</span>
                )}
              </div>

              <div className="wz-review" style={{ marginTop: '12px' }}>
                <b>{detectedNiches.length > 1 ? `${detectedNiches.length} nichos` : (nicho || '—')}</b>
                <span> · {cidadeLabel()} · {bairros.length ? `${bairros.length} bairro(s)` : 'município inteiro'}</span>
                {matrixCount > 1 && (
                  <span style={{ display: 'block', marginTop: 4 }}>Uma extração gigante: {matrixCount} buscas em sequência, com retomada automática.</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" id="mCancel" onClick={onClose}>
            Cancelar
          </button>
          <span style={{ flex: 1 }} />
          {step > 1 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              Voltar
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={isProcessing || (step === 3 && source === 'places-api' && !hasPlacesKey)} onClick={handleNext}>
            {isProcessing ? 'Extração em andamento…' : (step === 3 ? 'Iniciar extração' : 'Continuar')}
          </button>
        </div>
      </div>
    </div>
  );
}
