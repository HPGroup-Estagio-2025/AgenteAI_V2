'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';

// Cores para setores predefinidos; setores custom recebem cor gerada
const SECTOR_COLORS = {
  'maritimo':       '#0369A1',
  'defesa-militar': '#4a5320',
  'aeroespacial':   '#6D28D9',
  'ferroviario':    '#92400E',
  'tecnologia':     '#15803D',
  'fitness':        '#BE185D',
};

const DEFAULT_SECTOR_IDS = ['maritimo', 'defesa-militar', 'aeroespacial', 'ferroviario', 'tecnologia', 'fitness'];

function sectorColor(id) {
  if (SECTOR_COLORS[id]) return SECTOR_COLORS[id];
  // Cor determinística para setores custom
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 38%)`;
}

function isUrl(str) {
  return /^https?:\/\//i.test(str) || /\.[a-z]{2,}(\/|$)/i.test(str);
}

export default function SourcesPage() {
  const router = useRouter();
  const [sources, setSources] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [url, setUrl] = useState('');
  const [sector, setSector] = useState('');
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [sectorMatch, setSectorMatch] = useState(null);
  const searchTimer = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragIdRef = useRef(null);
  const dragSectorRef = useRef(null);
  // Novo setor
  const [showNewSector, setShowNewSector] = useState(false);
  const [newSectorLabel, setNewSectorLabel] = useState('');
  const [newSectorKeywords, setNewSectorKeywords] = useState('');
  const [creatingSector, setCreatingSector] = useState(false);

  function showToast(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function clearAuth() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('token_expiry');
  }

  const loadSectors = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/sectors', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const list = data.sectors || [];
      setSectors(list);
      setSector(prev => prev || (list[0]?.id || ''));
    } catch {}
  }, []);

  const loadSources = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) { router.replace('/'); return; }
    try {
      const res = await fetch('/api/sources', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      setSources(data.sources || []);
    } catch {}
    setLoading(false);
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const expiry = parseInt(localStorage.getItem('token_expiry') || '0', 10);
    if (!token || Date.now() > expiry) { clearAuth(); router.replace('/'); return; }
    loadSectors();
    loadSources();
  }, [loadSectors, loadSources]);

  async function handleCreateSector() {
    if (!newSectorLabel.trim()) return;
    setCreatingSector(true);
    const token = localStorage.getItem('auth_token');
    const keywords = newSectorKeywords.split(',').map(k => k.trim()).filter(Boolean);
    try {
      const res = await fetch('/api/sectors', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newSectorLabel.trim(), keywords }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao criar setor', 'error'); return; }
      showToast(`Setor "${newSectorLabel}" criado!`, 'success');
      setNewSectorLabel('');
      setNewSectorKeywords('');
      setShowNewSector(false);
      await loadSectors();
      setSector(data.sector.id);
    } catch { showToast('Erro de ligação', 'error'); }
    setCreatingSector(false);
  }

  async function handleDeleteSector(id) {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/sectors', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error, 'error'); return; }
      showToast('Setor removido', 'info');
      await loadSectors();
    } catch {}
  }

  async function handleInputChange(value) {
    setUrl(value);
    setValidation(null);
    setSuggestions([]);
    setNotFound(false);
    setSectorMatch(null);
    if (!value.trim() || value.trim().length < 2) return;
    if (isUrl(value.trim())) return;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const token = localStorage.getItem('auth_token');
      try {
        const res = await fetch('/api/sources/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: value.trim() }),
        });
        const data = await res.json();
        setSuggestions(data.results || []);
        setNotFound(data.notFound === true && (data.results || []).length === 0);
        setSectorMatch(data.sectorMatch || null);
      } catch {}
      setSearching(false);
    }, 500);
  }

  async function handleSelectSuggestion(suggestion) {
    setUrl(suggestion.url);
    if (suggestion.sector) setSector(suggestion.sector);
    setSuggestions([]);
    // Valida automaticamente para obter o número real de artigos
    setValidating(true);
    setValidation(null);
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/sources/validate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: suggestion.url }),
      });
      const data = await res.json();
      // Usa o nome da sugestão se o feed não tiver um nome melhor
      if (data.valid && (!data.name || data.name === suggestion.url)) data.name = suggestion.name;
      setValidation(data);
    } catch {
      // Fallback sem contagem
      setValidation({ valid: true, feedUrl: suggestion.url, name: suggestion.name });
    }
    setValidating(false);
  }

  async function handleValidate() {
    if (!url.trim()) return;
    setValidating(true);
    setValidation(null);
    setSuggestions([]);
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/sources/validate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      setValidation(data);
      if (data.feedUrl && data.feedUrl !== url.trim()) setUrl(data.feedUrl);
    } catch {
      setValidation({ valid: false, error: 'Erro ao validar URL' });
    }
    setValidating(false);
  }

  async function handleAdd() {
    if (!validation?.valid) return;
    setAdding(true);
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validation.feedUrl || url, name: validation.name, sector }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao adicionar fonte', 'error'); return; }
      showToast('Fonte adicionada com sucesso!', 'success');
      setUrl('');
      setValidation(null);
      await loadSources();
    } catch {
      showToast('Erro de ligação', 'error');
    }
    setAdding(false);
  }

  async function handleDelete(id) {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/sources', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) { showToast('Fonte removida', 'info'); await loadSources(); }
    } catch {}
  }

  async function handleReorder(sectorId, fromId, toId) {
    if (fromId === toId) return;
    const sectorItems = sources.filter(s => s.sector === sectorId);
    const otherItems = sources.filter(s => s.sector !== sectorId);
    const fromIdx = sectorItems.findIndex(s => s.id === fromId);
    const toIdx = sectorItems.findIndex(s => s.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...sectorItems];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // Atribuir prioridades globais: otherItems mantêm as suas, sectorItems recebem valores intercalados
    const otherPriorities = otherItems.map(s => s.priority ?? 0).sort((a, b) => a - b);
    const minOther = otherPriorities.length ? Math.min(...otherPriorities) : 1000;
    const newItems = reordered.map((s, i) => ({ ...s, priority: i + 1 }));
    // Ajusta os outros items para não colidir
    const offset = reordered.length + 1;
    const adjustedOthers = otherItems.map((s, i) => ({ ...s, priority: offset + i }));

    const allUpdated = [...newItems, ...adjustedOthers];
    setSources(allUpdated);

    const token = localStorage.getItem('auth_token');
    try {
      await fetch('/api/sources', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: allUpdated.map(s => ({ id: s.id, priority: s.priority })) }),
      });
    } catch { showToast('Erro ao guardar ordem', 'error'); }
  }

  const groupedSources = useMemo(() => sectors.map(s => ({
    ...s,
    color: sectorColor(s.id),
    isCustom: !DEFAULT_SECTOR_IDS.includes(s.id),
    items: sources.filter(src => src.sector === s.id),
  })).filter(s => s.items.length > 0), [sectors, sources]);

  return (
    <div className="dashboard-page">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <img src="/robot-logo.svg" width="36" height="36" alt="Publixy" style={{ borderRadius: 8 }} />
            <span>Publixy</span>
          </div>
          <nav className="header-nav">
            <button className="header-nav-item" onClick={() => router.push('/dashboard')}>Notícias</button>
            <button className="header-nav-item" onClick={() => router.push('/social')}>Redes Sociais</button>
            <button className="header-nav-item active">Fontes</button>
          </nav>
          <div className="header-actions">
            <button className="btn-logout" onClick={() => { clearAuth(); router.replace('/'); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
              </svg>
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="main" style={{ maxWidth: 800 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--gray-900)', marginBottom: 6 }}>Fontes de Notícias</h1>
          <p style={{ color: 'var(--gray-500)', fontSize: '.9375rem' }}>Adiciona feeds RSS de sites que queres monitorizar. O agente vai incluí-los na próxima pesquisa.</p>
        </div>

        {/* Formulário de adição */}
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--gray-200)', padding: 24, marginBottom: 28, boxShadow: 'var(--shadow-sm)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16, color: 'var(--gray-800)' }}>Adicionar nova fonte</h2>

          <div style={{ position: 'relative', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Nome do site (ex: Naval Technology) ou URL do feed"
                  value={url}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleValidate(); if (e.key === 'Escape') setSuggestions([]); }}
                  autoComplete="off"
                />
                {searching && (
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                    <span className="loader" style={{ width: 13, height: 13, borderColor: 'rgba(0,0,0,.1)', borderTopColor: 'var(--gray-400)' }} />
                  </span>
                )}
              </div>
              <button
                className="btn btn-ghost"
                onClick={handleValidate}
                disabled={validating || !url.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {validating
                  ? <><span className="loader" style={{ width: 13, height: 13, borderColor: 'rgba(0,0,0,.15)', borderTopColor: 'var(--gray-600)' }} /> A verificar...</>
                  : '🔍 Verificar'}
              </button>
            </div>

            {/* Fonte não encontrada */}
            {notFound && !searching && (
              <div style={{
                marginTop: 6, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                background: 'var(--red-50)', border: '1px solid var(--red-100)',
                color: 'var(--red-600)', fontSize: '.85rem', fontWeight: 500,
              }}>
                ✗ Fonte não encontrada — verifica o nome ou cola o URL directamente
              </div>
            )}

            {/* Dropdown de sugestões */}
            {suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: 'var(--white)', border: '1.5px solid var(--gray-200)',
                borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-md)',
                marginTop: 4, overflow: 'hidden',
              }}>
                {sectorMatch && (
                  <div style={{ padding: '8px 14px', background: 'var(--blue-50)', borderBottom: '1px solid var(--blue-100)', fontSize: '.75rem', fontWeight: 700, color: 'var(--blue-700)' }}>
                    📂 Fontes sugeridas para o setor · {sectors.find(s => s.id === sectorMatch)?.label}
                  </div>
                )}
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectSuggestion(s)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', border: 'none', background: 'none',
                      cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--gray-100)',
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-50)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '.875rem', color: 'var(--gray-800)' }}>{s.name}</div>
                      <div style={{ fontSize: '.72rem', color: 'var(--gray-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
                    </div>
                    {s.sector && (
                      <span style={{
                        fontSize: '.68rem', fontWeight: 700, padding: '2px 8px',
                        borderRadius: 10, background: 'var(--blue-50)', color: 'var(--blue-600)',
                        flexShrink: 0, whiteSpace: 'nowrap',
                      }}>
                        {sectors.find(sec => sec.id === s.sector)?.label || s.sector}
                      </span>
                    )}
                  </button>
                ))}
                <div style={{ padding: '6px 14px', fontSize: '.72rem', color: 'var(--gray-400)', background: 'var(--gray-50)' }}>
                  Clica para selecionar · podes também colar um URL directamente
                </div>
              </div>
            )}
          </div>

          {/* Resultado da validação */}
          {validation && (
            <div style={{
              padding: '12px 16px', borderRadius: 'var(--radius-sm)', marginBottom: 14,
              background: validation.valid ? 'var(--green-50)' : 'var(--red-50)',
              border: `1px solid ${validation.valid ? 'var(--green-100)' : 'var(--red-100)'}`,
              color: validation.valid ? 'var(--green-600)' : 'var(--red-600)',
            }}>
              {validation.valid ? (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ Fonte válida: {validation.name}</div>
                  {validation.itemCount && (
                    <div style={{ fontSize: '.82rem', opacity: .8 }}>{validation.itemCount} artigos encontrados{validation.note ? ` · ${validation.note}` : ''}</div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>✗ Fonte inválida</div>
                  <div style={{ fontSize: '.82rem' }}>{validation.error}</div>
                </>
              )}
            </div>
          )}

          {/* Seletor de setor + botão adicionar */}
          {validation?.valid && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 5 }}>Setor</label>
                <select
                  value={sector}
                  onChange={e => setSector(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: '.875rem', color: 'var(--gray-800)', background: 'var(--white)', outline: 'none' }}
                >
                  {sectors.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-ghost"
                style={{ whiteSpace: 'nowrap', fontSize: '.8rem' }}
                onClick={() => setShowNewSector(v => !v)}
              >
                + Novo setor
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={adding}
              >
                {adding ? <><span className="loader" style={{ width: 13, height: 13 }} /> A adicionar...</> : '+ Adicionar fonte'}
              </button>
            </div>
          )}

          {/* Formulário de novo setor */}
          {showNewSector && (
            <div style={{ marginTop: 14, padding: 16, background: 'var(--blue-50)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(124,58,237,.15)' }}>
              <div style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--blue-700)', marginBottom: 10 }}>Criar novo setor</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <input
                  type="text"
                  placeholder="Nome do setor (ex: Desporto, Saúde, Finanças)"
                  value={newSectorLabel}
                  onChange={e => setNewSectorLabel(e.target.value)}
                  style={{ flex: 1, minWidth: 180 }}
                />
              </div>
              <input
                type="text"
                placeholder="Palavras-chave separadas por vírgula (ex: football, soccer, sports, athlete)"
                value={newSectorKeywords}
                onChange={e => setNewSectorKeywords(e.target.value)}
                style={{ width: '100%', marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleCreateSector} disabled={creatingSector || !newSectorLabel.trim()}>
                  {creatingSector ? <><span className="loader" style={{ width: 13, height: 13 }} /> A criar...</> : 'Criar setor'}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowNewSector(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>

        {/* Lista de fontes */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>A carregar fontes...</div>
        ) : sources.length === 0 ? (
          <div className="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
            <p>Nenhuma fonte personalizada</p>
            <span>As fontes predefinidas do sistema continuam activas</span>
          </div>
        ) : (
          <>
            <p style={{ fontSize: '.8rem', color: 'var(--gray-400)', marginBottom: 12 }}>
              ☰ Arrasta as fontes para definir a ordem de prioridade — as primeiras recebem mais slots no agente.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {groupedSources.map(group => (
                <div key={group.id} style={{ background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--gray-200)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ padding: '10px 18px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: group.color, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: '.85rem', color: 'var(--gray-700)' }}>{group.label}</span>
                    {group.isCustom && <span style={{ fontSize: '.65rem', padding: '1px 6px', borderRadius: 8, background: 'var(--blue-50)', color: 'var(--blue-600)', fontWeight: 700 }}>Custom</span>}
                    <span style={{ marginLeft: 'auto', fontSize: '.75rem', color: 'var(--gray-400)' }}>{group.items.length} fonte{group.items.length !== 1 ? 's' : ''}</span>
                    {group.isCustom && (
                      <button
                        onClick={() => handleDeleteSector(group.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--red-600)', fontSize: '.72rem', cursor: 'pointer', padding: '2px 6px' }}
                        title="Remover setor"
                      >✕ Setor</button>
                    )}
                  </div>
                  {group.items.map((src) => {
                    const globalRank = sources.findIndex(s => s.id === src.id) + 1;
                    return (
                    <div
                      key={src.id}
                      draggable="true"
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', src.id); dragIdRef.current = src.id; dragSectorRef.current = group.id; setDragOverId(null); }}
                      onDragEnd={() => { dragIdRef.current = null; dragSectorRef.current = null; setDragOverId(null); }}
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (src.id !== dragIdRef.current) setDragOverId(src.id); }}
                      onDragLeave={() => setDragOverId(v => v === src.id ? null : v)}
                      onDrop={e => { e.preventDefault(); const from = dragIdRef.current; const sector = dragSectorRef.current; dragIdRef.current = null; dragSectorRef.current = null; setDragOverId(null); if (from && from !== src.id) handleReorder(sector || group.id, from, src.id); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                        borderBottom: '1px solid var(--gray-100)',
                        background: dragOverId === src.id ? 'var(--blue-50)' : 'var(--white)',
                        opacity: 1,
                        transition: 'background .12s',
                        cursor: 'grab',
                      }}
                    >
                      {/* Drag handle */}
                      <span style={{ color: 'var(--gray-300)', fontSize: '1rem', userSelect: 'none', flexShrink: 0, lineHeight: 1 }}>
                        ⠿
                      </span>
                      {/* Prioridade global */}
                      <span style={{
                        minWidth: 22, height: 22, borderRadius: '50%', background: globalRank === 1 ? 'var(--blue-600)' : 'var(--gray-100)',
                        color: globalRank === 1 ? '#fff' : 'var(--gray-500)',
                        fontSize: '.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {globalRank}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '.875rem', color: 'var(--gray-800)', marginBottom: 2 }}>{src.name}</div>
                        <div style={{ fontSize: '.75rem', color: 'var(--gray-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.url}</div>
                      </div>
                      <button
                        className="btn btn-ghost"
                        draggable="false"
                        style={{ color: 'var(--red-600)', borderColor: 'transparent', padding: '5px 10px', fontSize: '.78rem', flexShrink: 0 }}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={() => handleDelete(src.id)}
                      >
                        Remover
                      </button>
                    </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Bottom nav mobile */}
      <nav className="mobile-bottom-nav">
        <button onClick={() => router.push('/dashboard')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Notícias
        </button>
        <button onClick={() => router.push('/social')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          Redes Sociais
        </button>
        <button className="active">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
          Fontes
        </button>
        <button onClick={() => { clearAuth(); router.replace('/'); }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sair
        </button>
      </nav>

      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}
    </div>
  );
}
