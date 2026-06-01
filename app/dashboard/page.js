'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// Remove apenas as chaves de auth (não apaga pending_articles)
function clearAuth() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('token_expiry');
}

// Migração única: move o token do sessionStorage para o localStorage
function migrateAuthToken() {
  if (!localStorage.getItem('auth_token')) {
    const oldToken  = sessionStorage.getItem('auth_token');
    const oldExpiry = sessionStorage.getItem('token_expiry');
    if (oldToken) {
      localStorage.setItem('auth_token', oldToken);
      if (oldExpiry) localStorage.setItem('token_expiry', oldExpiry);
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('token_expiry');
    }
  }
}

const SECTOR_MAP = {
  'maritimo':       { label: 'Marítimo',      cls: 'badge-sector-maritimo' },
  'defesa-militar': { label: 'Defesa Militar', cls: 'badge-sector-defesa' },
  'aeroespacial':   { label: 'Aeroespacial',   cls: 'badge-sector-aeroespacial' },
  'ferroviario':    { label: 'Ferroviário',    cls: 'badge-sector-ferroviario' },
};

const STATUS_LABELS = {
  published: 'Publicada',
  on_hold:   'Em Espera',
  pending:   'Pendente',
};

const SOCIAL_PLATFORMS = [
  { id: 'facebook',  label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin',  label: 'LinkedIn' },
];

// Constrói lista de empresas a partir das contas ligadas.
// Meta (Facebook + Instagram) partilham a mesma entrada; LinkedIn é separado.
function buildCompanies(connectedAccounts) {
  const companies = [];
  const fbAccs = connectedAccounts.facebook  || [];
  const igAccs = connectedAccounts.instagram || [];
  const liAccs = connectedAccounts.linkedin  || [];

  // Grupo Meta: usa contas Facebook como primário; fallback para Instagram
  if (fbAccs.length > 0 || igAccs.length > 0) {
    const primaryAccs = fbAccs.length > 0 ? fbAccs : igAccs;
    const metaPlatforms = [
      ...(fbAccs.length > 0 ? ['facebook']  : []),
      ...(igAccs.length > 0 ? ['instagram'] : []),
    ];
    for (const acc of primaryAccs) {
      companies.push({
        id:         `meta-${acc.id}`,
        name:       acc.name,
        picture:    acc.picture,
        platforms:  metaPlatforms,
        accountIds: {
          ...(fbAccs.length > 0 ? { facebook:  acc.id        } : {}),
          ...(igAccs.length > 0 ? { instagram: igAccs[0]?.id } : {}),
        },
      });
    }
  }

  // LinkedIn: cada conta é uma entrada independente
  for (const acc of liAccs) {
    companies.push({
      id:         `linkedin-${acc.id}`,
      name:       acc.name,
      picture:    acc.picture,
      platforms:  ['linkedin'],
      accountIds: { linkedin: acc.id },
    });
  }

  return companies;
}


const PAGE_SIZE = 5;

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function SectorBadge({ category }) {
  if (!category) return null;
  const sector = SECTOR_MAP[category.toLowerCase()];
  if (sector) return <span className={`badge ${sector.cls}`}>{sector.label}</span>;
  return <span className="badge badge-category">{category}</span>;
}

// ── Modal: sem redes sociais conectadas ────────────────────────────
function NoSocialModal({ onClose, onGoToSocial }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 12, padding: '32px 28px',
          maxWidth: 380, width: '90%', textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,.18)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ marginBottom: 16 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 600, color: '#111' }}>
          Nenhuma rede social conectada
        </h3>
        <p style={{ margin: '0 0 24px', fontSize: '.9rem', color: '#6B7280', lineHeight: 1.5 }}>
          Para publicar ou guardar notícias precisas de ter pelo menos uma conta de rede social ligada.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={onGoToSocial}
            style={{
              padding: '10px 0', borderRadius: 8, border: 'none',
              background: '#2563EB', color: '#fff', fontWeight: 600,
              fontSize: '.9rem', cursor: 'pointer',
            }}
          >
            Ir para Redes Sociais
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '10px 0', borderRadius: 8, border: '1px solid #E5E7EB',
              background: '#fff', color: '#374151', fontWeight: 500,
              fontSize: '.9rem', cursor: 'pointer',
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// SVG placeholder para notícias sem imagem
function ImagePlaceholder() {
  return (
    <div className="news-card-image-placeholder">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
        <path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>
      </svg>
    </div>
  );
}

// ── Card para artigos do agente ─────────────────────────────────────
function AgentArticleCard({ item, connectedAccounts, selection, onTogglePlatform, onSetCompany, onPublish, onSave }) {
  const companies = buildCompanies(connectedAccounts);
  const selectedId = selection?.companyId || companies[0]?.id;
  const selectedCompany = companies.find(c => c.id === selectedId) || companies[0];

  return (
    <article className="news-card">
      {/* Imagem — sempre visível (placeholder se não houver URL) */}
      <div className="news-card-image">
        {item.imageUrl
          ? <img src={item.imageUrl} alt={item.title} loading="lazy" />
          : <ImagePlaceholder />
        }
      </div>

      <div className="news-card-content">
        <div className="news-card-meta">
          <SectorBadge category={item.category} />
          {item.source && <span className="news-meta-text">Fonte: {item.source}</span>}
        </div>

        <h2 className="news-card-title">{item.title}</h2>
        <p className="news-card-body">{item.content}</p>

        {/* 1 dropdown com todas as empresas + checkboxes das redes dessa empresa */}
        {companies.length > 0 && (
          <div className="card-platforms">
            <span className="card-platforms-label">Publicar em:</span>
            <div className="card-platform-item card-platform-item--on">
              {/* Dropdown único com todas as empresas */}
              <select
                value={selectedId || ''}
                onChange={e => onSetCompany(e.target.value)}
              >
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {/* Avatar da empresa selecionada */}
              {selectedCompany?.picture && (
                <img src={selectedCompany.picture} alt="" className="card-platform-avatar" />
              )}
              {/* Checkboxes apenas das redes dessa empresa */}
              {(selectedCompany?.platforms || []).map(pid => {
                const platform = SOCIAL_PLATFORMS.find(p => p.id === pid);
                const isOn = selection?.platforms?.includes(pid) ?? true;
                return (
                  <label key={pid} className="card-platform-check">
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => onTogglePlatform(pid)}
                    />
                    <span>{platform?.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="news-card-footer">
          {item.publishedAt && <span>Publicado: {formatDate(item.publishedAt)}</span>}
          <span>Recebido: {formatDate(item.receivedAt)}</span>
        </div>
      </div>

      <div className="news-card-actions">
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            Ver notícia
          </a>
        )}
        <button className="btn btn-success" onClick={() => onPublish(item)}>Publicar</button>
        <button className="btn btn-primary" style={{ background: 'var(--gray-600)', borderColor: 'var(--gray-600)' }} onClick={() => onSave(item)}>
          Guardar
        </button>
      </div>
    </article>
  );
}

// ── Card para artigos já guardados na BD ───────────────────────────
function SavedArticleCard({ item, connectedAccounts, onPublish }) {
  const companies = buildCompanies(connectedAccounts || {});
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id || null);
  const [selectedPlatforms, setSelectedPlatforms] = useState(companies[0]?.platforms ? [...companies[0].platforms] : []);
  const [selectedAccounts, setSelectedAccounts] = useState(companies[0]?.accountIds || {});

  function handleSetCompany(companyId) {
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    setSelectedCompanyId(companyId);
    setSelectedPlatforms([...company.platforms]);
    setSelectedAccounts({ ...company.accountIds });
  }

  function togglePlatform(pid) {
    setSelectedPlatforms(prev =>
      prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
    );
  }

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || companies[0];

  return (
    <article className="news-card">
      <div className="news-card-image">
        {item.imageUrl
          ? <img src={item.imageUrl} alt={item.title} loading="lazy" />
          : <ImagePlaceholder />
        }
      </div>

      <div className="news-card-content">
        <div className="news-card-meta">
          <span className={`badge badge-${item.status}`}>
            {STATUS_LABELS[item.status] || item.status}
          </span>
          <SectorBadge category={item.category} />
          {item.source && <span className="news-meta-text">Fonte: {item.source}</span>}
        </div>

        <h2 className="news-card-title">{item.title}</h2>
        <p className="news-card-body">{item.content}</p>

        {item.status === 'on_hold' && companies.length > 0 && (
          <div className="card-platforms">
            <span className="card-platforms-label">Publicar em:</span>
            <div className="card-platform-item card-platform-item--on">
              <select value={selectedCompanyId || ''} onChange={e => handleSetCompany(e.target.value)}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {selectedCompany?.picture && (
                <img src={selectedCompany.picture} alt="" className="card-platform-avatar" />
              )}
              {(selectedCompany?.platforms || []).map(pid => {
                const platform = SOCIAL_PLATFORMS.find(p => p.id === pid);
                return (
                  <label key={pid} className="card-platform-check">
                    <input type="checkbox" checked={selectedPlatforms.includes(pid)} onChange={() => togglePlatform(pid)} />
                    <span>{platform?.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="news-card-footer">
          {item.publishedAt && <span>Publicado: {formatDate(item.publishedAt)}</span>}
          {item.processedAt && (
            <span>
              {item.status === 'published' ? 'Publicada' : 'Guardada'} em {formatDate(item.processedAt)}
              {item.processedBy && ` · por ${item.processedBy}`}
            </span>
          )}
        </div>
      </div>

      <div className="news-card-actions">
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            Ver notícia
          </a>
        )}
        {item.status === 'on_hold' && onPublish && (
          <button className="btn btn-success" onClick={() => onPublish(item, selectedPlatforms, selectedAccounts)}>
            Publicar
          </button>
        )}
      </div>
    </article>
  );
}

// ── localStorage helpers ────────────────────────────────────────────
const LS_KEY = 'pending_articles';
function loadPending() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function savePending(articles) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(articles)); } catch {}
}

// ── Página principal ────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');

  // Artigos do agente (localStorage)
  const [pendingArticles, setPendingArticles] = useState([]);
  // Seleção de plataformas/contas por artigo
  const [articleSelections, setArticleSelections] = useState({});

  // Artigos da BD (publicados / em espera)
  const [news, setNews] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, published: 0, on_hold: 0 });
  const [filterStatus, setFilterStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [totalNews, setTotalNews] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState('a ligar...');
  const [toast, setToast] = useState(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [lastAgentRun, setLastAgentRun] = useState(null);

  // Contas sociais conectadas
  const [connectedAccounts, setConnectedAccounts] = useState({});
  const [showNoSocialModal, setShowNoSocialModal] = useState(false);

  const loadingRef = useRef(false);
  const toastTimer = useRef(null);
  const fetchRef = useRef(null);
  const isMountedRef = useRef(true);

  function showToast(message, type = 'info') {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // Carrega pendentes + contas no arranque
  useEffect(() => {
    const stored = loadPending();
    setPendingArticles(stored);
    setCounts(prev => ({ ...prev, pending: stored.length }));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    fetch('/api/social/accounts', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setConnectedAccounts(data.accounts || {}))
      .catch(() => {});
  }, []);

  // Inicializa seleção por empresa para novos artigos
  useEffect(() => {
    if (pendingArticles.length === 0) return;
    const companies = buildCompanies(connectedAccounts);
    const firstCompany = companies[0];
    setArticleSelections(prev => {
      const updated = { ...prev };
      for (const article of pendingArticles) {
        if (!updated[article.id]) {
          updated[article.id] = {
            companyId: firstCompany?.id || null,
            platforms: firstCompany ? [...firstCompany.platforms] : [],
            accounts:  firstCompany ? { ...firstCompany.accountIds } : {},
          };
        }
      }
      return updated;
    });
  }, [pendingArticles, connectedAccounts]);

  // ── Fetch da BD (publicadas / em espera) ─────────────────────────
  const fetchNews = useCallback(async ({ force = false, notify = false } = {}) => {
    if (loadingRef.current && !force) return;
    loadingRef.current = true;
    setLoading(true);

    if (filterStatus === 'pending') {
      const stored = loadPending();
      setPendingArticles(stored);
      const start = (page - 1) * PAGE_SIZE;
      setNews(stored.slice(start, start + PAGE_SIZE));
      setTotalNews(stored.length);
      setTotalPages(Math.max(1, Math.ceil(stored.length / PAGE_SIZE)));
      // Busca também os contadores do Supabase para published/on_hold
      const token = localStorage.getItem('auth_token');
      if (token) {
        fetch(`/api/news?limit=1&page=1&status=published`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data && isMountedRef.current) {
              setCounts({ pending: stored.length, published: data.counts?.published || 0, on_hold: data.counts?.on_hold || 0 });
            }
          }).catch(() => {});
      } else {
        setCounts(prev => ({ ...prev, pending: stored.length }));
      }
      loadingRef.current = false;
      if (isMountedRef.current) setLoading(false);
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) { loadingRef.current = false; setLoading(false); return; }

    const params = new URLSearchParams({ limit: PAGE_SIZE, page: page.toString(), _: Date.now().toString() });
    params.set('status', filterStatus);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`/api/news?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNews(data.news || []);
      const localPending = loadPending().length;
      setCounts({
        pending:   localPending,
        published: data.counts?.published || 0,
        on_hold:   data.counts?.on_hold   || 0,
      });
      setTotalNews(data.total || 0);
      setTotalPages(data.totalPages || 1);
      if (data.totalPages && page > data.totalPages) setPage(data.totalPages);
      if (notify) showToast('Notícias atualizadas', 'success');
    } catch {
      if (notify) showToast('Erro ao atualizar notícias', 'error');
    } finally {
      clearTimeout(timeoutId);
      loadingRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  }, [filterStatus, page, router]);

  useEffect(() => { fetchRef.current = fetchNews; }, [fetchNews]);
  useEffect(() => { return () => { isMountedRef.current = false; clearTimeout(toastTimer.current); }; }, []);

  // Auth check
  useEffect(() => {
    migrateAuthToken(); // migra token antigo do sessionStorage se necessário
    const token  = localStorage.getItem('auth_token');
    const expiry = parseInt(localStorage.getItem('token_expiry') || '0', 10);
    if (!token || Date.now() > expiry) { clearAuth(); router.replace('/'); return; }
    fetch('/api/verify', { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        if (!res.ok) { clearAuth(); router.replace('/'); return; }
        const data = await res.json();
        setUsername(data.username || 'admin');
      })
      .catch(() => { clearAuth(); router.replace('/'); });
  }, [router]);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  // Supabase Realtime
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const pollTimer = setInterval(() => fetchRef.current?.(), 60000);
    if (!supabaseUrl || supabaseUrl.includes('xxxx')) {
      setLiveStatus('Supabase não configurado');
      return () => clearInterval(pollTimer);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const channel = supabase
      .channel('news-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, () => fetchRef.current?.())
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setLiveStatus('ao vivo');
        if (status === 'CHANNEL_ERROR') setLiveStatus('polling 60s');
        if (status === 'CLOSED') setLiveStatus('desligado');
      });
    return () => { clearInterval(pollTimer); supabase.removeChannel(channel); };
  }, []);

  // ── Seleção de plataformas por artigo ─────────────────────────────
  function toggleArticlePlatform(articleId, platformId) {
    setArticleSelections(prev => {
      const cur = prev[articleId] || { companyId: null, platforms: [], accounts: {} };
      const platforms = cur.platforms.includes(platformId)
        ? cur.platforms.filter(p => p !== platformId)
        : [...cur.platforms, platformId];
      return { ...prev, [articleId]: { ...cur, platforms } };
    });
  }

  // Muda a empresa selecionada: atualiza companyId, platforms e accounts
  function setArticleCompany(articleId, companyId) {
    const companies = buildCompanies(connectedAccounts);
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    setArticleSelections(prev => ({
      ...prev,
      [articleId]: {
        ...prev[articleId],
        companyId,
        platforms: [...company.platforms],
        accounts:  { ...(prev[articleId]?.accounts || {}), ...company.accountIds },
      },
    }));
  }

  // Remove artigo do localStorage e atualiza estado
  function removePending(articleId) {
    const updated = pendingArticles.filter(a => a.id !== articleId);
    savePending(updated);
    setPendingArticles(updated);
    setNews(prev => prev.filter(n => n.id !== articleId));
    setTotalNews(prev => Math.max(0, prev - 1));
    setCounts(prev => ({ ...prev, pending: updated.length }));
  }

  // ── Executar agente ───────────────────────────────────────────────
  async function runAgentManually() {
    if (agentRunning) return;
    setAgentRunning(true);
    const token = localStorage.getItem('auth_token');
    if (!token) { setAgentRunning(false); clearAuth(); router.replace('/'); return; }
    try {
      const res = await fetch('/api/agent/run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error || 'Erro ao executar agente', 'error'); return; }
      setLastAgentRun(data);
      if (Array.isArray(data.articles) && data.articles.length > 0) {
        const existing = loadPending();
        const normalizeUrl = u => String(u || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
        const existingUrls = new Set(existing.map(a => normalizeUrl(a.url)).filter(Boolean));
        const fresh = data.articles.filter(a => !existingUrls.has(normalizeUrl(a.url)));
        if (fresh.length > 0) {
          const updated = [...fresh, ...existing];
          savePending(updated);
          setPendingArticles(updated);
          setCounts(prev => ({ ...prev, pending: updated.length }));
          showToast(`${fresh.length} notícia(s) nova(s) para revisão`, 'success');
        } else {
          showToast('Sem notícias novas (todas já estão em revisão)', 'info');
        }
        setFilterStatus('pending');
        setPage(1);
      } else {
        showToast('Agente concluído: nenhuma notícia nova encontrada', 'info');
      }
    } catch {
      showToast('Erro de ligação ao executar agente', 'error');
    } finally {
      setAgentRunning(false);
    }
  }

  function hasConnectedAccounts() {
    return Object.values(connectedAccounts).some(arr => Array.isArray(arr) && arr.length > 0);
  }

  // ── Publicar artigo ───────────────────────────────────────────────
  async function handlePublish(item) {
    if (!hasConnectedAccounts()) { setShowNoSocialModal(true); return; }
    const token = localStorage.getItem('auth_token');
    const sel = articleSelections[item.id] || { platforms: [], accounts: {} };
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(item.id)}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: item,
          socialPlatforms: sel.platforms,
          selectedAccounts: sel.accounts,
        }),
      });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao publicar', 'error'); return; }
      removePending(item.id);
      showToast('Notícia publicada com sucesso!', 'success');
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  // ── Publicar artigo guardado (on_hold → published) ───────────────
  async function handlePublishSaved(item, platforms, accounts) {
    if (!hasConnectedAccounts()) { setShowNoSocialModal(true); return; }
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(item.id)}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: item, socialPlatforms: platforms, selectedAccounts: accounts }),
      });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao publicar', 'error'); return; }
      showToast('Notícia publicada com sucesso!', 'success');
      fetchNews({ force: true });
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  // ── Guardar artigo (on_hold) ──────────────────────────────────────
  async function handleSave(item) {
    if (!hasConnectedAccounts()) { setShowNoSocialModal(true); return; }
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(item.id)}/save`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: item }),
      });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao guardar', 'error'); return; }
      removePending(item.id);
      showToast('Notícia guardada!', 'success');
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  // Artigos a mostrar
  const displayedNews = filterStatus === 'pending'
    ? pendingArticles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : news;

  return (
    <div className="dashboard-page">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="#2563EB"/>
              <path d="M10 28V14h4l6 9 6-9h4v14h-4V20l-6 8-6-8v8H10Z" fill="white"/>
            </svg>
            <span>Dashboard de Notícias</span>
          </div>
          <nav className="header-nav">
            <button className="header-nav-item active">Notícias</button>
            <button className="header-nav-item" onClick={() => router.push('/social')}>Redes Sociais</button>
          </nav>
          <div className="header-actions">
            <div className="live-badge">
              <span className={`live-dot ${liveStatus === 'ao vivo' ? 'live-dot--on' : 'live-dot--off'}`}/>
              {liveStatus}
            </div>
            <div className="user-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
              </svg>
              <span>{username}</span>
            </div>
            <button className="btn btn-ghost btn-danger" onClick={() => { clearAuth(); router.replace('/'); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
              </svg>
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Stat cards */}
        <div className="stats-bar">
          <div className="stat-card stat-pending" style={{ cursor: 'pointer' }} onClick={() => { setFilterStatus('pending'); setPage(1); }}>
            <div className="stat-value">{counts.pending}</div>
            <div className="stat-label">Para Revisão</div>
          </div>
          <div className="stat-card stat-published" style={{ cursor: 'pointer' }} onClick={() => { setFilterStatus('published'); setPage(1); }}>
            <div className="stat-value">{counts.published}</div>
            <div className="stat-label">Publicadas</div>
          </div>
          <div className="stat-card stat-onhold" style={{ cursor: 'pointer' }} onClick={() => { setFilterStatus('on_hold'); setPage(1); }}>
            <div className="stat-value">{counts.on_hold}</div>
            <div className="stat-label">Em Espera</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <div className="filter-tabs" role="tablist">
            {[
              { status: 'pending',   label: `Para Revisão (${counts.pending})` },
              { status: 'published', label: 'Publicadas' },
              { status: 'on_hold',   label: 'Em Espera' },
            ].map(({ status, label }) => (
              <button
                key={status}
                className={`filter-tab${filterStatus === status ? ' active' : ''}`}
                role="tab"
                onClick={() => { setFilterStatus(status); setPage(1); }}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={runAgentManually} disabled={agentRunning}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3l14 9-14 9V3z"/>
            </svg>
            {agentRunning ? 'A executar...' : 'Executar agente'}
          </button>
          <button className="btn btn-ghost" onClick={() => fetchNews({ force: true, notify: true })} disabled={loading || agentRunning}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
            </svg>
            Atualizar
          </button>
        </div>

        {lastAgentRun?.run_id && (
          <div className="agent-run-info">
            Última execução: <strong>{lastAgentRun.run_id}</strong>
            {' · '}{lastAgentRun.status}
            {typeof lastAgentRun.selected_count === 'number' && ` · ${lastAgentRun.selected_count} artigo(s) selecionado(s)`}
          </div>
        )}

        {filterStatus === 'pending' && pendingArticles.length === 0 && !loading && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: '.875rem', color: '#1D4ED8' }}>
            Sem notícias para revisão. Clica em <strong>Executar agente</strong> para ir buscar notícias novas.
          </div>
        )}

        {/* Lista de notícias */}
        <div className="news-list">
          {loading && displayedNews.length === 0 ? (
            <div className="empty-state">
              <div className="loader" style={{ width: 32, height: 32, borderColor: 'rgba(0,0,0,.12)', borderTopColor: 'var(--blue-600)' }}/>
            </div>
          ) : displayedNews.length === 0 ? (
            <div className="empty-state">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
                <path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>
              </svg>
              <p>Sem notícias para mostrar</p>
            </div>
          ) : filterStatus === 'pending' ? (
            displayedNews.map(item => (
              <AgentArticleCard
                key={item.id}
                item={item}
                connectedAccounts={connectedAccounts}
                selection={articleSelections[item.id]}
                onTogglePlatform={pid => toggleArticlePlatform(item.id, pid)}
                onSetCompany={cid => setArticleCompany(item.id, cid)}
                onPublish={handlePublish}
                onSave={handleSave}
              />
            ))
          ) : (
            displayedNews.map(item => (
              <SavedArticleCard
                key={item.id}
                item={item}
                connectedAccounts={connectedAccounts}
                onPublish={filterStatus === 'on_hold' ? handlePublishSaved : null}
              />
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1}>
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
              {totalNews > 0 && ` · ${Math.min((page - 1) * PAGE_SIZE + 1, totalNews)}-${Math.min(page * PAGE_SIZE, totalNews)} de ${totalNews}`}
            </span>
            <button className="btn btn-ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={loading || page >= totalPages}>
              Seguinte
            </button>
          </div>
        )}
      </main>

      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert" aria-live="polite">
          {toast.message}
        </div>
      )}

      {showNoSocialModal && (
        <NoSocialModal
          onClose={() => setShowNoSocialModal(false)}
          onGoToSocial={() => router.push('/social')}
        />
      )}
    </div>
  );
}
