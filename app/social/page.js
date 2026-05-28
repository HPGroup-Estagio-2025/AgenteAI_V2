'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const PLATFORMS = [
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Publica notícias em Páginas do Facebook',
    color: '#1877F2',
    bg: '#E7F3FF',
    Icon: () => (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="#1877F2">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.887v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
      </svg>
    ),
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Publica em contas Instagram Business (via Facebook App)',
    color: '#E1306C',
    bg: '#FCE4EC',
    Icon: () => (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="url(#ig-grad)">
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
    description: 'Partilha notícias e artigos no LinkedIn',
    color: '#0A66C2',
    bg: '#E8F4FE',
    Icon: () => (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="#0A66C2">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
];

const ERROR_MESSAGES = {
  unsupported_platform: 'Plataforma não suportada.',
  missing_params: 'Parâmetros em falta na resposta OAuth.',
  invalid_state: 'Estado OAuth inválido. Tenta novamente.',
  token_exchange_failed: 'Falha ao obter o token de acesso.',
  connection_failed: 'Erro ao conectar. Verifica as credenciais no .env.local.',
  not_configured: 'Credenciais não configuradas no .env.local.',
  access_denied: 'Acesso negado pelo utilizador.',
};

function SocialPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(null);
  const [toast, setToast] = useState(null);
  const [appOrigin, setAppOrigin] = useState('');

  function showToast(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  const loadAccounts = useCallback(async () => {
    const token = sessionStorage.getItem('auth_token');
    if (!token) { router.replace('/'); return; }
    try {
      const res = await fetch('/api/social/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { sessionStorage.clear(); router.replace('/'); return; }
      const data = await res.json();
      setAccounts(data.accounts || {});
    } catch {
      showToast('Erro ao carregar contas', 'error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    setAppOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem('auth_token');
    const expiry = parseInt(sessionStorage.getItem('token_expiry') || '0', 10);
    if (!token || Date.now() > expiry) { sessionStorage.clear(); router.replace('/'); return; }
    loadAccounts();
  }, [loadAccounts, router]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      const platform = PLATFORMS.find(p => p.id === connected);
      showToast(`${platform?.name || connected} conectado com sucesso!`, 'success');
    } else if (error) {
      showToast(ERROR_MESSAGES[error] || `Erro: ${error}`, 'error');
    }
  }, [searchParams]);

  async function handleConnect(platformId) {
    const token = sessionStorage.getItem('auth_token');
    setConnecting(platformId);
    try {
      const res = await fetch(`/api/social/connect/${platformId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Erro ao iniciar ligação', 'error'); return; }
      window.location.href = data.url;
    } catch {
      showToast('Erro de ligação. Tenta novamente.', 'error');
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect(platformId) {
    const token = sessionStorage.getItem('auth_token');
    try {
      const res = await fetch('/api/social/accounts', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId }),
      });
      if (res.ok) {
        setAccounts(prev => { const n = { ...prev }; delete n[platformId]; return n; });
        const platform = PLATFORMS.find(p => p.id === platformId);
        showToast(`${platform?.name} desconectado.`, 'info');
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
            <button className="header-nav-item" onClick={() => router.push('/dashboard')}>
              Notícias
            </button>
            <button className="header-nav-item active">
              Redes Sociais
            </button>
          </nav>
          <div className="header-actions">
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
        <div className="social-header">
          <h1 className="social-title">Redes Sociais</h1>
          <p className="social-subtitle">
            Conecta as tuas contas para publicar notícias diretamente nas redes sociais.
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
          <div className="social-grid">
            {PLATFORMS.map(({ id, name, description, color, bg, Icon }) => {
              const account = accounts[id];
              const isConnecting = connecting === id;
              return (
                <div key={id} className={`social-card${account ? ' social-card--connected' : ''}`}>
                  <div className="social-card-top">
                    <div className="social-card-icon" style={{ background: bg }}>
                      <Icon />
                    </div>
                    <div className="social-card-info">
                      <h2 className="social-card-name">{name}</h2>
                      <p className="social-card-desc">{description}</p>
                    </div>
                    <div className={`social-status ${account ? 'social-status--on' : 'social-status--off'}`}>
                      {account ? 'Conectado' : 'Desconectado'}
                    </div>
                  </div>

                  {account && (
                    <div className="social-account-info">
                      {account.picture && (
                        <img src={account.picture} alt="" className="social-account-avatar" />
                      )}
                      <div>
                        <div className="social-account-name">{account.name}</div>
                        {account.email && <div className="social-account-email">{account.email}</div>}
                        {id === 'facebook' && account.pages?.length > 0 && (
                          <div className="social-account-email">Página: {account.pages[0].name}</div>
                        )}
                        {id === 'facebook' && account.pages?.length === 0 && (
                          <div className="social-account-email">Nenhuma Página disponível para publicar</div>
                        )}
                        <div className="social-account-date">Conectado em {formatDate(account.connectedAt)}</div>
                      </div>
                    </div>
                  )}

                  <div className="social-card-actions">
                    {account ? (
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDisconnect(id)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>
                        </svg>
                        Desconectar
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        style={{ background: color, borderColor: color }}
                        disabled={isConnecting}
                        onClick={() => handleConnect(id)}
                      >
                        {isConnecting ? (
                          <span className="loader" style={{ width: 14, height: 14 }} />
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                          </svg>
                        )}
                        {isConnecting ? 'A conectar...' : 'Conectar'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
