import React, { useState, useEffect } from 'react';
import { Shield, Download } from 'lucide-react';
import { audit as auditApi, records as recordsApi } from '../api';

export default function AuditPage() {
  const [events, setEvents] = useState([]);
  const [approvedRecords, setApprovedRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      auditApi.list(),
      recordsApi.list({ status: 'approved', page_size: 100 }),
    ]).then(([a, r]) => {
      setEvents(a.data.results || a.data);
      setApprovedRecords(r.data.results || r.data);
    }).finally(() => setLoading(false));
  }, []);

  const totalApproved = approvedRecords.reduce((s, r) => s + parseFloat(r.kgco2e), 0);

  const ACTION_COLORS = {
    INGEST: 'var(--blue)', APPROVE: 'var(--acid)', REJECT: 'var(--red)',
    FLAG: 'var(--red)', UNFLAG: 'var(--amber)', EDIT: 'var(--amber)', EXPORT: 'var(--text-muted)',
  };

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">Audit Trail</span>
        <div className="topbar-meta">
          <span>{events.length} events</span>
          <button className="btn btn-ghost btn-sm" style={{ gap: 6 }}>
            <Download size={12} /> Export
          </button>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24, maxWidth: 900 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {/* Readiness card */}
            <div className="card" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(182,255,78,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Shield size={22} color="var(--acid)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Audit-Ready Records
                </div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {approvedRecords.length} records approved and locked · {(totalApproved / 1000).toFixed(2)} tCO₂e locked for submission
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--acid)' }}>
                  {approvedRecords.length}
                </div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>locked</div>
              </div>
            </div>

            {/* Event log */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-title">Event Log</div>
              {events.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: '16px 0' }}>
                  No events yet. Ingest data to populate the audit log.
                </div>
              )}
              {events.map(e => (
                <div key={e.id} className="audit-entry">
                  <div className="audit-ts">
                    {new Date(e.ts).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                  <div className="audit-action-badge" style={{
                    background: `${ACTION_COLORS[e.action]}18`,
                    color: ACTION_COLORS[e.action] || 'var(--text-muted)',
                    border: `1px solid ${ACTION_COLORS[e.action]}33`,
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase',
                    letterSpacing: '0.05em', flexShrink: 0, marginTop: 1,
                  }}>
                    {e.action}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="audit-detail">
                      {e.payload?.detail ||
                        (e.action === 'INGEST' && `${e.payload?.source_type} batch: ${e.payload?.records_saved} records saved`) ||
                        (e.action === 'APPROVE' && `Approved record ${e.record_id?.slice(0, 8)}…`) ||
                        (e.action === 'FLAG' && `Flagged: ${e.payload?.reason}`) ||
                        JSON.stringify(e.payload).slice(0, 80)}
                    </div>
                    <div className="audit-user">by {e.actor}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Approved records lineage */}
            {approvedRecords.length > 0 && (
              <div className="card">
                <div className="card-title">Approved Records — Lineage</div>
                <div className="table-container" style={{ border: 'none' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Category</th>
                        <th>Scope</th>
                        <th>kgCO₂e</th>
                        <th>EF Source</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedRecords.map(r => (
                        <tr key={r.id}>
                          <td><strong style={{ fontSize: 12 }}>{r.source}</strong></td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.ghg_category}</td>
                          <td><span className={`badge badge-scope${r.scope}`}>Scope {r.scope}</span></td>
                          <td className="mono" style={{ color: 'var(--text-primary)' }}>{parseFloat(r.kgco2e).toLocaleString()}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{r.emission_factor_source}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{r.activity_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
