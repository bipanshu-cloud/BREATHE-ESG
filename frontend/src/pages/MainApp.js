import React, { useState } from 'react';
import { LayoutDashboard, Upload, ClipboardCheck, Shield, BookOpen, LogOut } from 'lucide-react';
import Dashboard from './Dashboard';
import IngestPage from './IngestPage';
import ReviewPage from './ReviewPage';
import AuditPage from './AuditPage';
import DocsPage from './DocsPage';
import { auth } from '../api';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview' },
  { id: 'ingest', label: 'Ingest Data', icon: Upload, section: 'Pipeline' },
  { id: 'review', label: 'Review Queue', icon: ClipboardCheck, section: 'Pipeline' },
  { id: 'audit', label: 'Audit Trail', icon: Shield, section: 'Governance' },
  { id: 'docs', label: 'Methodology', icon: BookOpen, section: 'Governance' },
];

export default function MainApp({ user, onLogout }) {
  const [page, setPage] = useState('dashboard');
  const [pendingCount, setPendingCount] = useState(0);
  const [flaggedCount, setFlaggedCount] = useState(0);

  const handleLogout = async () => {
    try { await auth.logout(); } catch {}
    onLogout();
  };

  const PAGES = { dashboard: Dashboard, ingest: IngestPage, review: ReviewPage, audit: AuditPage, docs: DocsPage };
  const Page = PAGES[page] || Dashboard;

  // Group nav by section
  const sections = [...new Set(NAV.map(n => n.section))];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="wordmark">
            <div className="logo-dot" />
            Breathe ESG
          </div>
          <div className="sidebar-tagline">emissions intelligence platform</div>
        </div>

        <div className="sidebar-tenant">
          <div className="label">Signed in as</div>
          <div className="name">{user.username}</div>
        </div>

        <nav className="sidebar-nav">
          {sections.map(section => (
            <div key={section}>
              <div className="nav-section-label">{section}</div>
              {NAV.filter(n => n.section === section).map(item => (
                <button
                  key={item.id}
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  onClick={() => setPage(item.id)}
                >
                  <item.icon className="nav-icon" size={16} />
                  {item.label}
                  {item.id === 'review' && (pendingCount + flaggedCount) > 0 && (
                    <span className={`nav-badge ${flaggedCount > 0 ? 'red' : ''}`}>
                      {pendingCount + flaggedCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-pill">
            <div className="status-dot" />
            <span>Pipeline active</span>
          </div>
          <button
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-body)', padding: 0 }}
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Page
          onNavigate={setPage}
          onStatsUpdate={(p, f) => { setPendingCount(p); setFlaggedCount(f); }}
        />
      </main>
    </div>
  );
}
