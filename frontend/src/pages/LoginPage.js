import React, { useState } from 'react';
import { auth } from '../api';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('analyst');
  const [password, setPassword] = useState('breathe123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await auth.login(username, password);
      localStorage.setItem('token', r.data.token);
      onLogin(r.data);
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--ink)',
      backgroundImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(182,255,78,0.06) 0%, transparent 70%)',
    }}>
      <div style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--acid)', boxShadow: '0 0 20px var(--acid)' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
              Breathe ESG
            </span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
            EMISSIONS INTELLIGENCE PLATFORM
          </div>
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)', padding: 32,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 24, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Analyst Sign In
          </div>

          <form onSubmit={handleSubmit}>
            {[
              { label: 'Username', value: username, onChange: setUsername, type: 'text' },
              { label: 'Password', value: password, onChange: setPassword, type: 'password' },
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {f.label}
                </label>
                <input
                  type={f.type}
                  value={f.value}
                  onChange={e => f.onChange(e.target.value)}
                  style={{
                    width: '100%', background: 'var(--ink-80)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '10px 14px', color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}

            {error && (
              <div style={{ background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.3)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', fontFamily: 'var(--font-mono)', marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>

          <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--ink-80)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 4 }}>DEMO CREDENTIALS</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--acid)' }}>analyst / breathe123</div>
          </div>
        </div>
      </div>
    </div>
  );
}
