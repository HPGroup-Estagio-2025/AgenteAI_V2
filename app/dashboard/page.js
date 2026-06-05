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
  on_hold:   'Guardada',
  pending:   'Pendente',
};

const SOCIAL_PLATFORMS = [
  { id: 'facebook',  label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin',  label: 'LinkedIn' },
  { id: 'wordpress', label: 'Website' },
];

// Constrói lista de empresas a partir das contas ligadas.
// Meta (Facebook + Instagram) partilham a mesma entrada; LinkedIn é separado.
// companiesData: lista de empresas do Supabase (com campos wordpress_*)
function buildCompanies(connectedAccounts, companiesData = []) {
  console.log('[buildCompanies] Contas recebidas:', connectedAccounts);
  const fbAccs = connectedAccounts.facebook  || [];
  const igAccs = connectedAccounts.instagram || [];
  const liAccs = connectedAccounts.linkedin  || [];
  console.log('[buildCompanies] FB:', fbAccs.length, 'IG:', igAccs.length, 'LI:', liAccs.length);

  const metaCompanies = new Map();
  const getMetaKey = acc => acc.companyId || acc.companyName || 'unassigned-meta';

  // Helper: resolve o nome real da empresa a partir de companiesData
  function resolveCompanyName(acc) {
    if (acc.companyId) {
      const dbCompany = companiesData.find(c => c.id === acc.companyId);
      if (dbCompany?.name) return dbCompany.name;
    }
    return acc.companyName || null;
  }

  function upsertMetaAccount(acc, platform) {
    const key = getMetaKey(acc);
    const current = metaCompanies.get(key) || {
      id:         `meta-${key}`,
      companyId:  acc.companyId || null,
      name:       resolveCompanyName(acc) || 'Conta Meta',
      picture:    acc.picture,
      platforms:  [],
      accountIds: {},
    };
    // Atualiza o nome se ainda não foi resolvido (caso companiesData carregue depois)
    if (current.name === 'Conta Meta') {
      const resolved = resolveCompanyName(acc);
      if (resolved) current.name = resolved;
    }
    if (!current.platforms.includes(platform)) current.platforms.push(platform);
    current.accountIds[platform] = acc.id;
    if (!current.picture && acc.picture) current.picture = acc.picture;
    metaCompanies.set(key, current);
  }

  fbAccs.forEach(acc => upsertMetaAccount(acc, 'facebook'));
  igAccs.forEach(acc => upsertMetaAccount(acc, 'instagram'));

  const companies = [...metaCompanies.values()];

  // Adiciona WordPress se a empresa tiver WordPress configurado
  for (const company of companies) {
    if (company.companyId) {
      const dbCompany = companiesData.find(c => c.id === company.companyId);
      if (dbCompany?.name) company.name = dbCompany.name; // garante nome atualizado
      if (dbCompany?.wordpress_url && dbCompany?.wordpress_username && dbCompany?.wordpress_app_password) {
        if (!company.platforms.includes('wordpress')) company.platforms.push('wordpress');
      }
    }
  }

  // LinkedIn: cada conta é uma entrada independente
  for (const acc of liAccs) {
    const dbCompany = acc.companyId ? companiesData.find(c => c.id === acc.companyId) : null;
    companies.push({
      id:         `linkedin-${acc.id}`,
      companyId:  acc.companyId || null,
      name:       dbCompany?.name || acc.companyName || acc.name,
      picture:    acc.picture,
      platforms:  ['linkedin'],
      accountIds: { linkedin: acc.id },
    });
  }

  // Adiciona empresas do Supabase que ainda não estão representadas por nenhuma conta social
  const representedCompanyIds = new Set(companies.map(c => c.companyId).filter(Boolean));
  for (const dbCompany of companiesData) {
    if (representedCompanyIds.has(dbCompany.id)) continue;
    const platforms = [];
    if (dbCompany.wordpress_url && dbCompany.wordpress_username && dbCompany.wordpress_app_password) {
      platforms.push('wordpress');
    }
    companies.push({
      id:         `db-${dbCompany.id}`,
      companyId:  dbCompany.id,
      name:       dbCompany.name,
      picture:    null,
      platforms,
      accountIds: {},
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
function AgentArticleCard({ item, connectedAccounts, companiesData, selection, onTogglePlatform, onSetCompany, onPublish, onSave, isSelected, onToggleSelect, bulkStatus }) {
  const companies = buildCompanies(connectedAccounts, companiesData);
  const selectedId = selection?.companyId || companies[0]?.id;
  const selectedCompany = companies.find(c => c.id === selectedId) || companies[0];

  const bulkStatusColor = bulkStatus === 'success' ? '#10B981' : bulkStatus === 'error' ? '#DC2626' : bulkStatus === 'publishing' ? '#7C3AED' : null;

  return (
    <article className="news-card" style={{ ...(bulkStatusColor ? { outline: `2px solid ${bulkStatusColor}` } : {}), position: 'relative' }}>
      {/* Checkbox de seleção múltipla — canto superior esquerdo sobre a imagem */}
      {onToggleSelect && (
        <div className="news-card-checkbox">
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={onToggleSelect}
          />
        </div>
      )}
      {/* Imagem — sempre visível (placeholder se não houver URL) */}
      <div className="news-card-image">
        {item.imageUrl
          ? <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              onError={e => {
                const proxy = `https://wsrv.nl/?url=${encodeURIComponent(item.imageUrl)}&w=300&h=200&fit=cover&output=jpg`;
                if (e.target.src !== proxy) e.target.src = proxy;
                else e.target.style.display = 'none';
              }}
            />
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
function SavedArticleCard({ item, connectedAccounts, companiesData, onPublish, onRemove }) {
  const companies = buildCompanies(connectedAccounts || {}, companiesData);
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
          ? <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              onError={e => {
                const proxy = `https://wsrv.nl/?url=${encodeURIComponent(item.imageUrl)}&w=300&h=200&fit=cover&output=jpg`;
                if (e.target.src !== proxy) e.target.src = proxy;
                else e.target.style.display = 'none';
              }}
            />
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
          <button className="btn btn-success" onClick={() => onPublish(item, selectedPlatforms, selectedAccounts, selectedCompany?.companyId || null)}>
            Publicar
          </button>
        )}
        {item.status === 'on_hold' && onRemove && (
          <button
            className="btn btn-ghost btn-danger"
            title="Remover notícia"
            onClick={() => onRemove(item)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
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
  const [companiesData, setCompaniesData] = useState([]);
  const [showNoSocialModal, setShowNoSocialModal] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({});
  const [filterSector, setFilterSector] = useState('');

  const loadingRef = useRef(false);
  const toastTimer = useRef(null);
  const fetchRef = useRef(null);
  const isMountedRef = useRef(true);

  function showToast(message, type = 'info') {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // Carrega pendentes no arranque
  useEffect(() => {
    const stored = loadPending();
    setPendingArticles(stored);
    setCounts(prev => ({ ...prev, pending: stored.length }));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    // Função para carregar contas
    const loadAccounts = () => {
      fetch('/api/social/accounts', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          const accounts = data.accounts || {};
          console.log('[dashboard] Contas carregadas:', Object.keys(accounts));
          setConnectedAccounts(accounts);
        })
        .catch(err => {
          console.error('[dashboard] Erro ao carregar contas:', err);
          setConnectedAccounts({});
        });
      fetch('/api/companies', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => setCompaniesData(data.companies || []))
        .catch(() => setCompaniesData([]));
    };

    // Carrega imediatamente
    loadAccounts();

    // Recarrega a cada 3 segundos (mais rápido para sincronizar)
    const interval = setInterval(loadAccounts, 3000);

    return () => clearInterval(interval);
  }, []);

  // Inicializa seleção por empresa para novos artigos
  useEffect(() => {
    if (pendingArticles.length === 0) return;
    const companies = buildCompanies(connectedAccounts, companiesData);
    const firstCompany = companies[0];
    setArticleSelections(prev => {
      const updated = { ...prev };
      for (const article of pendingArticles) {
        // Re-avalia plataformas mesmo para artigos já existentes (ex: WordPress adicionado)
        const existing = updated[article.id];
        const company = existing?.companyId
          ? companies.find(c => c.id === existing.companyId) || firstCompany
          : firstCompany;
        updated[article.id] = {
          companyId: existing?.companyId || company?.id || null,
          platforms: company ? [...company.platforms] : [],
          accounts:  company ? { ...company.accountIds } : {},
        };
      }
      return updated;
    });
  }, [pendingArticles, connectedAccounts, companiesData]);

  // ── Fetch da BD (publicadas / em espera) ─────────────────────────
  const fetchNews = useCallback(async ({ force = false, notify = false, sector: sectorOverride } = {}) => {
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
      if (notify) showToast('Notícias atualizadas', 'success');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) { loadingRef.current = false; setLoading(false); return; }

    const params = new URLSearchParams({ limit: PAGE_SIZE, page: page.toString(), _: Date.now().toString() });
    params.set('status', filterStatus);
    const activeSector = sectorOverride !== undefined ? sectorOverride : filterSector;
    if (activeSector) params.set('sector', activeSector);
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
  }, [filterStatus, page, filterSector, router]);

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
    const companies = buildCompanies(connectedAccounts, companiesData);
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
        const existingUrls = new Set(existing.map(a => a.url).filter(Boolean));
        const existingTitles = new Set(existing.map(a => a.title?.toLowerCase().trim()).filter(Boolean));
        const newArticles = data.articles.filter(a =>
          !(a.url && existingUrls.has(a.url)) &&
          !(a.title && existingTitles.has(a.title?.toLowerCase().trim()))
        );
        const merged = [...existing, ...newArticles];
        savePending(merged);
        setPendingArticles(merged);
        setCounts(prev => ({ ...prev, pending: merged.length }));
        const msg = newArticles.length > 0
          ? `${newArticles.length} nova(s) notícia(s) carregadas para revisão`
          : 'Agente concluído: sem notícias novas (duplicados ignorados)';
        showToast(msg, newArticles.length > 0 ? 'success' : 'info');
        setFilterStatus('pending');
        setPage(1);
      } else {
        showToast('Agente concluído: nenhuma notícia encontrada', 'info');
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

  // ── Publicar múltiplos artigos em sequência ───────────────────────
  async function handleBulkPublish() {
    if (bulkPublishing || bulkSelected.size === 0) return;
    if (!hasConnectedAccounts()) { setShowNoSocialModal(true); return; }
    setBulkPublishing(true);
    setBulkProgress({});
    const articlesToPublish = pendingArticles.filter(a => bulkSelected.has(a.id));
    let successCount = 0;
    let errorCount = 0;

    for (const item of articlesToPublish) {
      setBulkProgress(prev => ({ ...prev, [item.id]: 'publishing' }));
      const token = localStorage.getItem('auth_token');
      const sel = articleSelections[item.id] || { platforms: [], accounts: {} };
      const companies = buildCompanies(connectedAccounts, companiesData);
      const selectedCompany = companies.find(c => c.id === sel.companyId) || companies[0];
      const realCompanyId = selectedCompany?.companyId || null;

      if (!sel.platforms || sel.platforms.length === 0) {
        setBulkProgress(prev => ({ ...prev, [item.id]: 'error' }));
        errorCount++;
        continue;
      }

      try {
        const res = await fetch(`/api/news/${encodeURIComponent(item.id)}/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            article: item,
            socialPlatforms: sel.platforms,
            selectedAccounts: sel.accounts,
            companyId: realCompanyId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setBulkProgress(prev => ({ ...prev, [item.id]: 'success' }));
          removePending(item.id);
          successCount++;
        } else if (data.alreadyPublished) {
          setBulkProgress(prev => ({ ...prev, [item.id]: 'success' }));
          removePending(item.id);
          successCount++;
        } else {
          setBulkProgress(prev => ({ ...prev, [item.id]: 'error' }));
          errorCount++;
        }
      } catch {
        setBulkProgress(prev => ({ ...prev, [item.id]: 'error' }));
        errorCount++;
      }
    }

    setBulkPublishing(false);
    setBulkSelected(new Set());
    if (successCount > 0) showToast(`${successCount} notícia(s) publicada(s) com sucesso!`, 'success');
    if (errorCount > 0) showToast(`${errorCount} notícia(s) falharam. Verifica as configurações.`, 'error');
    fetchNews({ force: true });
  }

  // ── Publicar artigo ───────────────────────────────────────────────
  async function handlePublish(item) {
    if (!hasConnectedAccounts()) { setShowNoSocialModal(true); return; }
    const token = localStorage.getItem('auth_token');
    const sel = articleSelections[item.id] || { platforms: [], accounts: {} };
    if (!sel.platforms || sel.platforms.length === 0) {
      showToast('Seleciona pelo menos uma rede social para publicar.', 'error');
      return;
    }
    // Resolve o UUID real da empresa (sel.companyId é o ID interno do frontend)
    const companies = buildCompanies(connectedAccounts, companiesData);
    const selectedCompany = companies.find(c => c.id === sel.companyId) || companies[0];
    const realCompanyId = selectedCompany?.companyId || null;
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(item.id)}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: item,
          socialPlatforms: sel.platforms,
          selectedAccounts: sel.accounts,
          companyId: realCompanyId,
        }),
      });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      if (!res.ok) {
        if (data.alreadyPublished) {
          removePending(item.id);
          showToast('Notícia já estava publicada. Removida da revisão.', 'info');
          return;
        }
        showToast(data.error || 'Erro ao publicar', 'error');
        return;
      }
      removePending(item.id);
      showToast('Notícia publicada com sucesso!', 'success');
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  // ── Publicar artigo guardado (on_hold → published) ───────────────
  async function handlePublishSaved(item, platforms, accounts, companyId = null) {
    if (!hasConnectedAccounts()) { setShowNoSocialModal(true); return; }
    if (!platforms || platforms.length === 0) {
      showToast('Seleciona pelo menos uma rede social para publicar.', 'error');
      return;
    }
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(item.id)}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: item, socialPlatforms: platforms, selectedAccounts: accounts, companyId }),
      });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      if (!res.ok) {
        if (data.alreadyPublished) {
          showToast('Notícia já estava publicada.', 'info');
          fetchNews({ force: true });
          return;
        }
        showToast(data.error || 'Erro ao publicar', 'error');
        return;
      }
      showToast('Notícia publicada com sucesso!', 'success');
      fetchNews({ force: true });
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  // ── Remover artigo guardado (on_hold → rejected) ─────────────────
  async function handleRemoveSaved(item) {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(item.id)}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401 || res.status === 403) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao remover notícia', 'error'); return; }
      showToast('Notícia removida.', 'info');
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

  // Artigos filtrados por setor (pendentes — filtro local)
  const sectorFilteredPending = filterSector
    ? pendingArticles.filter(a => (a.category || '').toLowerCase() === filterSector)
    : pendingArticles;

  // Contagens por setor
  const sectorCounts = filterStatus === 'pending'
    ? Object.fromEntries(Object.keys(SECTOR_MAP).map(s => [s, pendingArticles.filter(a => (a.category || '').toLowerCase() === s).length]))
    : Object.fromEntries(Object.keys(SECTOR_MAP).map(s => [s, news.filter(a => (a.category || '').toLowerCase() === s).length]));

  // Total para o badge "Todos"
  const sectorTotalCount = filterStatus === 'pending' ? pendingArticles.length : totalNews;

  // Artigos a mostrar
  const displayedNews = filterStatus === 'pending'
    ? sectorFilteredPending.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : news;

  return (
    <div className="dashboard-page">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <img src="/robot-logo.svg" width="36" height="36" alt="Publixy" style={{borderRadius:8}} />
            <span>Publixy</span>
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
          <div className="stat-card stat-pending" onClick={() => { setFilterStatus('pending'); setPage(1); setFilterSector(''); }}>
            <div className="stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="stat-text">
              <div className="stat-value">{counts.pending}</div>
              <div className="stat-label">Para Revisão</div>
            </div>
          </div>
          <div className="stat-card stat-published" onClick={() => { setFilterStatus('published'); setPage(1); setFilterSector(''); }}>
            <div className="stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div className="stat-text">
              <div className="stat-value">{counts.published}</div>
              <div className="stat-label">Publicadas</div>
            </div>
          </div>
          <div className="stat-card stat-onhold" onClick={() => { setFilterStatus('on_hold'); setPage(1); setFilterSector(''); }}>
            <div className="stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
            </div>
            <div className="stat-text">
              <div className="stat-value">{counts.on_hold}</div>
              <div className="stat-label">Guardados</div>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          {/* Esquerda */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div className="filter-tabs" role="tablist">
              {[
                { status: 'pending',   label: `Para Revisão (${counts.pending})` },
                { status: 'published', label: 'Publicadas' },
                { status: 'on_hold',   label: 'Guardados' },
              ].map(({ status, label }) => (
                <button
                  key={status}
                  className={`filter-tab${filterStatus === status ? ' active' : ''}`}
                  role="tab"
                  onClick={() => { setFilterStatus(status); setPage(1); setFilterSector(''); }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filterStatus === 'pending' && bulkSelected.size > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: '.8rem', padding: '6px 12px', height: 'auto' }}
                onClick={() => {
                  const visibleIds = sectorFilteredPending.map(a => a.id);
                  const allSelected = visibleIds.every(id => bulkSelected.has(id));
                  setBulkSelected(prev => {
                    const next = new Set(prev);
                    if (allSelected) visibleIds.forEach(id => next.delete(id));
                    else visibleIds.forEach(id => next.add(id));
                    return next;
                  });
                }}
              >
                {sectorFilteredPending.length > 0 && sectorFilteredPending.every(a => bulkSelected.has(a.id))
                  ? 'Desselecionar Tudo' : `Selecionar ${filterSector ? 'Setor' : 'Tudo'}`}
              </button>
            )}
          </div>
          {/* Direita */}
          <button type="button" className={`btn-agent${agentRunning ? ' btn-agent--running' : ''}`} onClick={runAgentManually} disabled={agentRunning}>
            {agentRunning ? (
              <>
                <span className="loader" style={{ width: 15, height: 15, borderColor: 'rgba(255,255,255,.35)', borderTopColor: '#fff' }} />
                A executar...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 8v4l3 3"/><path d="M18 2v4h4"/>
                </svg>
                Executar agente
              </>
            )}
          </button>
        </div>

        {lastAgentRun?.run_id && (
          <div className="agent-run-info">
            Última execução: <strong>{lastAgentRun.run_id}</strong>
            {' · '}{lastAgentRun.status}
            {typeof lastAgentRun.selected_count === 'number' && ` · ${lastAgentRun.selected_count} artigo(s) selecionado(s)`}
          </div>
        )}

        {/* Barra de filtro por setor */}
        {(filterStatus === 'pending' ? pendingArticles.length > 0 : news.length > 0 || filterSector !== '') && (
          <div className="sector-bar" style={{ marginBottom: 16 }}>
            <button
              className={`sector-tab${filterSector === '' ? ' active' : ''}`}
              data-sector=""
              onClick={() => { setFilterSector(''); setPage(1); }}
            >
              Todos
              <span className="sector-count">{sectorTotalCount}</span>
            </button>
            {Object.entries(SECTOR_MAP).map(([key, { label }]) =>
              sectorCounts[key] > 0 || filterSector === key ? (
                <button
                  key={key}
                  className={`sector-tab${filterSector === key ? ' active' : ''}`}
                  data-sector={key}
                  onClick={() => { setFilterSector(key); setPage(1); }}
                >
                  {label}
                  <span className="sector-count">{sectorCounts[key]}</span>
                </button>
              ) : null
            )}
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
                companiesData={companiesData}
                selection={articleSelections[item.id]}
                onTogglePlatform={pid => toggleArticlePlatform(item.id, pid)}
                onSetCompany={cid => setArticleCompany(item.id, cid)}
                onPublish={handlePublish}
                onSave={handleSave}
                isSelected={bulkSelected.has(item.id)}
                onToggleSelect={() => setBulkSelected(prev => {
                  const next = new Set(prev);
                  next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                  return next;
                })}
                bulkStatus={bulkProgress[item.id]}
              />
            ))
          ) : (
            displayedNews.map(item => (
              <SavedArticleCard
                key={item.id}
                item={item}
                connectedAccounts={connectedAccounts}
                companiesData={companiesData}
                onPublish={filterStatus === 'on_hold' ? handlePublishSaved : null}
                onRemove={filterStatus === 'on_hold' ? handleRemoveSaved : null}
              />
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1} aria-label="Anterior">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
              <button
                key={n}
                className={`pagination-btn${n === page ? ' active' : ''}`}
                onClick={() => setPage(n)}
                disabled={loading}
              >
                {n}
              </button>
            ))}
            <button className="pagination-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={loading || page >= totalPages} aria-label="Seguinte">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        )}
      </main>

      {/* ── Carrinho de publicação ─────────────────────────────── */}
      {filterStatus === 'pending' && (
        <div style={{
          position: 'fixed', right: bulkSelected.size > 0 ? 0 : '-340px',
          top: 64, bottom: 0, width: 320,
          background: '#fff', boxShadow: '-4px 0 20px rgba(0,0,0,.12)',
          borderLeft: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column',
          transition: 'right .3s cubic-bezier(.4,0,.2,1)', zIndex: 200,
        }}>
          {/* Header do carrinho */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', background: 'linear-gradient(90deg,#1E0A3C,#2D1B69)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              <span style={{ fontWeight: 700, fontSize: '1rem' }}>Para Publicar</span>
            </div>
            <span style={{ background: '#7C3AED', borderRadius: 12, padding: '2px 10px', fontWeight: 700, fontSize: '.85rem' }}>
              {bulkSelected.size}
            </span>
          </div>

          {/* Lista de artigos selecionados */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingArticles.filter(a => bulkSelected.has(a.id)).map(a => {
              const sel = articleSelections[a.id] || {};
              const companies = buildCompanies(connectedAccounts, companiesData);
              const company = companies.find(c => c.id === sel.companyId) || companies[0];
              const platforms = sel.platforms || [];
              const platformIcons = { facebook: '📘', instagram: '📸', linkedin: '💼', wordpress: '🌐' };
              const statusColor = bulkProgress[a.id] === 'success' ? '#10B981' : bulkProgress[a.id] === 'error' ? '#DC2626' : bulkProgress[a.id] === 'publishing' ? '#7C3AED' : null;
              return (
              <div key={a.id} style={{ background: '#F9FAFB', borderRadius: 8, border: `1px solid ${statusColor || '#E5E7EB'}`, overflow: 'hidden' }}>
                {/* Topo: imagem + título + fechar */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 10px 8px' }}>
                  {a.imageUrl && (
                    <img
                      src={a.imageUrl}
                      alt=""
                      onError={e => { e.target.style.display = 'none'; }}
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                    />
                  )}
                  <p style={{ flex: 1, fontSize: '.78rem', fontWeight: 600, color: '#1F2937', lineHeight: 1.3, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {a.title}
                  </p>
                  <button
                    onClick={() => setBulkSelected(prev => { const n = new Set(prev); n.delete(a.id); return n; })}
                    style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 2, flexShrink: 0 }}
                    title="Remover"
                  >✕</button>
                </div>
                {/* Rodapé: empresa + plataformas */}
                <div style={{ borderTop: '1px solid #E5E7EB', padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {company?.picture && <img src={company.picture} alt="" style={{ width: 16, height: 16, borderRadius: '50%' }} />}
                    <span style={{ fontSize: '.72rem', fontWeight: 600, color: '#374151' }}>{company?.name || '—'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {platforms.length === 0
                      ? <span style={{ fontSize: '.7rem', color: '#EF4444', fontWeight: 500 }}>Sem plataforma</span>
                      : platforms.map(pid => (
                          <span key={pid} style={{ fontSize: '.75rem', background: '#F3F4F6', borderRadius: 4, padding: '2px 6px', color: '#374151' }} title={pid}>
                            {platformIcons[pid] || pid}
                          </span>
                        ))
                    }
                  </div>
                </div>
                {/* Estado da publicação */}
                {bulkProgress[a.id] && (
                  <div style={{ padding: '4px 10px', background: statusColor + '15', borderTop: `1px solid ${statusColor}30` }}>
                    <span style={{ fontSize: '.7rem', fontWeight: 700, color: statusColor }}>
                      {bulkProgress[a.id] === 'success' ? '✓ Publicado com sucesso' : bulkProgress[a.id] === 'error' ? '✗ Erro ao publicar' : '⟳ A publicar...'}
                    </span>
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {/* Botão publicar */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn btn-success"
              style={{ width: '100%', justifyContent: 'center', fontSize: '.95rem', padding: '12px' }}
              onClick={handleBulkPublish}
              disabled={bulkPublishing || bulkSelected.size === 0}
            >
              {bulkPublishing
                ? <><span className="loader" style={{ width: 16, height: 16 }} /> A publicar...</>
                : `Publicar ${bulkSelected.size} notícia${bulkSelected.size !== 1 ? 's' : ''}`
              }
            </button>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', fontSize: '.8rem' }}
              onClick={() => setBulkSelected(new Set())}
              disabled={bulkPublishing}
            >
              Limpar seleção
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert" aria-live="polite">
          {toast.type === 'success' && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><polyline points="20 6 9 17 4 12"/></svg>}
          {toast.type === 'error'   && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
          {toast.type === 'info'    && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>}
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
