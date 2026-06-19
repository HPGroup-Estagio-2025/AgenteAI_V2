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
  const [newCompanyLogo, setNewCompanyLogo] = useState('');
  const [newCompanySectors, setNewCompanySectors] = useState([]);
  const [newCompanyCustomSector, setNewCompanyCustomSector] = useState('');
  const [showNewCompanyCustomInput, setShowNewCompanyCustomInput] = useState(false);
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
      const res = await fetch(`/api/social/accounts?_=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.status === 401) { clearAuth(); router.replace('/'); return; }
      const data = await res.json();
      setAccounts(data.accounts || {});
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
      router.replace('/social', { scroll: false });
      // Delay para garantir que o Supabase processou antes de recarregar
      setTimeout(async () => {
        await loadAccounts();
        await loadCompanies();
      }, 800);
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
        body: JSON.stringify({ name: newCompanyInput.trim(), logo_url: newCompanyLogo.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        // Guarda setores se foram selecionados
        if (newCompanySectors.length > 0 && data.id) {
          try {
            const patchRes = await fetch(`/api/companies/${data.id}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ sectors: newCompanySectors }),
            });
            const patchData = await patchRes.json().catch(() => ({}));
            // Se coluna não existe no Supabase, guarda em localStorage
            if (!patchRes.ok || patchData._skipped?.includes('sectors')) {
              const stored = JSON.parse(localStorage.getItem('company_sectors') || '{}');
              stored[data.id] = newCompanySectors;
              localStorage.setItem('company_sectors', JSON.stringify(stored));
            }
          } catch { }
        }
        showToast('Empresa criada com sucesso!', 'success');
        setNewCompanyInput('');
        setNewCompanyLogo('');
        setNewCompanySectors([]);
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
    let companySectors = [];
    try {
      companySectors = Array.isArray(company.sectors)
        ? company.sectors
        : JSON.parse(company.sectors || '[]');
    } catch { companySectors = []; }
    // Fallback: lê do localStorage se a coluna não existe no Supabase
    if (companySectors.length === 0) {
      try {
        const stored = JSON.parse(localStorage.getItem('company_sectors') || '{}');
        if (stored[company.id]) companySectors = stored[company.id];
      } catch { }
    }
    setCompanySettingsForm({
      logo_url: company.logo_url || '',
      website_url: company.website_url || '',
      linkedin_org_id: company.linkedin_org_id || '',
      wordpress_url: company.wordpress_url || '',
      wordpress_username: company.wordpress_username || '',
      wordpress_app_password: company.wordpress_app_password || '',
      sectors: companySectors,
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
        // Se a coluna sectors não existe no Supabase, guarda em localStorage
        if (data._skipped?.includes('sectors') && companySettingsForm.sectors) {
          const stored = JSON.parse(localStorage.getItem('company_sectors') || '{}');
          stored[companyId] = companySettingsForm.sectors;
          localStorage.setItem('company_sectors', JSON.stringify(stored));
        } else if (companySettingsForm.sectors) {
          // Limpa localStorage se foi guardado com sucesso no Supabase
          const stored = JSON.parse(localStorage.getItem('company_sectors') || '{}');
          delete stored[companyId];
          localStorage.setItem('company_sectors', JSON.stringify(stored));
        }
        showToast('Configurações guardadas!', 'success');
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

  async function handleConnect(platformId, companyId = null, fresh = false) {
    const token = localStorage.getItem('auth_token');
    setConnecting(fresh ? `${platformId}-fresh` : platformId);
    try {
      let connectUrl = companyId
        ? `/api/social/connect/${platformId}?companyId=${encodeURIComponent(companyId)}`
        : `/api/social/connect/${platformId}`;
      if (fresh) connectUrl += `&fresh=true`;
      const res = await fetch(connectUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao iniciar ligação', 'error'); return; }
      window.location.href = data.url;
    } catch (err) {
      console.error('[social] Erro ao conectar:', err);
      showToast('Erro de ligação. Tenta novamente.', 'error');
    } finally {
      setConnecting(prev => (prev === platformId || prev === `${platformId}-fresh`) ? null : prev);
    }
  }

  const [confirmDisconnect, setConfirmDisconnect] = useState(null); // { id, name }
  const [reuseOrNew, setReuseOrNew] = useState(null); // { platformId, companyId, existingName }

  async function handleDisconnect(accountId) {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/social/accounts', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      if (res.ok) {
        showToast('Conta desconectada.', 'info');
        // Pequeno delay para o Supabase processar antes de recarregar
        setTimeout(async () => {
          await loadAccounts();
          await loadCompanies();
        }, 500);
      } else {
        showToast('Erro ao desconectar.', 'error');
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
      grouped[platform] = platformAccounts.filter(acc =>
        acc.companyId === companyId ||
        !acc.companyId // sem companyId = partilhada, aparece em todas as empresas
      );
    }
    return grouped;
  }

  async function handleReuseAccount(sourceAccountId) {
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/social/reuse-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceAccountId }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao reutilizar conta', 'error'); return; }
      showToast('Conta ligada com sucesso!', 'success');
      // Aguarda Supabase propagar e faz dois refreshes para garantir
      await loadAccounts();
      setTimeout(() => loadAccounts(), 800);
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    }
  }

  function PlatformRow({ platform, company }) {
    const { id, name, color, bg, Icon } = platform;
    const companyAccounts = getAccountsByCompany(company.id);
    const platformAccounts = companyAccounts[id] || [];
    const isConnecting = connecting === id;
    const isConnectingFresh = connecting === `${id}-fresh`;
    const hasAccounts = platformAccounts.length > 0;
    const [open, setOpen] = useState(false);

    // Contas do mesmo platform noutras empresas que podem ser reutilizadas
    const reusableAccounts = !hasAccounts
      ? (accounts[id] || []).filter(acc => acc.companyId !== company.id && !platformAccounts.find(a => a.id === acc.id))
      : [];

    // Facebook/Instagram já conectado noutras empresas — permite copiar OU fazer nova conta
    const hasExistingOnOtherCompany = !hasAccounts && reusableAccounts.length > 0 && (id === 'facebook' || id === 'instagram');

    return (
      <>
        <div
          className="social-platform-row"
          style={{ cursor: hasAccounts ? 'pointer' : 'default' }}
          onClick={() => hasAccounts && setOpen(o => !o)}
        >
          <div className="social-platform-icon" style={{ background: bg }}>
            <Icon />
          </div>
          <div className="social-platform-info">
            <div className="social-platform-name">{name}</div>
            <div className={`social-platform-status ${hasAccounts ? 'social-platform-status--on' : 'social-platform-status--off'}`}>
              {hasAccounts ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block', flexShrink: 0 }} />
                  {platformAccounts[0]?.name || platformAccounts[0]?.email || 'Conectado'}
                  {id === 'linkedin' && (
                    <span style={{ fontSize: '.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 8, background: company.linkedin_org_id ? '#EFF6FF' : '#F0FDF4', color: company.linkedin_org_id ? '#1D4ED8' : '#15803D', border: '1px solid', borderColor: company.linkedin_org_id ? '#BFDBFE' : '#BBF7D0' }}>
                      {company.linkedin_org_id ? 'Empresa' : 'Pessoal'}
                    </span>
                  )}
                </span>
              ) : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gray-300)', display: 'inline-block' }} />Desconectado</span>}
            </div>
          </div>
          {!hasAccounts ? (
            <button
              className="btn-connect"
              style={{ background: color }}
              disabled={isConnecting || isConnectingFresh}
              onClick={e => {
                e.stopPropagation();
                if (hasExistingOnOtherCompany) {
                  setReuseOrNew({ platformId: id, companyId: company.id, existingName: reusableAccounts[0]?.name || 'conta existente' });
                } else {
                  handleConnect(id, company.id);
                }
              }}
            >
              {(isConnecting || isConnectingFresh) ? <span className="loader" style={{ width: 11, height: 11 }} /> : 'Conectar'}
            </button>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--gray-400)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          )}
        </div>
        {hasAccounts && open && platformAccounts.map(account => (
          <div key={account.id} className="social-account-panel" onClick={e => e.stopPropagation()} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="social-account-panel-info" style={{ flex: 1 }}>
                <span className="social-account-panel-name">{account.email || account.name}</span>
                <span className="social-account-panel-sub">{formatDate(account.connectedAt)}</span>
              </div>
              <button
                className="btn btn-danger"
                style={{ padding: '4px 10px', fontSize: '.72rem', height: 'auto', flexShrink: 0 }}
                onClick={() => setConfirmDisconnect({ id: account.id, name: account.name || account.email })}
              >
                Desconectar
              </button>
            </div>
            {id === 'facebook' && account.pages?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid var(--gray-100)' }}>
                <span style={{ fontSize: '.75rem', color: 'var(--gray-500)', flexShrink: 0 }}>Página:</span>
                <select
                  value={account.selectedPageId || account.pages[0]?.id || ''}
                  onChange={async e => {
                    const token = localStorage.getItem('auth_token');
                    await fetch('/api/social/accounts', {
                      method: 'PATCH',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ accountId: account.id, selectedPageId: e.target.value }),
                    });
                    await loadAccounts();
                  }}
                  style={{ flex: 1, fontSize: '.8rem', padding: '4px 8px', border: '1.5px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', background: 'var(--white)', color: 'var(--gray-800)' }}
                >
                  {account.pages.map(page => (
                    <option key={page.id} value={page.id}>{page.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
      </>
    );
  }

  function WpRow({ company, hasWordpress, onEdit }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <div
          className="social-platform-row"
          style={{ cursor: hasWordpress ? 'pointer' : 'default' }}
          onClick={() => hasWordpress && setOpen(o => !o)}
        >
          <div className="social-platform-icon" style={{ background: '#EEF2FF' }}>
            <WP_ICON />
          </div>
          <div className="social-platform-info">
            <div className="social-platform-name">WordPress</div>
            <div className={`social-platform-status ${hasWordpress ? 'social-platform-status--on' : 'social-platform-status--off'}`}>
              {hasWordpress
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />Configurado</span>
                : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gray-300)', display: 'inline-block' }} />Não configurado</span>}
            </div>
          </div>
          {!hasWordpress ? (
            <button className="btn-connect" style={{ background: '#3858E9' }} onClick={e => { e.stopPropagation(); onEdit(); }}>
              Configurar
            </button>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--gray-400)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          )}
        </div>
        {hasWordpress && open && (
          <div className="social-account-panel" onClick={e => e.stopPropagation()}>
            <div className="social-account-panel-info">
              <span className="social-account-panel-name">{company.wordpress_url}</span>
              <span className="social-account-panel-sub">Utilizador: {company.wordpress_username}</span>
            </div>
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '.72rem', height: 'auto' }} onClick={onEdit}>
              Editar
            </button>
          </div>
        )}
      </>
    );
  }

  const WP_ICON = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#3858E9">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-5l-2 2.5-1.5-1L12 7l4.5 6-1.5 1-2-2.5v5h-2z"/>
    </svg>
  );

  return (
    <div className="dashboard-page">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <img src="/robot-logo.svg" width="34" height="34" alt="Publixy" style={{borderRadius:8}} />
            <span className="header-brand-name">Publixy</span>
          </div>
          <nav className="header-nav">
            <button className="header-nav-item" onClick={() => router.push('/dashboard')}>Notícias</button>
            <button className="header-nav-item active">Redes Sociais</button>
            <button className="header-nav-item" onClick={() => router.push('/sources')}>Fontes</button>
          </nav>
          <div className="header-actions">
            <button className="btn-logout" title="Sair" onClick={() => { clearAuth(); router.replace('/'); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
              </svg>
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


        {loading ? (
          <div className="empty-state">
            <div className="loader" style={{ width: 32, height: 32, borderColor: 'rgba(0,0,0,.15)', borderTopColor: 'var(--blue-600)' }} />
          </div>
        ) : (
          <div className="social-grid">
            {/* ── Company Cards ── */}
            {companies.map(company => {
              const companyAccounts = getAccountsByCompany(company.id);
              const hasWordpress = Boolean(company.wordpress_url && company.wordpress_username && company.wordpress_app_password);
              const connectedCount = Object.values(companyAccounts).reduce((s, arr) => s + arr.length, 0) + (hasWordpress ? 1 : 0);
              const isSettingsOpen = editingCompanySettings === company.id;
              const isConfirmingDelete = confirmDeleteCompanyId === company.id;

              return (
                <div key={company.id} className="social-company-card">
                  {/* Header */}
                  <div className="social-company-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      {/* Logo / initials */}
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: company.logo_url ? '#fff' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', border: '1.5px solid var(--gray-150,#EAECF0)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                        {company.logo_url
                          ? <img src={company.logo_url} alt="" onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }} />
                          : null}
                        <span style={{ display: company.logo_url ? 'none' : 'flex', fontWeight: 800, fontSize: '.85rem', color: '#7C3AED' }}>
                          {company.name.slice(0,2).toUpperCase()}
                        </span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="social-company-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                          {connectedCount > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', display: 'inline-block', flexShrink: 0 }} />}
                          <span style={{ fontSize: '.7rem', color: connectedCount > 0 ? '#16A34A' : 'var(--gray-400)', fontWeight: 600 }}>
                            {connectedCount > 0 ? `${connectedCount} ${connectedCount === 1 ? 'conta conectada' : 'contas conectadas'}` : 'Nenhuma conta conectada'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="social-company-header-right" style={{ flexShrink: 0 }}>
                      <button
                        className="social-icon-btn"
                        title="Editar empresa"
                        onClick={() => isSettingsOpen ? setEditingCompanySettings(null) : openCompanySettings(company)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        className="social-icon-btn social-icon-btn--danger"
                        title="Apagar empresa"
                        disabled={deletingCompany === company.id}
                        onClick={() => setConfirmDeleteCompanyId(company.id)}
                      >
                        {deletingCompany === company.id
                          ? <span className="loader" style={{ width: 12, height: 12, borderColor: 'rgba(220,38,38,.3)', borderTopColor: '#DC2626' }} />
                          : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                            </svg>
                        }
                      </button>
                    </div>
                  </div>

                  {/* Platform Rows */}
                  <div className="social-platforms-list">
                    {PLATFORMS.map(platform => (
                      <PlatformRow key={platform.id} platform={platform} company={company} />
                    ))}

                    {/* WordPress row */}
                    <WpRow company={company} hasWordpress={hasWordpress} onEdit={() => openCompanySettings(company)} />
                  </div>

                </div>
              );
            })}

            {/* ── Create Company Card ── */}
            <div className="social-create-card">
              <div className="social-create-card-header">
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </div>
                <span className="social-create-card-label">Nova Empresa</span>
              </div>
              <div className="social-create-card-body">
              <input
                type="text"
                placeholder="Nome da empresa"
                value={newCompanyInput}
                onChange={e => setNewCompanyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateCompany()}
              />
              {/* Logo field with preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Logotipo <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {newCompanyLogo && (
                    <img
                      src={newCompanyLogo}
                      alt="preview"
                      onError={e => e.target.style.display = 'none'}
                      style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'contain', background: '#fff', border: '1.5px solid var(--gray-200)', flexShrink: 0, padding: 2 }}
                    />
                  )}
                  <input
                    type="url"
                    placeholder="https://exemplo.com/logo.png"
                    value={newCompanyLogo}
                    onChange={e => setNewCompanyLogo(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
              {/* Setores */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Setores <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { id: 'maritimo', label: '⚓ Marítimo' },
                    { id: 'defesa-militar', label: '🛡️ Defesa' },
                    { id: 'aeroespacial', label: '🚀 Aeroespacial' },
                    { id: 'ferroviario', label: '🚂 Ferroviário' },
                    { id: 'tecnologia', label: '💻 Tecnologia' },
                    { id: 'fitness', label: '🏋️ Fitness' },
                  ].map(sector => {
                    const active = newCompanySectors.includes(sector.id);
                    return (
                      <button
                        key={sector.id}
                        type="button"
                        onClick={() => setNewCompanySectors(prev =>
                          active ? prev.filter(s => s !== sector.id) : [...prev, sector.id]
                        )}
                        style={{ padding: '4px 10px', borderRadius: 20, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: active ? 'var(--blue-400)' : 'var(--gray-200)', background: active ? 'var(--blue-50, #EFF6FF)' : 'transparent', color: active ? 'var(--blue-700, #1D4ED8)' : 'var(--gray-500)', transition: 'all .15s' }}
                      >
                        {sector.label}
                      </button>
                    );
                  })}
                  {/* Setores personalizados já adicionados */}
                  {newCompanySectors.filter(s => !['maritimo','defesa-militar','aeroespacial','ferroviario','tecnologia','fitness'].includes(s)).map(custom => (
                    <button key={custom} type="button"
                      onClick={() => setNewCompanySectors(prev => prev.filter(s => s !== custom))}
                      style={{ padding: '4px 10px', borderRadius: 20, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: 'var(--blue-400)', background: 'var(--blue-50, #EFF6FF)', color: 'var(--blue-700, #1D4ED8)', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {custom} <span style={{ opacity: .6 }}>×</span>
                    </button>
                  ))}
                  {/* Botão Outro */}
                  {showNewCompanyCustomInput ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        autoFocus
                        type="text"
                        placeholder="Nome do setor"
                        value={newCompanyCustomSector}
                        onChange={e => setNewCompanyCustomSector(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newCompanyCustomSector.trim()) {
                            const val = newCompanyCustomSector.trim().toLowerCase();
                            setNewCompanySectors(prev => prev.includes(val) ? prev : [...prev, val]);
                            setNewCompanyCustomSector('');
                            setShowNewCompanyCustomInput(false);
                          }
                          if (e.key === 'Escape') { setShowNewCompanyCustomInput(false); setNewCompanyCustomSector(''); }
                        }}
                        style={{ padding: '4px 8px', borderRadius: 20, fontSize: '.75rem', border: '1.5px solid var(--blue-400)', outline: 'none', width: 120 }}
                      />
                      <button type="button" onClick={() => {
                        const val = newCompanyCustomSector.trim().toLowerCase();
                        if (val) { setNewCompanySectors(prev => prev.includes(val) ? prev : [...prev, val]); }
                        setNewCompanyCustomSector('');
                        setShowNewCompanyCustomInput(false);
                      }} style={{ padding: '4px 8px', borderRadius: 20, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--blue-400)', background: 'var(--blue-50,#EFF6FF)', color: 'var(--blue-700,#1D4ED8)' }}>
                        ✓
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setShowNewCompanyCustomInput(true)}
                      style={{ padding: '4px 10px', borderRadius: 20, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', border: '1.5px dashed var(--gray-300)', background: 'transparent', color: 'var(--gray-400)' }}
                    >
                      + Outro
                    </button>
                  )}
                </div>
              </div>
              <button
                className="btn btn-primary btn-full"
                onClick={handleCreateCompany}
                disabled={!newCompanyInput.trim()}
              >
                Criar Empresa
              </button>

              {companies.length === 0 && (
                <p style={{ fontSize: '.78rem', color: 'var(--gray-400)', marginTop: 4, lineHeight: 1.5 }}>
                  Cria uma empresa para organizar as tuas contas de redes sociais.
                </p>
              )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ── Modal: Editar empresa ── */}
      {editingCompanySettings && (
        <div className="modal-overlay" onClick={() => setEditingCompanySettings(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Editar empresa</h2>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Logo */}
              <div>
                <label style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 6 }}>Logotipo (URL da imagem)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {companySettingsForm.logo_url && (
                    <img src={companySettingsForm.logo_url} alt="" onError={e => e.target.style.display='none'} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'contain', background: '#fff', border: '1.5px solid var(--gray-200)', flexShrink: 0, padding: 2 }} />
                  )}
                  <input type="url" placeholder="https://exemplo.com/logo.png" value={companySettingsForm.logo_url} onChange={e => setCompanySettingsForm(f => ({ ...f, logo_url: e.target.value }))} />
                </div>
              </div>
              {/* Website */}
              <div>
                <label style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 6 }}>URL do Website</label>
                <input type="url" placeholder="https://www.exemplo.com" value={companySettingsForm.website_url} onChange={e => setCompanySettingsForm(f => ({ ...f, website_url: e.target.value }))} />
              </div>
              {/* LinkedIn Org ID */}
              <div>
                <label style={{ fontSize: '.78rem', fontWeight: 700, color: '#0A66C2', display: 'block', marginBottom: 4 }}>
                  LinkedIn Organization ID
                </label>
                <input type="text" placeholder="ex: 123456789" value={companySettingsForm.linkedin_org_id} onChange={e => setCompanySettingsForm(f => ({ ...f, linkedin_org_id: e.target.value.replace(/\D/g, '') }))} />
                <p style={{ fontSize: '.7rem', color: 'var(--gray-400)', marginTop: 4, lineHeight: 1.5 }}>
                  Vai a linkedin.com/company/<strong>ID</strong>/admin — o número no URL é o ID. Necessário para publicar como empresa.
                </p>
              </div>
              {/* Setores */}
              <div style={{ borderTop: '1px dashed var(--gray-200)', paddingTop: 12 }}>
                <div style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--gray-400)', marginBottom: 6 }}>Setores de Notícias</div>
                <p style={{ fontSize: '.7rem', color: 'var(--gray-500)', marginBottom: 10, lineHeight: 1.5 }}>
                  As notícias destes setores são automaticamente atribuídas a esta empresa no dashboard.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { id: 'maritimo', label: '⚓ Marítimo' },
                    { id: 'defesa-militar', label: '🛡️ Defesa / Militar' },
                    { id: 'aeroespacial', label: '🚀 Aeroespacial' },
                    { id: 'ferroviario', label: '🚂 Ferroviário' },
                    { id: 'tecnologia', label: '💻 Tecnologia' },
                    { id: 'fitness', label: '🏋️ Fitness' },
                  ].map(sector => {
                    const active = (companySettingsForm.sectors || []).includes(sector.id);
                    return (
                      <button
                        key={sector.id}
                        type="button"
                        onClick={() => setCompanySettingsForm(f => ({
                          ...f,
                          sectors: active
                            ? (f.sectors || []).filter(s => s !== sector.id)
                            : [...(f.sectors || []), sector.id],
                        }))}
                        style={{ padding: '5px 12px', borderRadius: 20, fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: active ? 'var(--blue-400)' : 'var(--gray-200)', background: active ? 'var(--blue-50, #EFF6FF)' : 'var(--gray-50, #F9FAFB)', color: active ? 'var(--blue-700, #1D4ED8)' : 'var(--gray-500)', transition: 'all .15s' }}
                      >
                        {sector.label}
                      </button>
                    );
                  })}
                  {/* Setores personalizados */}
                  {(companySettingsForm.sectors || []).filter(s => !['maritimo','defesa-militar','aeroespacial','ferroviario','tecnologia','fitness'].includes(s)).map(custom => (
                    <button key={custom} type="button"
                      onClick={() => setCompanySettingsForm(f => ({ ...f, sectors: (f.sectors || []).filter(s => s !== custom) }))}
                      style={{ padding: '5px 12px', borderRadius: 20, fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--blue-400)', background: 'var(--blue-50,#EFF6FF)', color: 'var(--blue-700,#1D4ED8)', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {custom} <span style={{ opacity: .6 }}>×</span>
                    </button>
                  ))}
                  {/* Botão Outro */}
                  {companySettingsForm._showCustomSector ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        autoFocus
                        type="text"
                        placeholder="Nome do setor"
                        value={companySettingsForm._customSectorInput || ''}
                        onChange={e => setCompanySettingsForm(f => ({ ...f, _customSectorInput: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = (companySettingsForm._customSectorInput || '').trim().toLowerCase();
                            if (val) setCompanySettingsForm(f => ({ ...f, sectors: (f.sectors || []).includes(val) ? f.sectors : [...(f.sectors || []), val], _customSectorInput: '', _showCustomSector: false }));
                          }
                          if (e.key === 'Escape') setCompanySettingsForm(f => ({ ...f, _showCustomSector: false, _customSectorInput: '' }));
                        }}
                        style={{ padding: '4px 8px', borderRadius: 20, fontSize: '.78rem', border: '1.5px solid var(--blue-400)', outline: 'none', width: 130 }}
                      />
                      <button type="button" onClick={() => {
                        const val = (companySettingsForm._customSectorInput || '').trim().toLowerCase();
                        if (val) setCompanySettingsForm(f => ({ ...f, sectors: (f.sectors || []).includes(val) ? f.sectors : [...(f.sectors || []), val], _customSectorInput: '', _showCustomSector: false }));
                        else setCompanySettingsForm(f => ({ ...f, _showCustomSector: false }));
                      }} style={{ padding: '4px 10px', borderRadius: 20, fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--blue-400)', background: 'var(--blue-50,#EFF6FF)', color: 'var(--blue-700,#1D4ED8)' }}>✓</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setCompanySettingsForm(f => ({ ...f, _showCustomSector: true, _customSectorInput: '' }))}
                      style={{ padding: '5px 12px', borderRadius: 20, fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', border: '1.5px dashed var(--gray-300)', background: 'transparent', color: 'var(--gray-400)' }}
                    >
                      + Outro
                    </button>
                  )}
                </div>
              </div>

              {/* WordPress */}
              <div style={{ borderTop: '1px dashed var(--gray-200)', paddingTop: 12 }}>
                <div style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--gray-400)', marginBottom: 10 }}>WordPress</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>URL do WordPress</label>
                    <input type="url" placeholder="https://blog.exemplo.com" value={companySettingsForm.wordpress_url} onChange={e => setCompanySettingsForm(f => ({ ...f, wordpress_url: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>Utilizador</label>
                    <input type="text" placeholder="utilizador" value={companySettingsForm.wordpress_username} onChange={e => setCompanySettingsForm(f => ({ ...f, wordpress_username: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>Application Password</label>
                    <input type="password" placeholder="gerada em WordPress → Utilizadores → Perfil" value={companySettingsForm.wordpress_app_password} onChange={e => setCompanySettingsForm(f => ({ ...f, wordpress_app_password: e.target.value }))} />
                  </div>
                  <p style={{ fontSize: '.7rem', color: 'var(--gray-400)', lineHeight: 1.5 }}>
                    Cria em: WordPress → Utilizadores → O teu perfil → Application Passwords
                  </p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setEditingCompanySettings(null)}>Cancelar</button>
              <button className="btn btn-primary" disabled={savingSettings} onClick={() => handleSaveCompanySettings(editingCompanySettings)}>
                {savingSettings ? <><span className="loader" style={{ width: 12, height: 12 }} /> A guardar...</> : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteCompanyId && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteCompanyId(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Excluir empresa</h2>
            </div>
            <div className="modal-body">
              Tem a certeza que quer excluir esta empresa?
              <br />
              <span style={{ fontSize: '.85rem', color: 'var(--gray-400)', marginTop: 6, display: 'block' }}>
                As contas ligadas ficarão sem empresa associada.
              </span>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmDeleteCompanyId(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                disabled={!!deletingCompany}
                onClick={() => handleDeleteCompany(confirmDeleteCompanyId)}
              >
                {deletingCompany ? <span className="loader" style={{ width: 12, height: 12 }} /> : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reuseOrNew && (
        <div className="modal-overlay" onClick={() => setReuseOrNew(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Conectar Facebook</h2>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: '.88rem', color: 'var(--gray-600)', margin: 0 }}>
                Já tens uma conta Facebook ligada. Como queres conectar?
              </p>
              <button
                className="btn btn-primary btn-full"
                style={{ justifyContent: 'center' }}
                onClick={() => { setReuseOrNew(null); handleConnect(reuseOrNew.platformId, reuseOrNew.companyId); }}
              >
                Manter sessão iniciada
                <span style={{ display: 'block', fontSize: '.72rem', fontWeight: 400, opacity: .8, marginTop: 2 }}>
                  ({reuseOrNew.existingName})
                </span>
              </button>
              <button
                className="btn btn-ghost btn-full"
                style={{ justifyContent: 'center' }}
                onClick={() => { setReuseOrNew(null); handleConnect(reuseOrNew.platformId, reuseOrNew.companyId, true); }}
              >
                Iniciar sessão com outra conta
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setReuseOrNew(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {confirmDisconnect && (
        <div className="modal-overlay" onClick={() => setConfirmDisconnect(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Desconectar conta</h2>
            </div>
            <div className="modal-body">
              Tens a certeza que queres desconectar <strong>"{confirmDisconnect.name}"</strong>?
              <br /><span style={{ fontSize: '.85rem', color: 'var(--gray-400)', marginTop: 6, display: 'block' }}>Precisarás de voltar a ligar a conta para publicar.</span>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmDisconnect(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => { handleDisconnect(confirmDisconnect.id); setConfirmDisconnect(null); }}>Desconectar</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert">
          {toast.message}
        </div>
      )}

      {/* Bottom nav — mobile only */}
      <nav className="mobile-bottom-nav">
        <button onClick={() => router.push('/dashboard')}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Notícias
        </button>
        <button className="active">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
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

export default function SocialPage() {
  return (
    <Suspense>
      <SocialPageContent />
    </Suspense>
  );
}
