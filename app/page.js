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
  const [step, setStep] = useState(1); // 1 = credentials, 2 = OTP
  const [otp, setOtp] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

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

  function saveSession(token, expiresIn) {
    // Remember me: 30 dias; normal: duração do token (4h)
    const duration = rememberMe ? 30 * 24 * 60 * 60 * 1000 : expiresIn * 1000;
    localStorage.setItem('auth_token', token);
    localStorage.setItem('token_expiry', String(Date.now() + duration));
    if (rememberMe) localStorage.setItem('remember_me', '1');
    else localStorage.removeItem('remember_me');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (step === 1) {
      if (!username.trim() || !password) {
        setError('Preenche o utilizador e a password.');
        return;
      }
      setLoading(true);
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password, rememberMe }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Erro ao autenticar. Tenta novamente.');
          setPassword('');
          return;
        }
        if (data.requires2fa) {
          // Envia OTP por email
          const otpRes = await fetch('/api/2fa/send-otp', { method: 'POST' });
          const otpData = await otpRes.json();
          if (!otpRes.ok) {
            setError(otpData.error || 'Erro ao enviar código. Tenta novamente.');
            return;
          }
          setOtpToken(otpData.otpToken);
          setStep(2);
          return;
        }
        saveSession(data.token, data.expiresIn);
        router.replace('/dashboard');
      } catch {
        setError('Não foi possível ligar ao servidor. Verifica a tua ligação.');
      } finally {
        setLoading(false);
      }
    } else {
      if (!otp.trim()) { setError('Insere o código enviado por email.'); return; }
      setLoading(true);
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password, otp: otp.trim(), otpToken, rememberMe }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Código inválido. Tenta novamente.');
          setOtp('');
          return;
        }
        saveSession(data.token, data.expiresIn);
        router.replace('/dashboard');
      } catch {
        setError('Não foi possível ligar ao servidor.');
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="login-page">
      {/* Robô 3D no background */}
      <div className="login-robot-bg">
        <div>
          <div className="login-robot-spin">
            <div className="login-robot-float">
              <img src="/robot-logo.svg" alt="" aria-hidden="true" />
            </div>
          </div>
          <div className="login-robot-shadow" />
        </div>
      </div>

      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <img src="/robot-logo.svg" width="80" height="80" alt="Publixy" style={{borderRadius:16}} />
            </div>
            <h1 style={{ fontSize: '1.75rem', background: 'linear-gradient(135deg, #7C3AED, #A855F7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Publixy</h1>
            <p>O agente que pesquisa, avalia e publica por si</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {step === 1 ? (
              <>
                <div className="form-group">
                  <label htmlFor="username">Utilizador</label>
                  <input type="text" id="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" autoComplete="username" maxLength={50} required />
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
                    <button type="button" className="toggle-password" onClick={() => setShowPwd(v => !v)}>
                      {showPwd ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="twofa-step">
                <div className="twofa-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                  </svg>
                </div>
                <p className="twofa-label">Insere o código da tua app de autenticação</p>
                <p className="twofa-sublabel">Código enviado para <strong>{process.env.NEXT_PUBLIC_OTP_EMAIL_HINT || 'o teu email'}</strong></p>
                <input
                  type="text"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  style={{ textAlign: 'center', fontSize: '1.75rem', letterSpacing: '.4em', fontWeight: 700 }}
                />
                <button type="button" className="twofa-back" onClick={() => { setStep(1); setError(''); setOtp(''); setOtpToken(''); }}>
                  ← Voltar
                </button>
              </div>
            )}

            {step === 1 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 4, fontSize: '.875rem', color: 'var(--gray-600)' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: 'var(--blue-600)', cursor: 'pointer' }}
                />
                Manter sessão por 30 dias
              </label>
            )}

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" className="btn btn-primary btn-full mt-2" disabled={loading}>
              {loading ? <span className="loader" /> : step === 1 ? 'Entrar' : 'Verificar'}
            </button>
          </form>

          <p className="login-footer">Partyard &copy; 2026</p>
        </div>
      </div>
    </div>
  );
}
