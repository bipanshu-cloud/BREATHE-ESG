# TRADEOFFS.md — Deliberate Non-Builds

## 1. Celery Async Ingestion Workers

**What it is:** The ingestion pipeline currently runs synchronously inside the Django request/response cycle. For large files — a 10,000-row annual SAP fuel extract, two years of half-hourly utility data — this will hit the HTTP timeout (120s on gunicorn).

**The correct architecture:**
1. Client uploads file → Django stores it to S3/GCS and returns `{task_id, batch_id}` immediately (< 200ms)
2. Celery worker picks up the task, runs `run_ingestion()`, updates batch status
3. Frontend polls `GET /api/batches/{batch_id}/` every 2s until `status == "staged"`
4. User sees live progress via batch record_count incrementing

**Why not built:** Adds Redis (task queue), Celery (worker process), and S3 (file storage) to the deployment stack. That triples the infrastructure configuration for a 4-day prototype. The actual ingestion logic (`run_ingestion()` in ingestion.py) is already factored out as a pure function — wrapping it in a Celery task is a 20-line change. The synchronous path handles files up to ~500 rows without issues, which covers the demo data comfortably.

**What you'd need:**
```python
# tasks.py
from celery import shared_task
from .ingestion import run_ingestion

@shared_task
def ingest_async(source_type, file_content, tenant_id, user_id):
    tenant = Tenant.objects.get(id=tenant_id)
    user = User.objects.get(id=user_id)
    return run_ingestion(source_type, file_content, tenant, user)
```

---

## 2. Market-Based Scope 2 Accounting

**What it is:** The GHG Protocol requires companies to report Scope 2 electricity under both the location-based method (grid average EF, which we implement) and the market-based method (supplier-specific EF using Energy Attribute Certificates).

Market-based Scope 2 requires:
- Energy Attribute Certificates: UK REGOs, EU Guarantees of Origin (GOs), US RECs
- EAC registry API integration (AIB for Europe, EPA eGRID for US)
- Contract-specific supplier emission factors (often provided as PDF disclosure documents, not APIs)
- Residual mix factors for uncovered consumption

**Why not built:** EAC data availability is a client-by-client commercial and operational problem, not an engineering one. Many suppliers still issue certificates as PDFs. Building the pipeline without real EAC data would produce a field that always shows zero or a placeholder — actively misleading.

The schema is ready: `raw_metadata` has a `market_ef` placeholder, and `EmissionFactorRef` can store supplier-specific factors. When a client has EAC data, the pipeline step is a lookup substitution, not a redesign.

**What it costs:** Clients who have renewable energy contracts and REGOs will report inflated Scope 2 until this is built. For some clients this is a material reporting gap (a client with 100% renewable tariffs shows the same Scope 2 as a coal-powered site on location-based).

---

## 3. Emission Factor Vintage Matching

**What it is:** We apply DEFRA 2023, UBA 2023, and IEA 2023 emission factors to all records regardless of the activity year. The correct methodology is to match the EF vintage to the activity year — a fuel purchase in November 2021 should use the 2021 DEFRA factor, not 2023.

Grid emission factors change materially year-on-year:
- UK grid EF: 0.2556 (2020) → 0.2078 (2023), a 19% reduction
- Poland grid EF: 0.773 (2020) → 0.716 (2023)

Applying 2023 EFs to 2020 activity understates UK Scope 2 by ~19% for that year.

**Why not built:** Requires seeding 4+ years × ~15 region/fuel combinations × 2 EF types (location/market) ≈ 200 reference rows, plus a resolver that picks `max(year) WHERE year <= activity_year` for each record. The `EmissionFactorRef` table has the `year` field and the schema is correct — it just needs the reference data populated and the pipeline updated to use a year-parameterised lookup instead of the hardcoded constants in `EMISSION_FACTORS`.

**What it costs:** Multi-year historical ingestion will have EF vintage mismatch. For a single reporting year (2023) this is a non-issue. For restatement exercises covering 2020–2023, figures will need recalculation once vintage matching is implemented.
