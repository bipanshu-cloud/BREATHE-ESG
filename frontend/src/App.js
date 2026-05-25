import React, { useState, useEffect } from 'react';
import { auth } from './api';
import LoginPage from './pages/LoginPage';
import MainApp from './pages/MainApp';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      auth.me()
        .then(r => setUser(r.data))
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#0a0d0f' }}>
      <div style={{ fontFamily:'var(--font-mono)', color:'var(--acid)', fontSize:13 }}>initialising…</div>
    </div>
  );

  if (!user) return <LoginPage onLogin={setUser} />;
  return <MainApp user={user} onLogout={() => { localStorage.removeItem('token'); setUser(null); }} />;
}
