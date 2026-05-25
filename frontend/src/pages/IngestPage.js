import React, { useState, useRef } from 'react';
import { Upload, CheckCircle, Zap, FileText } from 'lucide-react';
import { ingest } from '../api';

const SOURCES = [
  {
    id: 'SAP', label: 'SAP IDoc / Flat File', description: 'Fuel & procurement POs from SAP MM-PUR-PO',
    color: 'var(--amber)', accept: '.txt,.csv,.tsv',
    sample: `EBELN|EBELP|LIFNR|WERKS|MATNR|MAKTX|MENGE|MEINS|NETPR|WAERS|BEDAT|BUKRS|KOSTL
4500012301|00010|0001003456|DE01|MAT-DIESEL-001|Dieselkraftstoff B7|12500|L|1.48|EUR|20231115|1000|CC-LOGISTICS-01
4500012302|00010|0001007821|UK03|MAT-PETROL-001|Unleaded Petrol 95|8400|L|1.62|GBP|20231118|2000|CC-FLEET-UK`,
    hint: 'Pipe/tab delimited. German headers auto-translated. SAP date YYYYMMDD handled. Units: L, T, M3, KG.',
  },
  {
    id: 'UTILITY', label: 'Utility Portal CSV', description: 'Electricity consumption from portal exports',
    color: 'var(--blue)', accept: '.csv',
    sample: `MPAN,meter_serial,site_name,billing_ref,billing_period_start,billing_period_end,tariff_code,total_kwh,peak_kwh,offpeak_kwh,grid_region,currency,total_cost
1012345678901,E1A02944421,"Hamburg Warehouse",INV-001,2023-11-01,2023-11-30,HH-MAX-DEMAND,142800,89340,53460,DE-TransnetBW,EUR,21420.00`,
    hint: 'Non-calendar billing periods handled. Grid EF auto-selected by region (GB, DE, PL).',
  },
  {
    id: 'TRAVEL', label: 'Concur / Navan Export', description: 'Flights, hotels, ground transport',
    color: 'var(--acid)', accept: '.csv',
    sample: `report_id,employee_id,employee_name,expense_type,carrier,origin_iata,dest_iata,class_of_service,departure_date,pax_count,nights,cost,currency,purpose,line_num
RPT-001,EMP-001,Jane Smith,AIR,BA,LHR,JFK,J,2023-11-14,1,,4210.00,GBP,Board meeting,1
RPT-001,EMP-001,Jane Smith,HOTEL,,,,, 2023-11-14,,4,,3200.00,USD,Board meeting,2`,
    hint: 'IATA codes resolved to distances. Short-haul rail alternatives flagged. RFI 1.891 applied for air.',
  },
];

export default function IngestPage({ onNavigate }) {
  const [activeSource, setActiveSource] = useState('SAP');
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef();

  const source = SOURCES.find(s => s.id === activeSource);

  const handleUpload = async (file) => {
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('source_type', activeSource);
      fd.append('file', file);
      const r = await ingest.upload(fd);
      setResult(r.data);
    } catch (e) {
      setResult({ success: false, error: e.response?.data?.error || 'Upload failed' });
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    if (!pasteText.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await ingest.paste(activeSource, pasteText);
      setResult(r.data);
    } catch (e) {
      setResult({ success: false, error: e.response?.data?.error || 'Failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">Ingest Data</span>
        <div className="topbar-meta"><span>3 source types</span></div>
      </div>

      <div className="page-body" style={{ paddingTop: 24, maxWidth: 820 }}>
        {/* Source selector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
          {SOURCES.map(s => (
            <button key={s.id}
              onClick={() => { setActiveSource(s.id); setResult(null); setShowSample(false); }}
              style={{
                background: activeSource === s.id ? 'var(--surface-2)' : 'var(--surface)',
                border: `1px solid ${activeSource === s.id ? s.color + '55' : 'var(--border)'}`,
                borderRadius: 'var(--radius-lg)', padding: 16, cursor: 'pointer', textAlign: 'left',
                transition: 'var(--transition)', boxShadow: activeSource === s.id ? `0 0 20px ${s.color}15` : 'none',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--text-primary)' }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.description}</div>
            </button>
          ))}
        </div>

        {/* Upload zone */}
        <div
          className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
          style={{ marginBottom: 16 }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept={source.accept} style={{ display: 'none' }}
            onChange={e => handleUpload(e.target.files[0])} />
          <Upload size={40} className="upload-icon" />
          <h3>Drop {source.label} file here</h3>
          <p style={{ marginBottom: 12 }}>or click to browse · {source.accept}</p>
          <div style={{ display: 'inline-block', background: 'var(--ink-60)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', maxWidth: 460, textAlign: 'left' }}>
            💡 {source.hint}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSample(!showSample)} style={{ gap: 6 }}>
            <FileText size={13} /> {showSample ? 'Hide' : 'View'} sample format
          </button>
          {showSample && (
            <div className="code-block animate-in" style={{ marginTop: 10, fontSize: 11 }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{source.sample}</pre>
            </div>
          )}
        </div>

        {/* Paste */}
        <div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Or paste raw data
          </div>
          <textarea
            placeholder={`Paste ${source.label} CSV content here…`}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            style={{ width: '100%', height: 120, background: 'var(--ink-80)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={handlePaste} disabled={loading || !pasteText.trim()}>
              <Zap size={14} /> {loading ? 'Processing…' : 'Process Data'}
            </button>
            {loading && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--amber)' }}>Running pipeline…</span>}
          </div>
        </div>

        {/* Result */}
        {result && (
          <div className={`card animate-in`} style={{ marginTop: 20, borderColor: result.success ? 'rgba(182,255,78,0.2)' : 'rgba(255,90,90,0.2)' }}>
            {result.success ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <CheckCircle size={18} color="var(--acid)" />
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Ingestion Complete
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 16 }}>
                  {[
                    { label: 'Records Saved', val: result.records_saved, color: 'var(--acid)' },
                    { label: 'Records Skipped', val: result.records_skipped, color: 'var(--amber)' },
                    { label: 'Parse Errors', val: (result.parse_errors || []).length, color: 'var(--red)' },
                  ].map(k => (
                    <div key={k.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: k.color }}>{k.val}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{k.label}</div>
                    </div>
                  ))}
                </div>
                {(result.parse_errors || []).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {result.parse_errors.slice(0, 3).map((e, i) => (
                      <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red)', marginBottom: 4 }}>⚠ {e}</div>
                    ))}
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => onNavigate('review')}>Go to Review Queue →</button>
              </>
            ) : (
              <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                ✗ {result.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
