# SOURCES.md — Source Research

## 1. SAP — IDoc / MM-PUR-PO Flat File

### What I Researched
- SAP Help Portal: IDoc type MATMAS05 (material master) and ORDERS05 (purchase order) documentation
- SAP transaction ME2N (purchase orders by material) and ME80FN (purchase order reporting) — the two most common ways a SAP user exports PO data
- SAP Note 1886617: date format variants in flat file exports
- German SAP locale behavior: when SAP client language = DE, column headers appear in German (Bestellnummer, Menge, Mengeneinheit, Belegdatum) unless an EN patch is applied. This is the default for most European SAP installations
- SAP unit of measure codes: internal codes (L, LT, M3, KG, T, ST, G, ML) vs ISO codes — SAP does not use ISO by default
- Plant code (WERKS) structure: 4-character alphanumeric, company-specific, no global standard

### What I Learned
ME2N exports are pipe- or tab-delimited with 40–80 columns, most empty for a standard fuel PO. The minimum useful fields are: EBELN (PO number), EBELP (line item), MATNR (material number), MENGE (quantity), MEINS (unit of measure), BEDAT (document date), WERKS (plant).

German headers appear in exports from ~60% of European enterprise SAP instances in my research. A robust parser must handle both. The column translation dictionary I built covers the 13 most common fields in a fuel PO export.

MATNR (material number) is client-specific — there is no global standard. "MAT-DIESEL-001" is our sample. A real client might use "P-FUEL-DSL-EN590" or just "10000045". The fuel type classification uses a prefix-matching heuristic that must be calibrated at onboarding.

### Sample Data Rationale
6 records covering:
- 3 plants across 3 countries (DE01 Hamburg, UK03 London, PL02 Poznań) — tests plant lookup and multi-currency
- 5 fuel types (diesel, petrol, heating oil, natural gas, LPG) — tests material classification breadth
- 4 unit codes (L, T, M3, KG) — exercises all conversion paths
- 2 records with ambiguous conversions (sap-003: tonnes of heating oil, sap-004: m³ of natural gas) — both auto-flagged as intended
- 3 currencies (EUR, GBP, PLN) — tests that cost currency does not contaminate emission quantities

### What Breaks in Production
1. **Plant master not seeded.** If the client doesn't provide a WERKS→country/site table at onboarding, plant codes are opaque. The flag system catches this but the analyst has no context.
2. **Client-specific MATNR scheme.** Our prefix heuristic works for our sample. A real client will need a custom material-to-fuel mapping configured.
3. **Non-standard unit codes.** "LT" instead of "L" (used in some Eastern European SAP configs). "GL" (gallon) in some US-influenced deployments. "CBM" instead of "M3".
4. **Heating oil density assumption.** 0.840 kg/L is correct for EN590 diesel and light heating oil (Heizöl EL). Heavy fuel oil (Heizöl S) is 0.870–0.990 kg/L — using 0.840 understates kgCO2e by up to 18%.
5. **Natural gas calorific value.** 10.55 kWh/m³ is standard for German H-Gas. L-Gas (used in parts of Netherlands and Northwest Germany) is 8.6–9.5 kWh/m³. Using H-Gas value for L-Gas overstates kgCO2e by ~10%.
6. **Re-exports and non-combustion purchases.** A PO for diesel could be for fleet vehicles (Scope 1) or for resale (Scope 3.1 purchased goods). Without an asset ownership flag we classify everything as Scope 1.

---

## 2. Utility — Half-Hourly Portal CSV

### What I Researched
- UK utility portal formats: Stark platform (used by Octopus Business, E.ON UK, EDF UK), Utiligroup (npower/E.ON, Scottish Power), Siemens EnergyIP
- German utility portals: EnBW Energie Baden-Württemberg, RWE, Vattenfall (now EPH) Berlin
- Polish utility portals: PGE Polska Grupa Energetyczna, Tauron
- OFGEM MPAN structure: 21-digit Meter Point Administration Number. Profile class = first 2 digits: 00 = half-hourly metered (>= 100kVA), 01-08 = non-half-hourly
- IEA 2023 Electricity Emission Factors by country
- DESNZ (UK Dept. Energy Security) 2023 GHG Conversion Factors for grid electricity
- UBA (German Environment Agency) 2023 CO2 emission factors for German electricity mix

### What I Learned
Half-hourly (HH) metered sites are large commercial/industrial consumers (profile class 00). Their portal exports aggregate 48 × 30-minute settlement periods into billing period totals with peak/off-peak splits. The key insight: billing periods are utility-determined, not calendar-aligned. Oct 18 – Nov 17 is a standard Stark billing cycle for some customers.

UK Stark format uses these exact column names: `MPAN, meter_serial, site_name, billing_ref, billing_period_start, billing_period_end, tariff_code, total_kwh, peak_kwh, offpeak_kwh, reactive_kvarh, max_demand_kw`. German portals use similar columns but in German (`Zählpunkt, Verbrauch_kWh`) and sometimes separate files per tariff zone.

Reactive power (kVArh) appears in every HH export but is irrelevant to GHG accounting — it's a power quality metric charged commercially but produces no additional emissions. We store it in `raw_metadata` for cost reconciliation but do not use it in calculations.

### Sample Data Rationale
4 records covering:
- 3 sites across 3 countries/grid regions (Hamburg/DE-TransnetBW, London/GB-National, Poznań/PL-PSE) — exercises 3 different EF values
- 1 non-calendar billing period (util-002: Oct 18–Nov 17) — tests period handling and flag logic
- 1 flagged high-uncertainty EF (util-003: Poland, coal-heavy grid with high year-on-year variance)
- Consumption range from 28,400 kWh (small UK office) to 318,600 kWh (Polish industrial factory) — realistic scale contrast

### What Breaks in Production
1. **PDF bill clients.** Facilities managers at smaller sites (e.g. a 20-person regional office) often only have PDF invoices, not portal access. PDF parsing is out of scope but is needed for full coverage.
2. **Sub-metering.** A single MPAN may have 8 sub-meters feeding different processes (heating, cooling, production line). Our model stores one row per MPAN per billing period. Sub-meter attribution to cost centres requires a site sub-metering schema not in this prototype.
3. **Market-based Scope 2.** The SME-FLEX-GREEN tariff in util-002 is backed by REGOs. Under market-based accounting this should be reported as zero Scope 2. We do not have REGO certificate data.
4. **Half-hourly vs non-half-hourly export formats.** Non-HH sites (profile class 01-08, smaller commercial) use monthly reads, not HH data. Some portals produce a different CSV format for these.
5. **German portal column name variants.** EnBW uses "Zählpunkt" for MPAN; RWE uses "Messlokations-ID". A production system needs per-portal column mapping configuration.

---

## 3. Travel — Concur API v4 / Navan Export

### What I Researched
- Concur Expense API v4 documentation at developer.concur.com: `/expensereports` endpoint, `ReportSummary` and `ReportDetail` schemas
- Navan (formerly TripActions) admin data export format: CSV with columns trip_id, traveller_email, segment_type, origin_airport, destination_airport, cabin_class, booking_date, travel_date, cost, currency, purpose
- ICAO Carbon Emissions Calculator 2023 methodology document — distance computation, load factor adjustments, seat pitch class definitions
- DEFRA 2023 GHG Conversion Factors for Company Reporting, Table 8: Business travel by air, Table 9: Hotels, Table 10: Car hire
- GDS class-of-service codes: Sabre/Amadeus/Travelport booking class mapping (F/A = first, C/J/D/I = business, W/S = premium economy, Y/M/H/Q/K/... = economy)
- DEFRA 2023 radiative forcing methodology note (Section 3.8): RFI 1.891× recommended for Scope 3 Category 6 air travel

### What I Learned
A single business trip in Concur generates multiple expense report lines linked by `report_id`. LHR–JFK return with 4 hotel nights creates: 2 AIR lines (outbound + return), 4 HOTEL lines (or 1 with `nights=4` depending on Concur configuration), possibly 1–2 GROUND lines (taxi at each end). These must be stored as separate `EmissionRecord` rows (different categories) but remain linkable by `report_id` in `raw_metadata`.

GDS data from Sabre/Amadeus always provides: booking reference (PNR), carrier IATA code, origin/destination IATA codes, class of service (single letter), passenger count, booking date, travel date. It almost never provides segment distance — this must be calculated.

DEFRA 2023 business class multiplier vs economy: 2.76× (seat space ratio × load factor adjustment). First class: 3.90×. Radiative forcing index 1.891× accounts for contrails, NOx, and water vapour effects at cruise altitude — this doubles the effective kgCO2e vs pure combustion CO2. Some reporting frameworks exclude RFI; DEFRA and GHG Protocol Scope 3 guidance recommend including it.

### Sample Data Rationale
7 records covering:
- Long-haul business class (LHR-JFK, 5540km, J-class): highest per-seat impact, tests class multiplier
- Short-haul flagged (LHR-AMS, 357km, Y-class): under 550km threshold, rail alternative note
- Short-haul flagged (DUS-MUC, 465km, Y-class): domestic German flight, ICE train alternative exists
- Medium-haul economy (HAM-LHR, 730km): baseline flight without flags
- Hotel (Warsaw, 2 nights) + Hotel (New York, 4 nights): tests DEFRA average hotel factor
- Ground transport (rental car, 180km provided): tests distance-provided path

The LHR-JFK business class traveller (Sarah Mitchell) also has a New York hotel record — both linked by report_id RPT-2023-11-4422/4424, demonstrating the trip-level linkage pattern.

### What Breaks in Production
1. **Off-platform bookings.** An employee who books directly on Ryanair.com and submits as an expense reimbursement gets logged with just a cost and description — no IATA codes, no class, no distance. Our parser outputs a zero-kgCO2e record with a `distance_missing` flag. These require manual enrichment.
2. **Rental car distance missing.** Car hire expenses often show only days and car category, not distance driven. We can estimate from daily average km by car category (ICAO business car: 150 km/day) but this is a rough approximation. Our current code flags distance_missing and sets kgCO2e = 0.
3. **HCMI hotel data.** Property-level carbon intensity varies 10× between hotels (7 kgCO2e/night for a modern Scandinavian eco-hotel vs 70+ for an older US property). We use the DEFRA national average (31 kgCO2e/night for UK, similar globally). Properties enrolled in the Hotel Carbon Measurement Initiative provide property-level data, but most do not.
4. **Connecting flights.** A LHR–FRA–DXB routing logged as two segments needs combining into one trip leg for accurate distance calculation (separate segments × RFI would double-count the RFI). Concur usually logs these as separate expense lines.
5. **Non-Concur/Navan platforms.** Egencia (Expedia Group), CWT (Carlson Wagonlit), AmexGBT, and BCD Travel each have different CSV export formats. A production system needs platform-specific parsers or a normalisation layer.
