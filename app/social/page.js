'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const PLATFORMS = [
  {
    id: 'facebook',
    name: 'Facebook',
    color: '#1877F2',
    bg: '#E7F3FF',
    Icon: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.887v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
      </svg>
    ),
  },
  {
    id: 'instagram',
    name: 'Instagram',
    color: '#E1306C',
    bg: '#FCE4EC',
    Icon: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="url(#ig-grad)">
        <defs>
          <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f09433"/>
            <stop offset="25%" stopColor="#e6683c"/>
            <stop offset="50%" stopColor="#dc2743"/>
            <stop offset="75%" stopColor="#cc2366"/>
            <stop offset="100%" stopColor="#bc1888"/>
          </linearGradient>
        </defs>
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
      </svg>
    ),
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    color: '#0A66C2',
    bg: '#E8F4FE',
    Icon: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#0A66C2">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
];

const ERROR_MESSAGES = {
  unsupported_platform: 'Plataforma não suportada.',
  missing_params: 'Parâmetros em falta na resposta OAuth.',
  invalid_state: 'Sessão OAuth expirou. Tenta novamente.',
  token_exchange_failed: 'Falha ao obter o token de acesso. Verifica o App Secret nas variáveis de ambiente.',
  profile_failed: 'Conta ligada mas não foi possível obter o perfil. Tenta de novo.',
  connection_failed: 'Erro ao conectar ou guardar a conta. Verifica as variáveis no Vercel e a tabela social_accounts no Supabase.',
  not_configured: 'Credenciais OAuth não configuradas nas variáveis de ambiente.',
  access_denied: 'Acesso negado. O utilizador cancelou a autorização.',
};

function clearAuth() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('token_expiry');
}

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

function SocialPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState({});
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(null);
  const [deletingCompany, setDeletingCompany] = useState(null);
  const [toast, setToast] = useState(null);
  const [appOrigin, setAppOrigin] = useState('');
  const [newCompanyInput, setNewCompanyInput] = useState('');
  const [confirmDeleteCompanyId, setConfirmDeleteCompanyId] = useState(null);
  const [showCompanySelector, setShowCompanySelector] = useState(null);
  const [editingCompanySettings, setEditingCompanySettings] = useState(null);
  const [companySettingsForm, setCompanySettingsForm] = useState({});
  const [savingSettings, setSavingSettings] = useState(false);

  function showToast(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  const loadCompanies = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    try {
      const res = await fetch('/api/companies', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies || []);
      }
    } catch (err) {
      console.error('[social] Erro ao carregar empresas:', err);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) { router.replace('/'); return; }
    try {
      const res = await fetch('/api/social/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      const accounts = data.accounts || {};
      setAccounts(accounts);
    } catch (err) {
      console.error('[social] Erro ao carregar contas:', err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setAppOrigin(window.location.origin);

  }, []);

  useEffect(() => {
    migrateAuthToken();
    const token  = localStorage.getItem('auth_token');
    const expiry = parseInt(localStorage.getItem('token_expiry') || '0', 10);
    if (!token || Date.now() > expiry) { clearAuth(); router.replace('/'); return; }
    loadAccounts();
    loadCompanies();
  }, [loadAccounts, loadCompanies, router]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      const platform = PLATFORMS.find(p => p.id === connected);
      showToast(`${platform?.name || connected} conectado com sucesso!`, 'success');
      loadAccounts();
      loadCompanies();
      router.replace('/social', { scroll: false });
    } else if (error) {
      const detail = searchParams.get('detail');
      const base = ERROR_MESSAGES[error] || `Erro: ${error}`;
      showToast(detail ? `${base} (${detail})` : base, 'error');
      router.replace('/social', { scroll: false });
    }
  }, [searchParams, router, loadAccounts, loadCompanies]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadAccounts();
        loadCompanies();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      if (!document.hidden) {
        loadAccounts();
        loadCompanies();
      }
    }, 15000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [loadAccounts, loadCompanies]);

  async function handleCreateCompany() {
    if (!newCompanyInput.trim()) {
      showToast('Nome da empresa é obrigatório', 'error');
      return;
    }

    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCompanyInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Empresa criada com sucesso!', 'success');
        setNewCompanyInput('');
        await loadCompanies();
      } else {
        showToast(data.error || 'Erro ao criar empresa', 'error');
      }
    } catch (err) {
      console.error('[social] Erro ao criar empresa:', err);
      showToast('Erro ao criar empresa', 'error');
    }
  }

  async function handleDeleteCompany(companyId) {
    const token = localStorage.getItem('auth_token');
    setDeletingCompany(companyId);
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Empresa apagada com sucesso', 'success');
        await loadCompanies();
        await loadAccounts();
      } else {
        showToast(data.error || 'Erro ao apagar empresa', 'error');
      }
    } catch (err) {
      console.error('[social] Erro ao apagar empresa:', err);
      showToast('Erro ao apagar empresa', 'error');
    } finally {
      setDeletingCompany(null);
      setConfirmDeleteCompanyId(null);
    }
  }

  function openCompanySettings(company) {
    setEditingCompanySettings(company.id);
    setCompanySettingsForm({
      website_url: company.website_url || '',
      wordpress_url: company.wordpress_url || '',
      wordpress_username: company.wordpress_username || '',
      wordpress_app_password: company.wordpress_app_password || '',
    });
  }

  async function handleSaveCompanySettings(companyId) {
    const token = localStorage.getItem('auth_token');
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(companySettingsForm),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Configurações guardadas com sucesso!', 'success');
        setEditingCompanySettings(null);
        await loadCompanies();
      } else {
        showToast(data.error || 'Erro ao guardar configurações', 'error');
      }
    } catch {
      showToast('Erro ao guardar configurações', 'error');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleConnect(platformId, companyName = null) {
    const token = localStorage.getItem('auth_token');
    setConnecting(platformId);
    try {
      if (companyName) {
        const cookieRes = await fetch('/api/social/set-pending-company', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyName }),
        });
        if (!cookieRes.ok) {
          const cookieData = await cookieRes.json();
          showToast(cookieData.error || 'Erro ao guardar nome da empresa', 'error');
          setShowCompanySelector(null);
          return;
        }
      }
      const res = await fetch(`/api/social/connect/${platformId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao iniciar ligação', 'error'); return; }
      window.location.href = data.url;
    } catch (err) {
      console.error('[social] Erro ao conectar:', err);
      showToast('Erro de ligação. Tenta novamente.', 'error');
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect(accountId) {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/social/accounts', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      if (res.ok) {
        await loadAccounts();
        showToast('Conta desconectada.', 'info');
      }
    } catch {
      showToast('Erro ao desconectar. Tenta novamente.', 'error');
    }
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return iso; }
  }

  // Group accounts by company
  function getAccountsByCompany(companyId) {
    const grouped = {};
    const company = companies.find(c => c.id === companyId);
    const shouldUseUnassignedAccounts = companies.length === 1;

    for (const [platform, platformAccounts] of Object.entries(accounts)) {
      grouped[platform] = platformAccounts.filter(acc => {
        const hasCompanyBinding = Boolean(acc.companyId || acc.companyName);
        return (
          acc.companyId === companyId ||
          (acc.companyName && company?.name === acc.companyName) ||
          (shouldUseUnassignedAccounts && !hasCompanyBinding)
        );
      });
    }
    return grouped;
  }

  function SocialPlatformCard({ platform, company }) {
    const { id, name, color, bg, Icon } = platform;
    const companyAccounts = getAccountsByCompany(company.id);
    const platformAccounts = companyAccounts[id] || [];
    const isConnecting = connecting === id;
    const hasAccounts = platformAccounts.length > 0;

    return (
      <div className="social-platform-card">
        <div className="social-platform-top">
          <div style={{ background: bg, padding: 8, borderRadius: 8, display: 'flex' }}>
            <Icon />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#1F2937', fontSize: '.9rem' }}>{name}</div>
            <div style={{ fontSize: '.75rem', color: hasAccounts ? '#10B981' : '#6B7280', marginTop: 2 }}>
              {hasAccounts ? '✓ Conectado' : '○ Desconectado'}
            </div>
          </div>
        </div>

        {hasAccounts && (
          <div className="social-platform-account-list">
            {platformAccounts.map(account => (
              <div key={account.id} className="social-account-item">
                <div style={{ fontWeight: 500, fontSize: '.8rem', color: '#1F2937' }}>
                  {account.email || account.name}
                </div>
                {id === 'facebook' && account.pages?.length > 0 && (
                  <div style={{ fontSize: '.75rem', color: '#9CA3AF', marginTop: 3 }}>
                    Página: {account.pages[0].name}
                  </div>
                )}
                <div style={{ fontSize: '.7rem', color: '#9CA3AF', marginTop: 3 }}>
                  {formatDate(account.connectedAt)}
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDisconnect(account.id)}
                  style={{ marginTop: 6, padding: '4px 8px', fontSize: '.75rem', height: 'auto' }}
                >
                  Desconectar
                </button>
              </div>
            ))}
          </div>
        )}

        {!hasAccounts && (
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              marginTop: 10,
              background: color,
              borderColor: color,
              fontSize: '.8rem',
              padding: '8px 12px',
              height: 'auto'
            }}
            disabled={isConnecting}
            onClick={() => handleConnect(id, company.name)}
          >
            {isConnecting ? (
              <>
                <span className="loader" style={{ width: 11, height: 11 }} />
                Ligando...
              </>
            ) : (
              'Conectar'
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <img src="/robot-logo.svg" width="36" height="36" alt="Publixy" style={{borderRadius:8}} />
            <span>Publixy</span>
          </div>
          <nav className="header-nav">
            <button className="header-nav-item" onClick={() => router.push('/dashboard')}>
              Notícias
            </button>
            <button className="header-nav-item active">
              Redes Sociais
            </button>
          </nav>
          <div className="header-actions">
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
        <div className="social-header">
          <h1 className="social-title">Redes Sociais</h1>
          <p className="social-subtitle">
            Cria empresas e conecta as tuas contas para publicar notícias diretamente nas redes sociais.
          </p>
        </div>

        <div className="social-note">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
          </svg>
          <span>
            Configura as credenciais OAuth no ficheiro <code>.env.local</code> antes de conectar.
            Consulta também <code>CREDENCIAIS_REDES_SOCIAIS.md</code> para ver as variáveis necessárias.
          </span>
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="loader" style={{ width: 32, height: 32, borderColor: 'rgba(0,0,0,.15)', borderTopColor: 'var(--blue-600)' }} />
          </div>
        ) : (
          <>
            {/* SECTION: Gerenciar Empresas */}
            <div style={{ marginBottom: 40 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1F2937', marginBottom: 16 }}>
                Empresas
              </h2>

              <div className="social-grid">
                {/* Create Company Card */}
                <div className="social-company-card" style={{ background: '#F9FAFB', border: '1.5px dashed #E5E7EB' }}>
                  <h3 style={{ fontSize: '.9rem', fontWeight: 600, color: '#6B7280', marginBottom: 12 }}>
                    NOVA EMPRESA
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Nome da empresa"
                      value={newCompanyInput}
                      onChange={e => setNewCompanyInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateCompany();
                      }}
                      style={{
                        padding: '8px 12px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '6px',
                        fontSize: '.875rem',
                        outline: 'none',
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={handleCreateCompany}
                      disabled={!newCompanyInput.trim()}
                    >
                      Criar Empresa
                    </button>
                  </div>
                </div>

                {/* Company Cards */}
                {companies.map(company => {
                  const companyAccounts = getAccountsByCompany(company.id);
                  const hasWordpress = Boolean(company.wordpress_url && company.wordpress_username && company.wordpress_app_password);
                  const visibleAccountCount = Object.values(companyAccounts).reduce((sum, platformAccounts) => sum + platformAccounts.length, 0) + (hasWordpress ? 1 : 0);

                  return (
                  <div key={company.id} className="social-company-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                      <div>
                        <h3 className="social-company-name">{company.name}</h3>
                        <p style={{ fontSize: '.75rem', color: '#9CA3AF', marginTop: 4 }}>
                          {visibleAccountCount || company.accountCount || 0} contas
                        </p>
                      </div>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '4px 8px', fontSize: '.75rem', height: 'auto' }}
                        disabled={deletingCompany === company.id}
                        onClick={() => {
                          if (confirmDeleteCompanyId === company.id) {
                            handleDeleteCompany(company.id);
                          } else {
                            setConfirmDeleteCompanyId(company.id);
                          }
                        }}
                      >
                        {deletingCompany === company.id ? (
                          <>
                            <span className="loader" style={{ width: 10, height: 10 }} />
                            Apagando...
                          </>
                        ) : confirmDeleteCompanyId === company.id ? (
                          'Confirmar'
                        ) : (
                          'Apagar'
                        )}
                      </button>
                    </div>
                    {confirmDeleteCompanyId === company.id && (
                      <p style={{ fontSize: '.75rem', color: '#DC2626', marginBottom: 8 }}>
                        As contas ligadas ficarão sem empresa.
                      </p>
                    )}
                    {confirmDeleteCompanyId === company.id && (
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 8px', fontSize: '.75rem', height: 'auto', width: '100%', marginBottom: 12 }}
                        onClick={() => setConfirmDeleteCompanyId(null)}
                      >
                        Cancelar
                      </button>
                    )}
                    <div className="social-platforms-grid">
                      {PLATFORMS.map(platform => (
                        <SocialPlatformCard key={platform.id} platform={platform} company={company} />
                      ))}
                      {/* WordPress card */}
                      <div className="social-platform-card">
                        <div className="social-platform-top">
                          <div style={{ background: '#EEF2FF', padding: 8, borderRadius: 8, display: 'flex' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="#3858E9">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-5l-2 2.5-1.5-1L12 7l4.5 6-1.5 1-2-2.5v5h-2z"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: '#1F2937', fontSize: '.9rem' }}>WordPress</div>
                            <div style={{ fontSize: '.75rem', color: hasWordpress ? '#10B981' : '#6B7280', marginTop: 2 }}>
                              {hasWordpress ? '✓ Configurado' : '○ Não configurado'}
                            </div>
                          </div>
                        </div>
                        {hasWordpress && (
                          <div style={{ fontSize: '.75rem', color: '#6B7280', marginTop: 8 }}>
                            {company.wordpress_url}
                          </div>
                        )}
                        {!hasWordpress && (
                          <p style={{ fontSize: '.75rem', color: '#9CA3AF', marginTop: 8 }}>
                            Configura em ⚙️ Configurações abaixo
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Settings panel */}
                    <div style={{ marginTop: 16, borderTop: '1px solid #E5E7EB', paddingTop: 12 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: '.8rem', padding: '6px 10px', height: 'auto', width: '100%', justifyContent: 'space-between' }}
                        onClick={() => editingCompanySettings === company.id ? setEditingCompanySettings(null) : openCompanySettings(company)}
                      >
                        <span>⚙️ Configurações (Website & WordPress)</span>
                        <span>{editingCompanySettings === company.id ? '▲' : '▼'}</span>
                      </button>

                      {editingCompanySettings === company.id && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                          <div>
                            <label style={{ fontSize: '.75rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                              URL do Website (usado nas publicações)
                            </label>
                            <input
                              type="url"
                              placeholder="https://www.exemplo.com"
                              value={companySettingsForm.website_url}
                              onChange={e => setCompanySettingsForm(f => ({ ...f, website_url: e.target.value }))}
                              style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #E5E7EB', borderRadius: 6, fontSize: '.8rem' }}
                            />
                          </div>
                          <div style={{ borderTop: '1px dashed #E5E7EB', paddingTop: 10 }}>
                            <div style={{ fontSize: '.75rem', fontWeight: 700, color: '#6B7280', marginBottom: 8 }}>WORDPRESS</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <input
                                type="url"
                                placeholder="URL do WordPress (ex: https://blog.exemplo.com)"
                                value={companySettingsForm.wordpress_url}
                                onChange={e => setCompanySettingsForm(f => ({ ...f, wordpress_url: e.target.value }))}
                                style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #E5E7EB', borderRadius: 6, fontSize: '.8rem' }}
                              />
                              <input
                                type="text"
                                placeholder="Utilizador WordPress"
                                value={companySettingsForm.wordpress_username}
                                onChange={e => setCompanySettingsForm(f => ({ ...f, wordpress_username: e.target.value }))}
                                style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #E5E7EB', borderRadius: 6, fontSize: '.8rem' }}
                              />
                              <input
                                type="password"
                                placeholder="Application Password (gerada em WordPress → Utilizadores)"
                                value={companySettingsForm.wordpress_app_password}
                                onChange={e => setCompanySettingsForm(f => ({ ...f, wordpress_app_password: e.target.value }))}
                                style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #E5E7EB', borderRadius: 6, fontSize: '.8rem' }}
                              />
                              <p style={{ fontSize: '.7rem', color: '#9CA3AF', margin: 0 }}>
                                Cria a Application Password em: WordPress → Utilizadores → O teu perfil → Application Passwords
                              </p>
                            </div>
                          </div>
                          <button
                            className="btn btn-primary"
                            style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                            disabled={savingSettings}
                            onClick={() => handleSaveCompanySettings(company.id)}
                          >
                            {savingSettings ? <><span className="loader" style={{ width: 11, height: 11 }} /> A guardar...</> : 'Guardar Configurações'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              {companies.length === 0 && (
                <div className="empty-state">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <p>Nenhuma empresa criada. Começa por criar uma na secção acima.</p>
                </div>
              )}
            </div>

            {/* SECTION: Redes Sociais por Empresa */}
            {false && companies.length > 0 && (
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1F2937', marginBottom: 16 }}>
                  Conectar Redes Sociais
                </h2>

                <div className="social-grid">
                  {companies.map(company => {
                    const companyAccounts = getAccountsByCompany(company.id);
                    const hasAnyAccount = Object.values(companyAccounts).some(arr => arr.length > 0);

                    return (
                      <div key={company.id} className="social-company-card">
                        <h3 className="social-company-name" style={{ marginBottom: 12 }}>{company.name}</h3>

                        <div className="social-platforms-grid">
                          {PLATFORMS.map(({ id, name, color, bg, Icon }) => {
                            const platformAccounts = companyAccounts[id] || [];
                            const isConnecting = connecting === id;
                            const hasAccounts = platformAccounts.length > 0;

                            return (
                              <div key={id} className="social-platform-card">
                                <div className="social-platform-top">
                                  <div style={{ background: bg, padding: 8, borderRadius: 8, display: 'flex' }}>
                                    <Icon />
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, color: '#1F2937', fontSize: '.9rem' }}>{name}</div>
                                    <div style={{ fontSize: '.75rem', color: hasAccounts ? '#10B981' : '#6B7280', marginTop: 2 }}>
                                      {hasAccounts ? '✓ Conectado' : '○ Desconectado'}
                                    </div>
                                  </div>
                                </div>

                                {hasAccounts && (
                                  <div className="social-platform-account-list">
                                    {platformAccounts.map(account => (
                                      <div key={account.id} className="social-account-item">
                                        <div style={{ fontWeight: 500, fontSize: '.8rem', color: '#1F2937' }}>
                                          {account.email || account.name}
                                        </div>
                                        {id === 'facebook' && account.pages?.length > 0 && (
                                          <div style={{ fontSize: '.75rem', color: '#9CA3AF', marginTop: 3 }}>
                                            Página: {account.pages[0].name}
                                          </div>
                                        )}
                                        <div style={{ fontSize: '.7rem', color: '#9CA3AF', marginTop: 3 }}>
                                          {formatDate(account.connectedAt)}
                                        </div>
                                        <button
                                          className="btn btn-danger"
                                          onClick={() => handleDisconnect(account.id)}
                                          style={{ marginTop: 6, padding: '4px 8px', fontSize: '.75rem', height: 'auto' }}
                                        >
                                          Desconectar
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {!hasAccounts && (
                                  <button
                                    className="btn btn-primary"
                                    style={{
                                      width: '100%',
                                      marginTop: 10,
                                      background: color,
                                      borderColor: color,
                                      fontSize: '.8rem',
                                      padding: '8px 12px',
                                      height: 'auto'
                                    }}
                                    disabled={isConnecting}
                                    onClick={() => handleConnect(id, company.name)}
                                  >
                                    {isConnecting ? (
                                      <>
                                        <span className="loader" style={{ width: 11, height: 11 }} />
                                        Ligando...
                                      </>
                                    ) : (
                                      'Conectar'
                                    )}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <div className="social-setup-guide">
          <h2 className="setup-guide-title">Como configurar</h2>
          <div className="setup-steps">
            <div className="setup-step">
              <div className="setup-step-num">1</div>
              <div>
                <strong>Facebook & Instagram</strong>
                <p>Cria uma App em <a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a>. Adiciona o produto <em>Facebook Login</em>. Copia o <strong>App ID</strong> e <strong>App Secret</strong> para <code>FACEBOOK_APP_ID</code> e <code>FACEBOOK_APP_SECRET</code> no <code>.env.local</code>. O Instagram Business usa estas mesmas credenciais via Meta/Facebook.</p>
              </div>
            </div>
            <div className="setup-step">
              <div className="setup-step-num">2</div>
              <div>
                <strong>LinkedIn</strong>
                <p>Cria uma App em <a href="https://www.linkedin.com/developers" target="_blank" rel="noopener">linkedin.com/developers</a>. Adiciona o produto <em>Sign In with LinkedIn</em>. Copia o <strong>Client ID</strong> e <strong>Client Secret</strong> para <code>LINKEDIN_CLIENT_ID</code> e <code>LINKEDIN_CLIENT_SECRET</code>.</p>
              </div>
            </div>
            <div className="setup-step">
              <div className="setup-step-num">3</div>
              <div>
                <strong>URL de Callback</strong>
                <p>Nas definições OAuth de cada plataforma, adiciona como <em>Redirect URI</em>:</p>
                <div className="setup-code">
                  <code>{appOrigin}/api/social/callback/facebook</code><br/>
                  <code>{appOrigin}/api/social/callback/instagram</code><br/>
                  <code>{appOrigin}/api/social/callback/linkedin</code>
                </div>
                <p style={{marginTop:6}}>Define também <code>NEXT_PUBLIC_APP_URL={appOrigin}</code> no <code>.env.local</code>.</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert">
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function SocialPage() {
  return (
    <Suspense>
      <SocialPageContent />
    </Suspense>
  );
}
