'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const SECTOR_MAP = {
  'maritimo':       { label: 'Marítimo',      cls: 'badge-sector-maritimo' },
  'defesa-militar': { label: 'Defesa Militar', cls: 'badge-sector-defesa' },
  'aeroespacial':   { label: 'Aeroespacial',   cls: 'badge-sector-aeroespacial' },
  'ferroviario':    { label: 'Ferroviário',    cls: 'badge-sector-ferroviario' },
};

const STATUS_LABELS = { pending: 'Pendente', published: 'Publicada', rejected: 'Rejeitada' };
const SOCIAL_PLATFORMS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin', label: 'LinkedIn' },
];

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

function NewsCard({ item, onPublish, onReject }) {
  const isPending = item.status === 'pending';

  return (
    <article className={`news-card${item.imageUrl ? ' has-image' : ''}`}>
      {item.imageUrl && (
        <div className="news-card-image">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
        Ver notícia
      </a>
        </div>
      )}

      <div className="news-card-content">
        <div className="news-card-meta">
          <span className={`badge badge-${item.status}`}>
            {STATUS_LABELS[item.status] || item.status}
          </span>

          <SectorBadge category={item.category} />

          {item.source && (
            <span className="news-meta-text">
              Fonte: {item.source}
            </span>
          )}
        </div>

        <h2 className="news-card-title">{item.title}</h2>

        <p className="news-card-body">
          {item.content}
        </p>

        <div className="news-card-footer">
          {item.publishedAt && (
            <span>
              Publicado: {formatDate(item.publishedAt)}
            </span>
          )}

          <span>
            Recebido: {formatDate(item.receivedAt)}
          </span>
        </div>

        {!isPending && item.processedAt && (
          <div className="news-processed-info">
            {item.status === 'published'
              ? 'Publicada'
              : 'Rejeitada'}{' '}
            em {formatDate(item.processedAt)}

            {item.rejectReason &&
              ` · Motivo: ${item.rejectReason}`}
          </div>
        )}
      </div>

      <div className="news-card-actions">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
        >
          Ver notícia
        </a>

        {isPending ? (
          <>
            <button
              className="btn btn-success"
              onClick={() => onPublish(item)}
            >
              Publicar
            </button>

            <button
              className="btn btn-danger"
              onClick={() => onReject(item)}
            >
              Rejeitar
            </button>
          </>
        ) : (
          <span className={`badge badge-${item.status}`}>
            {item.status === 'published'
              ? 'Publicada'
              : 'Rejeitada'}
          </span>
        )}
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [news, setNews] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, published: 0, rejected: 0 });
  const [filterStatus, setFilterStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [totalNews, setTotalNews] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState('a ligar...');
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState(['facebook']);
  const [agentRunning, setAgentRunning] = useState(false);
  const [lastAgentRun, setLastAgentRun] = useState(null);

  const loadingRef = useRef(false);
  const toastTimer = useRef(null);
  const fetchRef = useRef(null);
  const isMountedRef = useRef(true);

  function showToast(message, type = 'info') {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  const fetchNews = useCallback(async ({ force = false, notify = false } = {}) => {
    if (loadingRef.current && !force) return;
    loadingRef.current = true;
    setLoading(true);
    const token = sessionStorage.getItem('auth_token');
    if (!token) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    const params = new URLSearchParams({ limit: 5, page: page.toString(), _: Date.now().toString() });
    if (filterStatus) params.set('status', filterStatus);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`/api/news?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        sessionStorage.clear(); router.replace('/'); return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNews(data.news || []);
      setCounts(data.counts || { pending: 0, published: 0, rejected: 0 });
      setTotalNews(data.total || 0);
      setTotalPages(data.totalPages || 1);
      if (data.totalPages && page > data.totalPages) setPage(data.totalPages);
      if (notify) showToast('Notícias atualizadas', 'success');
    } catch {
      if (notify) showToast('Erro ao atualizar notícias', 'error');
      if (!notify) setLiveStatus('sem ligação');
    } finally {
      clearTimeout(timeoutId);
      loadingRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  }, [filterStatus, page, router]);

  useEffect(() => { fetchRef.current = fetchNews; }, [fetchNews]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearTimeout(toastTimer.current);
    };
  }, []);

  // Auth check
  useEffect(() => {
    const token = sessionStorage.getItem('auth_token');
    const expiry = parseInt(sessionStorage.getItem('token_expiry') || '0', 10);
    if (!token || Date.now() > expiry) { sessionStorage.clear(); router.replace('/'); return; }
    fetch('/api/verify', { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        if (!res.ok) { sessionStorage.clear(); router.replace('/'); return; }
        const data = await res.json();
        setUsername(data.username || 'admin');
      })
      .catch(() => { sessionStorage.clear(); router.replace('/'); });
  }, [router]);

  useEffect(() => { fetchNews(); }, [fetchNews]);


  async function runAgentManually() {
    if (agentRunning) return;
    setAgentRunning(true);
    const token = sessionStorage.getItem('auth_token');
    if (!token) {
      setAgentRunning(false);
      sessionStorage.clear();
      router.replace('/');
      return;
    }

    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401 || res.status === 403) {
        sessionStorage.clear();
        router.replace('/');
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Erro ao executar agente', 'error');
        if (data.run_id) setLastAgentRun({ id: data.run_id, status: 'failed' });
        return;
      }

      setLastAgentRun(data);
      showToast(`Agente concluído: ${data.inserted_count || 0} notícia(s) nova(s). ID: ${data.run_id}`, 'success');
      fetchNews({ force: true });
    } catch {
      showToast('Erro de ligação ao executar agente', 'error');
    } finally {
      setAgentRunning(false);
    }
  }

  // Escape key closes modal
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { setModal(null); setRejectReason(''); } }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Supabase Realtime — atualiza automaticamente quando há novos registos na tabela news
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Fallback de polling caso o Realtime não esteja ativo
    const pollTimer = setInterval(() => fetchRef.current?.(), 60000);

    if (!supabaseUrl || supabaseUrl.includes('xxxx')) {
      setLiveStatus('Supabase não configurado');
      return () => clearInterval(pollTimer);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const channel = supabase
      .channel('news-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, () => {
        fetchRef.current?.();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLiveStatus('ao vivo');
        if (status === 'CHANNEL_ERROR') setLiveStatus('polling 60s');
        if (status === 'CLOSED') setLiveStatus('desligado');
      });

    return () => {
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  async function performAction(type, item, options = {}) {
    const token = sessionStorage.getItem('auth_token');
    const endpoint = `/api/news/${encodeURIComponent(item.id)}/${type}`;
    const body = type === 'publish' ? { socialPlatforms: options.socialPlatforms || [] } : {};
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) { sessionStorage.clear(); router.replace('/'); return; }
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao processar a ação', 'error'); return; }
      showToast(`Notícia ${type === 'publish' ? 'publicada' : 'rejeitada'} com sucesso!`, 'success');
      fetchRef.current?.();
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  function handleModalConfirm() {
    if (!modal) return;
    const { type, item } = modal;
    if (type === 'publish' && selectedPlatforms.length === 0) {
      showToast('Seleciona pelo menos uma rede social.', 'error');
      return;
    }
    setModal(null);
    performAction(type, item, { socialPlatforms: selectedPlatforms });
    setRejectReason('');
  }

  function closeModal() { setModal(null); setRejectReason(''); }

  function togglePlatform(platformId) {
    setSelectedPlatforms(prev =>
      prev.includes(platformId)
        ? prev.filter(id => id !== platformId)
        : [...prev, platformId]
    );
  }

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
            <button className="btn btn-ghost btn-danger" onClick={() => { sessionStorage.clear(); router.replace('/'); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
              </svg>
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="stats-bar">
          <div className="stat-card stat-pending" style={{cursor:'pointer'}} onClick={() => { setFilterStatus('pending'); setPage(1); }}>
            <div className="stat-value">{counts.pending}</div>
            <div className="stat-label">Pendentes</div>
          </div>
          <div className="stat-card stat-published" style={{cursor:'pointer'}} onClick={() => { setFilterStatus('published'); setPage(1); }}>
            <div className="stat-value">{counts.published}</div>
            <div className="stat-label">Publicadas</div>
          </div>
          <div className="stat-card stat-rejected" style={{cursor:'pointer'}} onClick={() => { setFilterStatus('rejected'); setPage(1); }}>
            <div className="stat-value">{counts.rejected}</div>
            <div className="stat-label">Rejeitadas</div>
          </div>
        </div>

        <div className="toolbar">
          <div className="filter-tabs" role="tablist">
            {[
              { status: 'pending',   label: 'Pendentes' },
              { status: 'published', label: 'Publicadas' },
              { status: 'rejected',  label: 'Rejeitadas' },
              { status: '',          label: 'Todas' },
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
          <button type="button" className="btn btn-primary" onClick={runAgentManually} disabled={agentRunning} title="Executar agente de notícias">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3l14 9-14 9V3z"/>
            </svg>
            {agentRunning ? 'A executar...' : 'Executar agente'}
          </button>
          <button className="btn btn-ghost" onClick={() => fetchNews({ force: true, notify: true })} disabled={loading || agentRunning} title="Atualizar lista">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
            </svg>
            Atualizar lista
          </button>
        </div>

        {lastAgentRun?.run_id && (
          <div className="agent-run-info">
            Última execução manual: <strong>{lastAgentRun.run_id}</strong>
            {' · '}{lastAgentRun.status}
            {typeof lastAgentRun.inserted_count === 'number' && ` · ${lastAgentRun.inserted_count} notícia(s) nova(s)`}
          </div>
        )}

        <div className="news-list">
          {loading && news.length === 0 ? (
            <div className="empty-state">
              <div className="loader" style={{ width: 32, height: 32, borderColor: 'rgba(0,0,0,.12)', borderTopColor: 'var(--blue-600)' }}/>
            </div>
          ) : news.length === 0 ? (
            <div className="empty-state">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>
              </svg>
              <p>Sem notícias para mostrar</p>
              <span>As notícias da Supabase aparecerão aqui automaticamente</span>
            </div>
          ) : (
            news.map(item => (
              <NewsCard
                key={item.id}
                item={item}
                onPublish={i => { setSelectedPlatforms(['facebook']); setModal({ type: 'publish', item: i }); }}
                onReject={i => setModal({ type: 'reject', item: i })}
              />
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination" aria-label="Paginação de notícias">
            <button
              className="btn btn-ghost"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={loading || page <= 1}
            >
              Anterior
            </button>
            <span>
              Página {page} de {totalPages}
              {totalNews > 0 && ` · ${Math.min((page - 1) * 5 + 1, totalNews)}-${Math.min(page * 5, totalNews)} de ${totalNews}`}
            </span>
            <button
              className="btn btn-ghost"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={loading || page >= totalPages}
            >
              Seguinte
            </button>
          </div>
        )}
      </main>

      {modal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="modal">
            <div className="modal-header">
              <h2>{modal.type === 'publish' ? 'Publicar notícia' : 'Rejeitar notícia'}</h2>
            </div>
            <div className="modal-body">
              <p>
                {modal.type === 'publish'
                  ? `Publicar "${modal.item.title}"?`
                  : 'Tem a certeza que quer rejeitar a noticia?'}
              </p>
              {modal.type === 'publish' && (
                <div className="publish-options" role="group" aria-label="Redes sociais">
                  {SOCIAL_PLATFORMS.map(platform => (
                    <label key={platform.id} className="publish-option">
                      <input
                        type="checkbox"
                        checked={selectedPlatforms.includes(platform.id)}
                        onChange={() => togglePlatform(platform.id)}
                      />
                      <span>{platform.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeModal}>Cancelar</button>
              <button
                className={`btn ${modal.type === 'publish' ? 'btn-success' : 'btn-danger'}`}
                onClick={handleModalConfirm}
              >
                {modal.type === 'publish' ? 'Publicar' : 'Rejeitar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert" aria-live="polite">
          {toast.message}
        </div>
      )}
    </div>
  );
}
