import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown, ChevronUp, CheckCircle, AlertTriangle } from 'lucide-react';
import { records as recordsApi } from '../api';

export default function ReviewPage({ onNavigate, onStatsUpdate }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast] = useState(null);
  const [filters, setFilters] = useState({ scope: '', source: '', status: '', search: '' });

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const fetchRecords = useCallback(() => {
    const params = {};
    if (filters.scope) params.scope = filters.scope;
    if (filters.source) params.source = filters.source;
    if (filters.status) params.status = filters.status;
    if (filters.search) params.search = filters.search;
    recordsApi.list(params)
      .then(r => {
        const recs = r.data.results || r.data;
        setData(recs);
        if (onStatsUpdate) {
          onStatsUpdate(
            recs.filter(x => x.status === 'pending').length,
            recs.filter(x => x.status === 'flagged').length,
          );
        }
      })
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const approve = async (id) => {
    await recordsApi.approve(id);
    setData(d => d.map(r => r.id === id ? { ...r, status: 'approved' } : r));
    showToast('✓ Record approved');
  };

  const flag = async (id) => {
    await recordsApi.flag(id, 'Manually flagged by analyst');
    setData(d => d.map(r => r.id === id ? { ...r, status: 'flagged' } : r));
    showToast('⚑ Record flagged');
  };

  const pending = data.filter(r => r.status === 'pending').length;
  const flagged = data.filter(r => r.status === 'flagged').length;
  const approved = data.filter(r => r.status === 'approved').length;

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">Review Queue</span>
        <div className="topbar-meta">
          <span style={{ color: 'var(--amber)' }}>{pending} pending</span>
          <span style={{ color: 'var(--red)' }}>{flagged} flagged</span>
          <span style={{ color: 'var(--acid)' }}>{approved} approved</span>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Awaiting Review', count: pending, color: 'var(--amber)', filter: 'pending' },
            { label: 'Flagged', count: flagged, color: 'var(--red)', filter: 'flagged' },
            { label: 'Approved', count: approved, color: 'var(--acid)', filter: 'approved' },
          ].map(s => (
            <button key={s.label} onClick={() => setFilters(f => ({ ...f, status: f.status === s.filter ? '' : s.filter }))}
              style={{ background: 'var(--surface)', border: `1px solid ${s.color}33`, borderRadius: 'var(--radius-lg)', padding: '14px 18px', cursor: 'pointer', textAlign: 'left', transition: 'var(--transition)' }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: s.color }}>{s.count}</div>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <div className="search-wrap">
            <Search className="search-icon" size={14} />
            <input className="search-input" placeholder="Search…" value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
          </div>
          {[
            { key: 'source', opts: [['', 'All sources'], ['SAP', 'SAP'], ['Utility', 'Electricity'], ['Travel', 'Travel']] },
            { key: 'status', opts: [['', 'All statuses'], ['pending', 'Pending'], ['flagged', 'Flagged'], ['approved', 'Approved']] },
            { key: 'scope', opts: [['', 'All scopes'], ['1', 'Scope 1'], ['2', 'Scope 2'], ['3', 'Scope 3']] },
          ].map(f => (
            <select key={f.key} className="filter-select" value={filters[f.key]}
              onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}>
              {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            {data.length} records
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>Loading…</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Source</th>
                  <th>Scope</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>kgCO₂e</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map(r => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td style={{ width: 32, cursor: 'pointer' }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        <span style={{ color: 'var(--text-muted)' }}>{expanded === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                      </td>
                      <td><strong style={{ fontSize: 12 }}>{r.source}</strong></td>
                      <td><span className={`badge badge-scope${r.scope}`}>Scope {r.scope}</span></td>
                      <td style={{ color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ghg_category}</td>
                      <td className="mono">{parseFloat(r.quantity_normalized).toLocaleString()}</td>
                      <td className="mono" style={{ color: 'var(--acid-dim)' }}>{r.unit_normalized}</td>
                      <td className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{parseFloat(r.kgco2e).toLocaleString()}</td>
                      <td className="mono">{r.activity_date}</td>
                      <td>
                        <span className={`badge badge-${r.status}`}>
                          {r.flags?.length > 0 && r.status === 'flagged' ? '⚑ ' : ''}{r.status}
                        </span>
                      </td>
                      <td>
                        {r.status !== 'approved' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-approve" onClick={() => approve(r.id)}><CheckCircle size={10} /> Approve</button>
                            {r.status !== 'flagged' && <button className="btn btn-flag" onClick={() => flag(r.id)}><AlertTriangle size={10} /> Flag</button>}
                          </div>
                        )}
                        {r.status === 'approved' && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>locked</span>}
                      </td>
                    </tr>

                    {expanded === r.id && (
                      <tr>
                        <td colSpan={10} style={{ padding: 0 }}>
                          <div className="row-expand animate-in">
                            {r.flags?.map((f, i) => (
                              <div key={i} className="flag-detail" style={{ marginBottom: 10 }}>⚑ [{f.code}] {f.detail}</div>
                            ))}
                            <div className="expand-grid">
                              {Object.entries(r.raw_metadata || {}).slice(0, 12).map(([k, v]) => (
                                <div key={k} className="expand-field">
                                  <label>{k.replace(/_/g, ' ')}</label>
                                  <span>{String(v)}</span>
                                </div>
                              ))}
                              <div className="expand-field"><label>EF Applied</label><span>{r.emission_factor} {r.emission_factor_unit}</span></div>
                              <div className="expand-field"><label>EF Source</label><span>{r.emission_factor_source}</span></div>
                              <div className="expand-field"><label>Ingested</label><span>{new Date(r.created_at).toLocaleString()}</span></div>
                              <div className="expand-field"><label>Record ID</label><span style={{ fontSize: 10 }}>{r.id}</span></div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {data.length === 0 && (
              <div className="empty-state"><Search size={32} /><h3>No records match filters</h3></div>
            )}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
