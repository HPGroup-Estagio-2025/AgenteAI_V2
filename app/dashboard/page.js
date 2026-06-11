'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

// SECTOR_MAP é agora dinâmico — carregado do Supabase via estado
// Mapa estático apenas para badges CSS dos setores predefinidos
const STATIC_SECTOR_BADGES = {
  'maritimo':       'badge-sector-maritimo',
  'defesa-militar': 'badge-sector-defesa',
  'aeroespacial':   'badge-sector-aeroespacial',
  'ferroviario':    'badge-sector-ferroviario',
  'tecnologia':     'badge-sector-tecnologia',
  'fitness':        'badge-sector-fitness',
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

// Constrói lista de empresas a partir de companiesData (fonte de verdade).
// Contas sociais são associadas às empresas — nunca criam entradas próprias.
// Contas partilhadas (companyId = null) ficam disponíveis em todas as empresas.
function buildCompanies(connectedAccounts, companiesData = []) {
  const fbAccs = connectedAccounts.facebook  || [];
  const igAccs = connectedAccounts.instagram || [];
  const liAccs = connectedAccounts.linkedin  || [];

  // Helper: encontra a conta de uma plataforma para uma empresa
  // Aceita contas ligadas à empresa (companyId match) OU contas partilhadas (companyId = null)
  function findAccount(accs, companyId) {
    return accs.find(a => a.companyId === companyId)
      || accs.find(a => !a.companyId)
      || null;
  }

  const companies = companiesData.map(dbCompany => {
    const fbAcc = findAccount(fbAccs, dbCompany.id);
    const igAcc = findAccount(igAccs, dbCompany.id);
    const liAcc = findAccount(liAccs, dbCompany.id);

    const platforms = [];
    const accountIds = {};

    if (fbAcc) { platforms.push('facebook'); accountIds.facebook = fbAcc.id; }
    if (igAcc) { platforms.push('instagram'); accountIds.instagram = igAcc.id; }
    if (liAcc) { platforms.push('linkedin'); accountIds.linkedin = liAcc.id; }
    if (dbCompany.wordpress_url && dbCompany.wordpress_username && dbCompany.wordpress_app_password) {
      platforms.push('wordpress');
    }

    return {
      id:        `db-${dbCompany.id}`,
      companyId: dbCompany.id,
      name:      dbCompany.name,
      picture:   fbAcc?.picture || igAcc?.picture || liAcc?.picture || null,
      platforms,
      accountIds,
    };
  });

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

function decodeHtml(text) {
  return (text || '')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function cleanContent(item) {
  // 1. Resumo gerado pela IA — melhor opção
  if (item.summary && item.summary.trim().length > 20) return item.summary;

  const title = (item.title || '').toLowerCase().trim();

  function strip(text) {
    return decodeHtml((text || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/Key sectors:[^\n]*/gi, '')
      .replace(/Source:[^\n]*/gi, '')
      .replace(/This article highlights[^.]*\./gi, '')
      .replace(/Sensitive terms[^.]*\./gi, '')
      .replace(/Read the full story here\.?/gi, '')
      .replace(/According to the original report[^.]*\./gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim());
  }

  // Descarta texto que é apenas o título repetido
  function isRedundant(text) {
    const t = text.toLowerCase().trim();
    return t.length < 25 || t === title || title.includes(t) || t.includes(title);
  }

  // Tenta cada fonte por ordem de qualidade
  const candidates = [
    strip(item.description),
    strip(item.excerpt),
    strip(item.content),
  ].filter(t => t.length > 25 && !isRedundant(t));

  const best = candidates[0] || strip(item.content) || strip(item.description) || '';

  if (!best || best.length < 15) return '';

  // Extrai as primeiras 2 frases, máximo 220 chars
  const sentences = best.match(/[^.!?]+[.!?]+/g) || [];
  const summary = sentences.length >= 2
    ? sentences.slice(0, 2).join(' ').trim()
    : sentences[0]?.trim() || best.slice(0, 220);

  return summary.length > 220 ? summary.slice(0, 217) + '...' : summary;
}

function SectorBadge({ category, sectorsMap }) {
  if (!category) return null;
  const cls = STATIC_SECTOR_BADGES[category.toLowerCase()];
  const label = sectorsMap?.[category.toLowerCase()] || category;
  if (cls) return <span className={`badge ${cls}`}>{label}</span>;
  return <span className="badge badge-category">{label}</span>;
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
function AgentArticleCard({ item, companies, selection, onTogglePlatform, onSetCompany, onPublish, onSave, isSelected, onToggleSelect, bulkStatus, isPublishing, sectorsMap }) {
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
          <SectorBadge category={item.category} sectorsMap={sectorsMap} />
          {item.source && <span className="news-meta-text">Fonte: {item.source}</span>}
        </div>

        <h2 className="news-card-title">{decodeHtml(item.title)}</h2>
        <p className="news-card-body">{cleanContent(item)}</p>

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
              {/* Checkboxes em wrapper para grid no mobile */}
              <div className="card-platform-checks-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
        <button className="btn btn-success" onClick={() => onPublish(item)} disabled={isPublishing}>
          {isPublishing ? <><span className="loader" style={{ width: 13, height: 13, borderColor: 'rgba(22,163,74,.3)', borderTopColor: '#16A34A' }} /> A publicar...</> : 'Publicar'}
        </button>
        <button className="btn btn-primary" style={{ background: 'var(--gray-600)', borderColor: 'var(--gray-600)' }} onClick={() => onSave(item)}>
          Guardar
        </button>
      </div>
    </article>
  );
}

// ── Card para artigos já guardados na BD ───────────────────────────
function SavedArticleCard({ item, companies, onPublish, onRemove, isPublishing }) {
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

        <h2 className="news-card-title">{decodeHtml(item.title)}</h2>
        <p className="news-card-body">{cleanContent(item)}</p>

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
          <button className="btn btn-success" onClick={() => onPublish(item, selectedPlatforms, selectedAccounts, selectedCompany?.companyId || null)} disabled={isPublishing}>
            {isPublishing ? <><span className="loader" style={{ width: 13, height: 13, borderColor: 'rgba(22,163,74,.3)', borderTopColor: '#16A34A' }} /> A publicar...</> : 'Publicar'}
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
const LS_SEEN_KEY = 'seen_article_keys'; // histórico de URLs/títulos já vistos
const MAX_SEEN = 1000; // limite para não crescer infinitamente

function loadPending() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function savePending(articles) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(articles)); } catch {}
}
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function addToSeen(articles) {
  try {
    const seen = loadSeen();
    for (const a of articles) {
      if (a.url) seen.add(a.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase());
      if (a.title) seen.add('t:' + a.title.toLowerCase().trim());
    }
    // Mantém só os últimos MAX_SEEN para não crescer sem limite
    const trimmed = [...seen].slice(-MAX_SEEN);
    localStorage.setItem(LS_SEEN_KEY, JSON.stringify(trimmed));
  } catch {}
}
function isAlreadySeen(article) {
  const seen = loadSeen();
  if (article.url) {
    const normUrl = article.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(normUrl)) return true;
  }
  if (article.title) {
    if (seen.has('t:' + article.title.toLowerCase().trim())) return true;
  }
  return false;
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
  const [sectorsData, setSectorsData] = useState([]);
  const [showNoSocialModal, setShowNoSocialModal] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({});
  const [publishingId, setPublishingId] = useState(null);
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
      fetch('/api/sectors', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => setSectorsData(data.sectors || []))
        .catch(() => {});
    };

    // Carrega imediatamente
    loadAccounts();

    // Recarrega a cada 30 segundos (era 3s — causava lentidão)
    const interval = setInterval(loadAccounts, 30000);

    return () => clearInterval(interval);
  }, []);

  // Inicializa seleção por empresa para novos artigos — usa categoria para auto-atribuir
  useEffect(() => {
    if (pendingArticles.length === 0) return;
    const companies = buildCompanies(connectedAccounts, companiesData);
    if (companies.length === 0) return;

    const CATEGORY_COMPANY_MAP = {
      'defesa-militar': (cs) => cs.find(c => /defense|defesa|militar|military/i.test(c.name)),
      'maritimo':       (cs) => cs.find(c => /marine|marinha|naval|maritime/i.test(c.name)),
      'ferroviario':    (cs) => cs.find(c => /rail|ferroviario/i.test(c.name)),
      'aeroespacial':   (cs) => cs.find(c => /aerospace|aeroespacial|aviation/i.test(c.name))
                             || cs.find(c => /defense|defesa/i.test(c.name)),
    };

    setArticleSelections(prev => {
      const updated = { ...prev };
      for (const article of pendingArticles) {
        const existing = updated[article.id];
        // Se já tem empresa atribuída manualmente, só atualiza plataformas
        let company;
        if (existing?.companyId) {
          company = companies.find(c => c.id === existing.companyId) || companies[0];
        } else {
          // Auto-atribui por categoria
          const guessFn = CATEGORY_COMPANY_MAP[article.category];
          company = (guessFn ? guessFn(companies) : null) || companies[0];
        }
        updated[article.id] = {
          companyId: company?.id || null,
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

  // Devolve a empresa mais adequada para uma categoria de artigo
  function guessCompanyForCategory(category) {
    const companies = buildCompanies(connectedAccounts, companiesData);
    if (!companies.length) return null;
    const name = (c) => (c.name || '').toLowerCase();
    const DEFENSE_KEYS  = ['defense', 'defesa', 'militar', 'military'];
    const MARINE_KEYS   = ['marine', 'marinha', 'naval', 'maritime'];
    const RAIL_KEYS     = ['rail', 'ferroviario', 'comboio'];
    const AERO_KEYS     = ['aerospace', 'aeroespacial', 'aviation'];

    const match = (keys) => companies.find(c => keys.some(k => name(c).includes(k)));

    if (category === 'defesa-militar') return match(DEFENSE_KEYS) || companies[0];
    if (category === 'maritimo')       return match(MARINE_KEYS)  || companies[0];
    if (category === 'ferroviario')    return match(RAIL_KEYS)    || companies[0];
    if (category === 'aeroespacial')   return match(AERO_KEYS)    || match(DEFENSE_KEYS) || companies[0];
    return companies[0];
  }

  // Muda a empresa selecionada: atualiza companyId, platforms e accounts
  function setArticleCompany(articleId, companyId) {
    const companies = buildCompanies(connectedAccounts, companiesData); // fallback local
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
        // Filtra artigos já vistos (histórico local)
        const newArticles = data.articles.filter(a => !isAlreadySeen(a));
        addToSeen(newArticles);
        // Junta os novos aos pendentes existentes, sem duplicados por URL/título
        const existingKeys = new Set(existing.map(a => a.url || a.title));
        const fresh = newArticles.filter(a => !existingKeys.has(a.url || a.title));
        const merged = [...existing, ...fresh];

        savePending(merged);
        setPendingArticles(merged);
        setCounts(prev => ({ ...prev, pending: merged.length }));
        // Auto-atribui empresa com base na categoria de cada artigo
        const autoSelections = {};
        for (const a of fresh) {
          const company = guessCompanyForCategory(a.category);
          if (company) {
            autoSelections[a.id] = {
              companyId: company.id,
              platforms: [...company.platforms],
              accounts: { ...company.accountIds },
            };
          }
        }
        if (Object.keys(autoSelections).length > 0) {
          setArticleSelections(prev => ({ ...autoSelections, ...prev }));
        }
        const msg = fresh.length > 0
          ? `${fresh.length} nova(s) notícia(s) carregadas para revisão`
          : 'Agente concluído: sem notícias novas (duplicados ignorados)';
        showToast(msg, fresh.length > 0 ? 'success' : 'info');
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
    const hasSocial = Object.values(connectedAccounts).some(arr => Array.isArray(arr) && arr.length > 0);
    const hasWordpress = companiesData.some(c => c.wordpress_url && c.wordpress_username && c.wordpress_app_password);
    return hasSocial || hasWordpress;
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
      const companies = buildCompanies(connectedAccounts, companiesData); // fallback local
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
    setPublishingId(item.id);
    if (!hasConnectedAccounts()) { setShowNoSocialModal(true); return; }
    const token = localStorage.getItem('auth_token');
    const sel = articleSelections[item.id] || { platforms: [], accounts: {} };
    if (!sel.platforms || sel.platforms.length === 0) {
      showToast('Seleciona pelo menos uma rede social para publicar.', 'error');
      return;
    }
    // Resolve o UUID real da empresa (sel.companyId é o ID interno do frontend)
    const companies = buildCompanies(connectedAccounts, companiesData); // fallback local
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
    } finally {
      setPublishingId(null);
    }
  }

  // ── Publicar artigo guardado (on_hold → published) ───────────────
  async function handlePublishSaved(item, platforms, accounts, companyId = null) {
    setPublishingId(item.id);
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
    } finally {
      setPublishingId(null);
    }
  }

  // ── Confirmação de remoção ────────────────────────────────────────
  const [confirmRemove, setConfirmRemove] = useState(null); // item a remover

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
      setCounts(prev => ({ ...prev, on_hold: (prev.on_hold || 0) + 1 }));
      showToast('Notícia guardada!', 'success');
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  // Companies calculado uma vez — evita re-calcular em cada card
  const companies = useMemo(() => buildCompanies(connectedAccounts, companiesData), [connectedAccounts, companiesData]);

  // Artigos filtrados por setor (pendentes — filtro local)
  const sectorFilteredPending = filterSector
    ? pendingArticles.filter(a => (a.category || '').toLowerCase() === filterSector)
    : pendingArticles;

  // Mapa id→label para todos os setores (dinâmico)
  const sectorsMap = Object.fromEntries(sectorsData.map(s => [s.id, s.label]));

  // Contagens por setor — usa todos os setores dinâmicos
  const sectorCounts = filterStatus === 'pending'
    ? Object.fromEntries(sectorsData.map(s => [s.id, pendingArticles.filter(a => (a.category || '').toLowerCase() === s.id).length]))
    : Object.fromEntries(sectorsData.map(s => [s.id, news.filter(a => (a.category || '').toLowerCase() === s.id).length]));

  // Total para o badge "Todos"
  const sectorTotalCount = filterStatus === 'pending' ? pendingArticles.length : totalNews;

  // Totais efetivos (pendentes filtrados por setor vs BD)
  const effectiveTotalNews = filterStatus === 'pending' ? sectorFilteredPending.length : totalNews;
  const effectiveTotalPages = Math.max(1, Math.ceil(effectiveTotalNews / PAGE_SIZE));

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
            <button className="header-nav-item" onClick={() => router.push('/sources')}>Fontes</button>
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
            <button className="btn-logout" onClick={() => { clearAuth(); router.replace('/'); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          {pendingArticles.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '.8rem', color: 'var(--red-600)', borderColor: 'var(--red-100)' }}
              onClick={() => {
                savePending([]);
                setPendingArticles([]);
                setCounts(prev => ({ ...prev, pending: 0 }));
                showToast('Cache de notícias limpa', 'info');
              }}
              title="Limpar notícias pendentes do browser"
            >
              🗑 Limpar cache
            </button>
          )}
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
            {sectorsData.map(({ id: key, label }) =>
              sectorCounts[key] > 0 || filterSector === key ? (
                <button
                  key={key}
                  className={`sector-tab${filterSector === key ? ' active' : ''}`}
                  data-sector={key}
                  onClick={() => { setFilterSector(key); setPage(1); setBulkSelected(new Set()); }}
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
                companies={companies}
                isPublishing={publishingId === item.id}
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
                sectorsMap={sectorsMap}
              />
            ))
          ) : (
            displayedNews.map(item => (
              <SavedArticleCard
                key={item.id}
                item={item}
                companies={companies}
                isPublishing={publishingId === item.id}
                onPublish={filterStatus === 'on_hold' ? handlePublishSaved : null}
                onRemove={filterStatus === 'on_hold' ? (item) => setConfirmRemove(item) : null}
              />
            ))
          )}
        </div>

        {effectiveTotalPages > 1 && (
          <div className="pagination">
            <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1} aria-label="Anterior">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            {Array.from({ length: effectiveTotalPages }, (_, i) => i + 1).map(n => (
              <button
                key={n}
                className={`pagination-btn${n === page ? ' active' : ''}`}
                onClick={() => setPage(n)}
                disabled={loading}
              >
                {n}
              </button>
            ))}
            <button className="pagination-btn" onClick={() => setPage(p => Math.min(effectiveTotalPages, p + 1))} disabled={loading || page >= effectiveTotalPages} aria-label="Seguinte">
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

      {confirmRemove && (
        <div className="modal-overlay" onClick={() => setConfirmRemove(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Apagar notícia guardada</h2>
            </div>
            <div className="modal-body">
              Tens a certeza que queres apagar <strong>"{confirmRemove.title?.slice(0, 60)}{confirmRemove.title?.length > 60 ? '…' : ''}"</strong>?
              <br /><span style={{ fontSize: '.85rem', color: 'var(--gray-400)', marginTop: 6, display: 'block' }}>Esta acção não pode ser desfeita.</span>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmRemove(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => { handleRemoveSaved(confirmRemove); setConfirmRemove(null); }}>Apagar</button>
            </div>
          </div>
        </div>
      )}

      {showNoSocialModal && (
        <NoSocialModal
          onClose={() => setShowNoSocialModal(false)}
          onGoToSocial={() => router.push('/social')}
        />
      )}

      {/* Bottom nav — mobile only */}
      <nav className="mobile-bottom-nav">
        <button className="active">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Notícias
        </button>
        <button onClick={() => router.push('/social')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          Redes Sociais
        </button>
        <button onClick={() => router.push('/sources')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
          Fontes
        </button>
        <button onClick={() => { localStorage.removeItem('auth_token'); localStorage.removeItem('token_expiry'); router.replace('/'); }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sair
        </button>
      </nav>
    </div>
  );
}
