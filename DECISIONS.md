# DECISIONS.md — Every Ambiguity Resolved

## SAP: IDoc Flat File (not OData, not BAPI)

**Choice:** SAP MM-PUR-PO export via transaction ME2N / ME80FN as pipe-delimited flat file.

**Why not OData:** OData requires SAP Gateway to be configured and exposed — most on-premise SAP installations (which is the majority of enterprise clients) do not have Gateway enabled. Even when it is, it requires a client-specific ABAP endpoint for every data entity.

**Why not BAPI:** BAPI/RFC requires network connectivity to the SAP application server, a named RFC user, firewall exceptions, and often custom ABAP wrapper functions. The integration setup cost is disproportionate to a 4-day prototype.

**Why flat file:** ME2N is available in every SAP system, every client already knows how to run it, and it produces a complete PO line-item extract. It is the most common format clients actually send when asked for "fuel and procurement data."

**Tradeoff:** Batch-only (no real-time pull). Client must schedule the export and upload it. Acceptable for monthly/quarterly reporting cycles.

**Subset handled:** Purchase orders for fuel and energy materials (MATNR prefix matching). Excluded: FI-CO account postings (Scope 3.1 purchased goods), PM work orders (asset fuel consumption tracked differently), SAP Sustainability module (requires S/4HANA).

**Column handling:** German header dictionary translates 13 common headers. SAP date format YYYYMMDD → ISO 8601. Unit codes: L (litres), T (metric tonne → litres at 0.840 kg/L for diesel), M3 (cubic metres → kWh at 10.55 kWh/m³ for H-Gas), KG (kilograms → litres for LPG at 0.51 kg/L), KWH (direct). Density assumptions flagged automatically.

**Would ask the PM:**
1. Do clients have a plant-code-to-country mapping table we can ingest at onboarding? Without WERKS → site resolution, plant codes are opaque.
2. Are these Scope 1 (company-owned assets burning fuel) or Scope 3.1 (fuel purchased for resale/production)? Depends on whether the client owns and operates the combustion asset.
3. Do any clients use "LT" instead of "L" as the litre unit code (known regional SAP variant)?

---

## Utility: Portal CSV (not PDF, not API)

**Choice:** Portal CSV export in UK half-hourly (HH) metered format, also compatible with German and Polish utility portal exports.

**Why not PDF:** Bill layouts change 1–2× per year per utility. Two-column PDF layouts break standard tabular extraction. Scanned bills require OCR with 5–10% error rate on numbers. OCR errors in kWh figures directly corrupt emissions calculations.

**Why not API:** UK smart meter APIs (n3rgy, ENSEK) require OAuth2 tokens per MPAN, meaning one auth setup per meter point per client. A client with 50 sites has 50+ tokens to maintain. German (SMGW) and Polish APIs are even less standardised. Portal CSV gives the same data with a one-time export step.

**Billing period handling:** Utility billing periods are 28–35 days, almost never aligning with calendar month boundaries (e.g. Oct 18 – Nov 17 is a real Stark billing cycle). We store the exact billing period start and end dates and prorate to calendar months only at reporting time — preserving the original invoice data integrity. We flag non-standard period lengths (not 30 or 31 days) for analyst awareness.

**Grid emission factor selection:** Country extracted from `grid_region` field. UK → DESNZ 2023 (0.2078 kgCO2e/kWh). Germany → UBA 2023 (0.3664). Poland → IEA 2023 (0.716). Poland auto-flagged because Polish grid EF has high year-on-year variance (0.659–0.773) due to coal phase-down trajectory.

**Market-based Scope 2:** Not implemented (see TRADEOFFS.md). Field placeholder exists in schema.

**Would ask the PM:** Which utility portals do our first 10 clients actually use? Stark format vs Utiligroup vs German EnBW portal have slightly different column names for the same data.

---

## Travel: Concur API v4 CSV (IATA lookup, RFI applied)

**Choice:** Concur Expense API v4 expense report CSV export, compatible with Navan/TripActions admin export.

**Format rationale:** Concur is used by ~80% of enterprise travel managers. The CSV export is standardised across Concur implementations. Navan's export schema is a close superset (same core columns, additional hotel chain codes).

**Distance resolution:** GDS bookings (Sabre, Amadeus, Travelport) via Concur always provide IATA airport codes and class of service but rarely provide distances. We resolve via: (1) hardcoded lookup table for 1,200+ common city pairs, (2) DB lookup in IATADistance table (seeded with 12 pairs, extensible), (3) Haversine calculation from airport lat/lon coordinates as fallback. Distance source is logged in `raw_metadata`.

**Radiative forcing index:** DEFRA 2023 methodology mandates applying an RFI of 1.891× to air travel kgCO2e to account for non-CO2 warming effects (contrails, NOx, water vapour at altitude). This is the recommended approach for Scope 3 Category 6. We store base CO2 and RF-adjusted figures. RFI noted in `emission_factor_source`.

**Class of service:** GDS codes mapped: F → first (0.607 kgCO2e/km), J/C → business (0.429), W → premium economy (economy factor used conservatively), Y/M/H/Q/... → economy (0.155). Business class is 2.76× economy; first is 3.9× economy.

**Short-haul flag:** Flights under 550km where a rail alternative likely exists are auto-flagged with a note suggesting policy review. Threshold is configurable. This is informational, not a block — the record is still staged for analyst review.

**Hotel:** DEFRA 2023 average hotel factor (31.0 kgCO2e/night). HCMI property-level data not implemented (see TRADEOFFS.md).

**Ground transport:** DEFRA 2023 average car factor (0.14069 kgCO2e/km). If distance is not provided by the expense platform, kgCO2e = 0 and record is flagged.

**Would ask the PM:**
1. How do we handle flights booked outside the travel platform (personal card reimbursements)? These come in as cost + description, no IATA codes.
2. Hotel: DEFRA country average or HCMI property-level? HCMI is more accurate but requires chain enrollment.
3. Do any clients use Egencia, CTM, or AmexGBT instead of Concur/Navan? Their CSV formats differ.

---

## Other Ambiguities

| Ambiguity | Decision | Rationale |
|---|---|---|
| Multi-currency costs | Store in originating currency; never convert for emissions | FX conversion is for financial reporting, not GHG accounting |
| Duplicate ingestion | Upsert by source_record_id; new version if approved, overwrite if pending | Prevents phantom duplicates from re-upload without destroying review history |
| Missing MAKTX (SAP material description) | Fall back to MATNR prefix lookup | German SAP locale sometimes omits English descriptions |
| Heating oil density (T→L) | 0.840 kg/L (EN590 diesel density as approximation) | Standard industry default; flagged for analyst confirmation |
| H-Gas calorific value (M3→kWh) | 10.55 kWh/m³ | Standard German H-Gas. Lower calorific value varies 9.5–11.5; flagged for verification |
| Unknown plant code | Pass through + flag | Better to show suspicious data than silently drop it |
| Flight distance not in GDS | IATA lookup → Haversine → 800km default | Haversine is within 2% of actual route for most pairs; default 800km is conservative |
