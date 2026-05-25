import React, { useState } from 'react';

const DOCS = {
  model: {
    label: 'MODEL.md',
    content: () => (
      <div className="doc-section">
        <h2>Data Model</h2>
        <p>The data model is built around three concerns: multi-tenant isolation, GHG Protocol scope classification, and complete source-of-truth provenance. Approved records are immutable — edits create new version rows.</p>

        <h3>Core tables</h3>
        <div className="code-block"><pre style={{ margin: 0 }}>{`Tenant
  id            UUID  PK
  name          TEXT
  sector        TEXT
  created_at    TIMESTAMPTZ

IngestionBatch
  id            UUID  PK
  tenant_id     FK → Tenant
  source_type   ENUM (SAP | UTILITY | TRAVEL)
  ingested_at   TIMESTAMPTZ
  ingested_by   FK → User
  raw_filename  TEXT
  record_count  INT
  status        ENUM (processing | staged | failed)
  error_log     TEXT

EmissionRecord
  id                    UUID  PK
  tenant_id             FK → Tenant
  batch_id              FK → IngestionBatch
  source                TEXT       -- "SAP IDoc / MM-PUR-PO", "Utility Portal CSV", "Concur / Navan Travel"
  source_record_id      TEXT       -- natural key from upstream (EBELN+EBELP, MPAN+billing_ref, report_id+line)
  scope                 SMALLINT   -- 1 | 2 | 3
  ghg_category          TEXT       -- GHG Protocol label
  activity_date         DATE
  quantity_raw          NUMERIC    -- as received
  unit_raw              TEXT
  quantity_normalized   NUMERIC    -- after unit conversion
  unit_normalized       TEXT       -- canonical (litres, kWh, km, nights)
  emission_factor       NUMERIC
  emission_factor_unit  TEXT
  emission_factor_source TEXT
  kgco2e                NUMERIC    -- quantity_normalized × EF
  raw_metadata          JSONB      -- full original row fields preserved
  flags                 JSONB      -- [{code, detail, type: auto|manual}]
  status                ENUM (pending | flagged | approved | rejected)
  approved_by           FK → User  nullable
  approved_at           TIMESTAMPTZ nullable
  version               INT        -- incremented on edit
  superseded_by         FK → self  nullable
  created_at            TIMESTAMPTZ
  updated_at            TIMESTAMPTZ

AuditEvent
  id          UUID  PK
  tenant_id   FK → Tenant
  record_id   FK → EmissionRecord nullable
  batch_id    FK → IngestionBatch nullable
  actor       TEXT
  action      ENUM (INGEST | APPROVE | REJECT | FLAG | UNFLAG | EDIT | EXPORT)
  payload     JSONB
  ts          TIMESTAMPTZ

-- Reference tables
PlantLookup        (plant_code, company_code, country_code, site_name)
EmissionFactorRef  (fuel_type, region, year, ef_value, unit, source)
IATADistance       (origin, destination, distance_km)`}</pre></div>

        <h3>Multi-tenancy</h3>
        <p>Every table row carries tenant_id. The application layer enforces tenant isolation in every queryset — a user can only see their own tenant's records. In a production PostgreSQL deployment this would be backed by row-level security (RLS) policies so isolation holds even if application code has a bug.</p>

        <h3>Scope classification</h3>
        <p>Scope is not derived from free-text — it is assigned by source type and material category at ingestion time. SAP fuel combustion = Scope 1, utility electricity = Scope 2, all travel = Scope 3. This prevents reclassification drift from upstream column renames.</p>

        <h3>Audit immutability</h3>
        <p>Approved records are never updated in place. An edit creates a new EmissionRecord with version = n+1 and the previous row's superseded_by pointing to the new one. AuditEvent logs every action with full before/after payload.</p>

        <h3>Unit normalization</h3>
        <p>Canonical units: Scope 1 liquid fuel → litres, gas → kWh. Scope 2 → kWh. Scope 3 air/ground → km, hotel → nights. Conversion factors are version-controlled in EmissionFactorRef — a 2022 record uses 2022 factors.</p>
      </div>
    ),
  },

  decisions: {
    label: 'DECISIONS.md',
    content: () => (
      <div className="doc-section">
        <h2>Decision Log</h2>

        <h3>SAP: IDoc flat file, not OData or BAPI</h3>
        <p>Chose IDoc flat file (MM-PUR-PO / transaction ME2N export). OData requires SAP Gateway to be configured — most on-premise SAP instances don't have it enabled. BAPI requires RFC connectivity and custom ABAP wrappers. Flat file exports are universally available and are the actual format clients send us. Tradeoff: batch-only, no real-time pull.</p>
        <p><strong>Scope handled:</strong> MM-PUR-PO purchase orders for fuel/energy. Excluded: FI-CO cost postings, PM work orders, SAP Sustainability module — separate ingestion paths.</p>
        <p><strong>Column mapping:</strong> German header dictionary (EBELN→order, MENGE→quantity, MEINS→unit, BEDAT→date). SAP date YYYYMMDD → ISO 8601. Unit codes L, T, M3, KG, KWH handled with documented conversion assumptions.</p>
        <p><strong>Would ask the PM:</strong> Do clients have a plant-to-country table at onboarding? Without it, WERKS codes are opaque. Also: is this Scope 1 (own combustion) or Scope 3.1 (purchased goods)? Depends on asset ownership.</p>

        <h3>Utility: portal CSV, not PDF or API</h3>
        <p>PDF parsing is fragile — layouts change, two-column bills break tabular extraction, scanned PDFs need OCR. Utility APIs (ENSEK, n3rgy, Stark) require OAuth per meter point which adds per-client setup friction. Portal CSV (Stark / Utiligroup format) is most consistent across UK, German, and Polish utilities tested.</p>
        <p><strong>Billing period handling:</strong> Periods don't align with calendar months (e.g. Oct 18 – Nov 17). We store exact start/end and prorate only at reporting time, not at ingestion — this preserves data integrity.</p>
        <p><strong>Grid EF selection:</strong> Country extracted from grid_region field. UK → DESNZ 2023 (0.2078), Germany → UBA 2023 (0.3664), Poland → IEA 2023 (0.716). Poland flagged automatically due to year-on-year coal-grid variance.</p>

        <h3>Travel: Concur CSV, IATA distance lookup, RFI applied</h3>
        <p>Concur API v4 expense report CSV is the dominant enterprise format. GDS bookings (Sabre/Amadeus) surface IATA codes but rarely distances. We maintain an IATA great-circle lookup table and fall back to Haversine from airport coordinates for unknown pairs.</p>
        <p><strong>Radiative forcing:</strong> DEFRA 2023 applies RFI 1.891× to air kgCO2e for non-CO2 warming (contrails, NOx). Stored separately from base CO2. This is required for Scope 3 Category 6 best practice.</p>
        <p><strong>Short-haul flag:</strong> Flights under 550km where rail is plausible are auto-flagged. Configurable threshold, not a hard block.</p>
        <p><strong>Would ask the PM:</strong> Hotel property-level data via HCMI, or DEFRA country average? How do we handle off-platform bookings (personal card reimbursements without IATA codes)?</p>

        <h3>Other resolutions</h3>
        <ul>
          <li>Multi-currency: costs stored in originating currency. FX conversion only for cost reporting, never applied to emission quantities.</li>
          <li>Duplicate detection: upsert by source_record_id. Re-ingesting the same file creates new versions for approved records, overwrites pending/flagged.</li>
          <li>Heating oil T→L: density 0.840 kg/L. Auto-flagged with note to verify against supplier spec.</li>
          <li>Natural gas M3→kWh: calorific value 10.55 kWh/m3 (H-Gas standard). Auto-flagged to verify with supplier invoice.</li>
        </ul>
      </div>
    ),
  },

  tradeoffs: {
    label: 'TRADEOFFS.md',
    content: () => (
      <div className="doc-section">
        <h2>Deliberate Non-Builds</h2>

        <h3>1. Celery async ingestion workers</h3>
        <p>The ingestion pipeline runs synchronously in the Django request/response cycle. For large files (10k+ row SAP exports, multi-year utility HH data) this will time out. The correct architecture is: upload file → store to S3 → return task_id immediately → Celery worker processes async → WebSocket or polling updates the UI with progress.</p>
        <p><strong>Why not built:</strong> Adds Redis, Celery, S3 (or equivalent) to the deployment stack, which triples infrastructure complexity for a 4-day prototype. The pipeline code is already factored into run_ingestion() — wrapping it in a Celery task is a one-hour change. The synchronous path works fine for files under ~500 rows.</p>

        <h3>2. Market-based Scope 2 accounting</h3>
        <p>We compute location-based Scope 2 only (grid average EFs). The GHG Protocol dual-reporting requirement also mandates market-based figures using Energy Attribute Certificates (UK REGOs, EU GOs, US RECs). Market-based requires EAC registry API integration, contract-specific supplier factors, and residual mix factors from AIB (Europe) or EPA eGRID (US). The schema has a market_ef field placeholder — the pipeline just needs the lookup logic and EAC data feeds.</p>
        <p><strong>Why not built:</strong> EAC data availability is a client-by-client commercial problem (not all suppliers issue machine-readable certificates), not an engineering one. Implementing the shell without real data would be misleading.</p>

        <h3>3. Emission factor vintage matching</h3>
        <p>We apply a single EF version (DEFRA 2023, UBA 2023, IEA 2023) to all records regardless of activity year. Correct practice: a fuel purchase in 2021 should use 2021 DEFRA factors. The EmissionFactorRef table supports year-effective ranges and the ef_year field exists on records — but the pipeline step to year-match the lookup was not implemented.</p>
        <p><strong>Why not built:</strong> Requires seeding 3+ years of EF tables for each region/fuel combination (~200 rows) and a resolver that picks the nearest vintage. Worthwhile in production, but the marginal emissions accuracy gain over 1–2 years is under 3% for most fuel types and the architecture is already correct — it just needs the data populated.</p>
      </div>
    ),
  },

  sources: {
    label: 'SOURCES.md',
    content: () => (
      <div className="doc-section">
        <h2>Source Research</h2>

        <h3>SAP — IDoc / MM-PUR-PO</h3>
        <p><strong>Researched:</strong> SAP Help Portal MATMAS05/ORDERS05 IDoc documentation; SAP transaction ME2N (purchase order list report with CSV export); SAP Note 1886617 (date format variants); German SAP default locale behavior (column headers appear in German before EN locale patches are applied).</p>
        <p><strong>Learned:</strong> ME2N/ME80FN flat files are pipe- or tab-delimited with up to 80 columns, most empty for a typical fuel PO. MEINS (unit) uses SAP internal codes (L, M3, T, ST, KG), not ISO. Dates are always YYYYMMDD. Plant codes (WERKS) are 4-char alphanumeric and meaningless without the client's plant master table. Some SAP instances use "LT" instead of "L" for litres due to regional configuration.</p>
        <p><strong>Sample data rationale:</strong> 6 records across 3 plants (DE01 Hamburg, UK03 London, PL02 Poznań), 5 fuel types (diesel, petrol, heating oil, natural gas, LPG), 3 currencies (EUR, GBP, PLN), deliberately mixed units (L, T, M3, KG) to exercise the conversion logic. Two records have ambiguous units that trigger auto-flags.</p>
        <p><strong>What breaks in production:</strong> Plant-to-country mapping must be seeded at onboarding. MATNR prefix → fuel type mapping is client-specific. Non-standard unit codes. Tonne→litre density varies by fuel grade (B7 diesel 0.840 vs heavy fuel oil 0.991). MAKTX (material description) sometimes absent in German-locale exports.</p>

        <h3>Utility — Half-Hourly Portal CSV</h3>
        <p><strong>Researched:</strong> UK utility portal formats from Stark (used by Octopus, E.ON, EDF UK), Utiligroup (npower, Scottish Power). German utility portal exports from EnBW, RWE, Vattenfall. OFGEM MPAN structure (21 digits; profile class 00 = half-hourly metered for large commercial). IEA 2023 grid emission factors by country.</p>
        <p><strong>Learned:</strong> HH data is 48 settlement periods per day (30-min slots). Portal exports aggregate to billing period totals with peak/off-peak splits. Billing periods are utility-determined (28–35 days), almost never aligning with calendar months. Reactive power (kVArh) appears in exports but is a cost item, not an emissions driver. Green tariffs (SME-FLEX-GREEN) qualify for zero market-based Scope 2 if backed by REGOs — we flag this as a note rather than zeroing the location-based figure.</p>
        <p><strong>Sample data rationale:</strong> 3 sites with distinct grid regions and EFs. One record uses non-calendar billing period (Oct 18–Nov 17) to test period handling. Poland flagged for high EF uncertainty.</p>
        <p><strong>What breaks in production:</strong> PDF bill parsing for sites without portal access. Sub-meter data (8 meters per site). Market-based Scope 2 needing REGO matching. German/Polish portals sometimes export kWh in a different column order from UK Stark format.</p>

        <h3>Travel — Concur API v4 / Navan</h3>
        <p><strong>Researched:</strong> Concur Expense API v4 documentation (developer.concur.com), /expensereports endpoint, ReportSummary schema. Navan data export format (CSV via admin portal). ICAO Carbon Emissions Calculator methodology. DEFRA 2023 GHG Conversion Factors Table 8 (business travel — air). GDS class-of-service codes from Sabre/Amadeus (F=first, J/C=business, W=premium economy, Y/M/H/Q/...=economy).</p>
        <p><strong>Learned:</strong> A single trip in Concur generates multiple expense lines under one report_id (outbound flight, return flight, hotel nights, ground transport). GDS bookings always have IATA codes but rarely distances. DEFRA 2023 business class factor is 2.76× economy. RFI 1.891× is the DEFRA-recommended non-CO2 multiplier for Scope 3 Cat 6. Hotel chains enrolled in HCMI provide property-level EFs; non-enrolled use DEFRA country average.</p>
        <p><strong>Sample data rationale:</strong> Mix of short-haul (LHR-AMS 357km, DUS-MUC 465km — both flagged with rail alternative note), medium-haul (HAM-LHR 730km), long-haul business class (LHR-JFK 5540km, J-class — highest per-passenger impact). Hotel: 2 nights Warsaw + 4 nights New York to show cost-vs-emissions contrast.</p>
        <p><strong>What breaks in production:</strong> Off-platform bookings (personal card reimbursements with no IATA codes — just a cost and description like "Heathrow to Paris"). Rental car data without distance (just days + car category). Hotel chains not in HCMI. Connecting flights logged as two segments vs one trip.</p>
      </div>
    ),
  },
};

export default function DocsPage() {
  const [activeDoc, setActiveDoc] = useState('model');

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">Methodology & Documentation</span>
        <div className="topbar-meta">
          <span>GHG Protocol · DEFRA 2023 · ISO 14064</span>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24, maxWidth: 860 }}>
        <div className="doc-tab-bar">
          {Object.entries(DOCS).map(([key, doc]) => (
            <button
              key={key}
              className={`doc-tab ${activeDoc === key ? 'active' : ''}`}
              onClick={() => setActiveDoc(key)}
            >
              {doc.label}
            </button>
          ))}
        </div>

        <div className="animate-in" key={activeDoc}>
          {DOCS[activeDoc].content()}
        </div>
      </div>
    </div>
  );
}
