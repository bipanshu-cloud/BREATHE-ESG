# MODEL.md — Data Model

## Core Design Principles

1. **Multi-tenant isolation** — every row carries `tenant_id`; queries are always scoped to the authenticated user's tenant
2. **Audit immutability** — approved records are never updated in-place; edits create new versions
3. **Source-of-truth tracking** — original raw data preserved in `raw_metadata` JSONB; original file stored in object storage
4. **Unit normalization** — canonical units assigned at ingestion; conversion factors documented and version-controlled
5. **GHG Protocol alignment** — scope assigned from source type + material category, not free-text

---

## Table Definitions

### `Tenant`
Multi-tenant root. Every other table references this.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | TEXT | Client company name |
| sector | TEXT | e.g. Manufacturing |
| created_at | TIMESTAMPTZ | |

---

### `IngestionBatch`
Tracks one file/API ingestion event.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | FK → Tenant | |
| source_type | ENUM | SAP \| UTILITY \| TRAVEL |
| ingested_at | TIMESTAMPTZ | |
| ingested_by | FK → User | service account or analyst |
| raw_filename | TEXT | original filename |
| record_count | INT | rows successfully saved |
| status | ENUM | processing \| staged \| failed |
| error_log | TEXT | parse/save errors |

---

### `EmissionRecord`
Core emissions row. The heart of the model.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | FK → Tenant | row-level isolation |
| batch_id | FK → IngestionBatch | provenance |
| source | TEXT | "SAP IDoc / MM-PUR-PO", "Utility Portal CSV", "Concur / Navan Travel" |
| source_record_id | TEXT | natural key from upstream (EBELN+EBELP, MPAN+billing_ref, report_id+line). Used for upsert on re-ingestion |
| scope | SMALLINT | 1 \| 2 \| 3 |
| ghg_category | TEXT | GHG Protocol label (e.g. "Stationary combustion", "Purchased electricity") |
| activity_date | DATE | |
| quantity_raw | NUMERIC | as received from source |
| unit_raw | TEXT | original unit (L, T, M3, KWH…) |
| quantity_normalized | NUMERIC | after unit conversion |
| unit_normalized | TEXT | canonical: litres, kWh, km, nights |
| emission_factor | NUMERIC | kgCO2e per unit |
| emission_factor_unit | TEXT | e.g. "kgCO2e/litre" |
| emission_factor_source | TEXT | "DEFRA 2023", "UBA 2023", "IEA 2023" |
| kgco2e | NUMERIC | quantity_normalized × emission_factor |
| raw_metadata | JSONB | full original row fields preserved |
| flags | JSONB | array of {code, detail, type: auto\|manual} |
| status | ENUM | pending \| flagged \| approved \| rejected |
| approved_by | FK → User | nullable |
| approved_at | TIMESTAMPTZ | nullable |
| version | INT | incremented on edit; starts at 1 |
| superseded_by | FK → self | nullable; points to newer version |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Unique constraint:** `(tenant_id, source_record_id, version)` — prevents duplicates, allows versioning.

---

### `AuditEvent`
Append-only. Never updated. Every action on every record is logged here.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | FK → Tenant | |
| record_id | FK → EmissionRecord | nullable (batch events) |
| batch_id | FK → IngestionBatch | nullable (record events) |
| actor | TEXT | username or "system" |
| action | ENUM | INGEST \| APPROVE \| REJECT \| FLAG \| UNFLAG \| EDIT \| EXPORT |
| payload | JSONB | before/after for edits; counts for ingests |
| ts | TIMESTAMPTZ | |

---

### Reference Tables

**`PlantLookup`** — SAP plant codes to geography. Seeded at client onboarding.
`(plant_code, company_code, country_code, site_name)`

**`EmissionFactorRef`** — Versioned emission factors. Year-matched at ingestion.
`(fuel_type, region, year, ef_value, unit, source)` — unique on `(fuel_type, region, year)`

**`IATADistance`** — Great-circle km between airport pairs.
`(origin, destination, distance_km)` — unique on `(origin, destination)`

---

## Multi-tenancy Implementation

All querysets in views.py are scoped with `.filter(tenant=tenant)` where tenant is derived from the authenticated user. In production PostgreSQL this should be reinforced with RLS policies:

```sql
ALTER TABLE emissions_emissionrecord ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON emissions_emissionrecord
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Application sets `SET app.tenant_id = '<uuid>'` at the start of each request.

---

## Audit Immutability

Approved records follow the "append-only with versioning" pattern:

```
Record v1 (approved) → superseded_by = NULL
  ↓ analyst edits
Record v2 (pending)  → superseded_by = NULL
Record v1.superseded_by = Record v2's id
```

The live queryset always filters `superseded_by__isnull=True` to show only current versions. Historical versions are accessible via the `previous_versions` reverse relation.
