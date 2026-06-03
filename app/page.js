'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Migra token antigo do sessionStorage para localStorage (utilizadores com sessão antiga)
    if (!localStorage.getItem('auth_token')) {
      const old = sessionStorage.getItem('auth_token');
      const exp = sessionStorage.getItem('token_expiry');
      if (old) {
        localStorage.setItem('auth_token', old);
        if (exp) localStorage.setItem('token_expiry', exp);
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('token_expiry');
      }
    }
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    fetch('/api/verify', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.ok) router.replace('/dashboard'); })
      .catch(() => {});
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Preenche o utilizador e a password.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erro ao autenticar. Tenta novamente.');
        setPassword('');
        return;
      }
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('token_expiry', String(Date.now() + data.expiresIn * 1000));
      router.replace('/dashboard');
    } catch {
      setError('Não foi possível ligar ao servidor. Verifica a tua ligação.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <rect width="56" height="56" rx="14" fill="#7C3AED"/>
                <circle cx="28" cy="22" r="8" fill="white" opacity="0.9"/>
                <circle cx="28" cy="22" r="4" fill="#7C3AED"/>
                <rect x="14" y="36" width="28" height="4" rx="2" fill="white" opacity="0.7"/>
                <rect x="18" y="43" width="20" height="4" rx="2" fill="white" opacity="0.5"/>
              </svg>
            </div>
            <h1 style={{ fontSize: '1.75rem', background: 'linear-gradient(135deg, #7C3AED, #A855F7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Publixy</h1>
            <p>O agente que pesquisa, avalia e publica por si</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="username">Utilizador</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                maxLength={50}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="input-wrapper">
                <input
                  type={showPwd ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  className="toggle-password"
                  aria-label={showPwd ? 'Esconder password' : 'Mostrar password'}
                  onClick={() => setShowPwd(v => !v)}
                >
                  {showPwd ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? <span className="loader" /> : 'Entrar'}
            </button>
          </form>

          <p className="login-footer">Dashboard de Notícias &copy; 2026</p>
        </div>
      </div>
    </div>
  );
}
