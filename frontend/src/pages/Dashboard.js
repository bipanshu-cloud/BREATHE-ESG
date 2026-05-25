import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from 'recharts';
import { TrendingUp, AlertTriangle, CheckCircle, Clock, ArrowUpRight } from 'lucide-react';
import { dashboard, records as recordsApi } from '../api';

const SCOPE_COLORS = { '1': '#ffb347', '2': '#5ab4ff', '3': '#b6ff4e' };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--ink-80)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 700 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.fill || p.stroke }}>{p.name}: {p.value?.toLocaleString()}</div>
      ))}
    </div>
  );
};

export default function Dashboard({ onNavigate, onStatsUpdate }) {
  const [stats, setStats] = useState(null);
  const [recentRecords, setRecentRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([dashboard.stats(), recordsApi.list({ page_size: 8 })])
      .then(([s, r]) => {
        setStats(s.data);
        setRecentRecords(r.data.results || r.data);
        if (onStatsUpdate && s.data.status_counts) {
          onStatsUpdate(s.data.status_counts.pending || 0, s.data.status_counts.flagged || 0);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
      Loading data…
    </div>
  );

  if (!stats) return null;

  const totalT = (stats.total_kgco2e / 1000).toFixed(1);
  const sc = stats.status_counts || {};
  const scopeData = Object.entries(stats.scope_breakdown || {}).map(([k, v]) => ({
    name: `Scope ${k}`, value: parseFloat((v / 1000).toFixed(1)), scope: k,
  }));
  const sourceData = Object.entries(stats.source_breakdown || {}).map(([k, v]) => ({
    name: k.replace('Concur / Navan Travel', 'Travel').replace('Utility Portal CSV', 'Electricity').replace('SAP IDoc / MM-PUR-PO', 'SAP Fuel'),
    value: parseFloat((v / 1000).toFixed(1)),
  }));
  const SOURCE_COLORS = ['#ffb347', '#5ab4ff', '#b6ff4e', '#ff7eb3'];

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">Emissions Overview</span>
        <div className="topbar-meta">
          <span>Q4 2023</span>
          <span style={{ color: 'var(--acid)', fontWeight: 600 }}>● Live</span>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        {/* Hero + KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'start', marginBottom: 24 }}>
          <div className="card" style={{ minWidth: 210 }}>
            <div className="kpi-label">Total tCO₂e ingested</div>
            <div className="hero-number">{totalT}</div>
            <div className="hero-unit">tCO₂e · Q4 2023</div>
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 8 }}>BY SCOPE</div>
              {scopeData.map(s => (
                <div key={s.scope} className="scope-row">
                  <div className="scope-label">Scope {s.scope}</div>
                  <div className="scope-bar-track">
                    <div className="scope-bar-fill" style={{ width: `${(s.value / parseFloat(totalT)) * 100}%`, background: SCOPE_COLORS[s.scope] }} />
                  </div>
                  <div className="scope-value">{s.value.toFixed(1)}t</div>
                </div>
              ))}
            </div>
          </div>

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {[
              { label: 'Pending Review', val: sc.pending || 0, color: 'var(--amber)', icon: Clock, action: () => onNavigate('review'), cta: 'Review now →' },
              { label: 'Flagged', val: sc.flagged || 0, color: 'var(--red)', icon: AlertTriangle, action: () => onNavigate('review'), cta: 'View flags →' },
              { label: 'Approved', val: sc.approved || 0, color: 'var(--acid)', icon: CheckCircle, action: null, cta: null },
              { label: 'Total Records', val: stats.total_records || 0, color: 'var(--blue)', icon: TrendingUp, action: null, cta: null },
            ].map(k => (
              <div key={k.label} className="kpi-card" style={{ '--accent-color': k.color }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div className="kpi-label">{k.label}</div>
                    <div className="kpi-value" style={{ color: k.color }}>{k.val}</div>
                  </div>
                  <k.icon size={20} color={k.color} style={{ opacity: 0.6, marginTop: 2 }} />
                </div>
                {k.action && <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={k.action}>{k.cta}</button>}
              </div>
            ))}
          </div>
        </div>

        {/* Charts */}
        <div className="charts-grid" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-title">Emissions by Scope (tCO₂e)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={scopeData} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} unit="t" />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="tCO₂e" radius={[3, 3, 0, 0]}>
                  {scopeData.map((s, i) => <Cell key={i} fill={SCOPE_COLORS[s.scope]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-title">Emissions by Source</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" innerRadius={36} outerRadius={58} paddingAngle={3} dataKey="value">
                    {sourceData.map((_, i) => <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {sourceData.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: SOURCE_COLORS[i % SOURCE_COLORS.length], flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.name}</div>
                      <div className="progress-bar-track" style={{ marginTop: 3 }}>
                        <div className="progress-bar-fill" style={{ width: `${parseFloat(totalT) > 0 ? (d.value / parseFloat(totalT)) * 100 : 0}%`, background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', width: 48, textAlign: 'right' }}>{d.value}t</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Recent records */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Recent Records</div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('review')}>
              View all <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="table-container" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Scope</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th>kgCO₂e</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRecords.slice(0, 8).map(r => (
                  <tr key={r.id}>
                    <td><strong style={{ fontSize: 12 }}>{r.source}</strong></td>
                    <td><span className={`badge badge-scope${r.scope}`}>Scope {r.scope}</span></td>
                    <td style={{ color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ghg_category}</td>
                    <td className="mono">{r.activity_date}</td>
                    <td className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{parseFloat(r.kgco2e).toLocaleString()}</td>
                    <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
