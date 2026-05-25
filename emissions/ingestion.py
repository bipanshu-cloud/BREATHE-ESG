"""
Breathe ESG — Ingestion Pipeline

Three parsers, one normalizer interface:
  parse_sap(file)     → list of raw dicts
  parse_utility(file) → list of raw dicts
  parse_travel(file)  → list of raw dicts

Each returns rows that get passed to normalize_and_save() which:
  1. Maps units to canonical form
  2. Looks up emission factors (DEFRA/UBA/IEA)
  3. Computes kgCO2e
  4. Assigns GHG Protocol scope & category
  5. Runs flag rules
  6. Creates EmissionRecord rows in DB
"""

import csv
import io
import math
import logging
from datetime import datetime, date
from decimal import Decimal, ROUND_HALF_UP

from .models import (
    EmissionRecord, IngestionBatch, AuditEvent,
    PlantLookup, EmissionFactorRef, IATADistance
)

logger = logging.getLogger(__name__)


# ── Emission factor tables (fallback when DB has no match) ──────
# DEFRA 2023, UBA 2023, IEA 2023 values
EMISSION_FACTORS = {
    # fuel_type: kgCO2e per litre (liquid) or per kWh (gas)
    'diesel':       {'ef': Decimal('2.6391'), 'unit': 'kgCO2e/litre', 'source': 'DEFRA 2023'},
    'petrol':       {'ef': Decimal('2.3161'), 'unit': 'kgCO2e/litre', 'source': 'DEFRA 2023'},
    'heating_oil':  {'ef': Decimal('2.5203'), 'unit': 'kgCO2e/litre', 'source': 'DEFRA 2023'},
    'lpg':          {'ef': Decimal('1.5548'), 'unit': 'kgCO2e/litre', 'source': 'DEFRA 2023'},
    'natural_gas':  {'ef': Decimal('0.2026'), 'unit': 'kgCO2e/kWh',   'source': 'DEFRA 2023'},
    # Grid electricity by region
    'electricity_GB':  {'ef': Decimal('0.2078'), 'unit': 'kgCO2e/kWh', 'source': 'DESNZ 2023'},
    'electricity_DE':  {'ef': Decimal('0.3664'), 'unit': 'kgCO2e/kWh', 'source': 'UBA 2023'},
    'electricity_PL':  {'ef': Decimal('0.7160'), 'unit': 'kgCO2e/kWh', 'source': 'IEA 2023'},
    'electricity_EU':  {'ef': Decimal('0.2760'), 'unit': 'kgCO2e/kWh', 'source': 'IEA 2023'},
    # Travel
    'flight_economy':  {'ef': Decimal('0.15529'), 'unit': 'kgCO2e/km', 'source': 'DEFRA 2023'},
    'flight_business': {'ef': Decimal('0.42857'), 'unit': 'kgCO2e/km', 'source': 'DEFRA 2023'},
    'flight_first':    {'ef': Decimal('0.60686'), 'unit': 'kgCO2e/km', 'source': 'DEFRA 2023'},
    'hotel_night':     {'ef': Decimal('31.0'),    'unit': 'kgCO2e/night', 'source': 'DEFRA 2023'},
    'ground_car':      {'ef': Decimal('0.14069'), 'unit': 'kgCO2e/km', 'source': 'DEFRA 2023'},
}

# Radiative forcing index for air travel (DEFRA 2023 non-CO2 effects)
FLIGHT_RFI = Decimal('1.891')

# SAP unit code → (conversion_factor_to_canonical, canonical_unit, notes)
SAP_UNIT_MAP = {
    'L':   (Decimal('1'),      'litres',  ''),
    'LT':  (Decimal('1'),      'litres',  'alternate SAP litre code'),
    'GAL': (Decimal('4.54609'),'litres',  'UK gallon→litre'),
    'M3':  (Decimal('10.55'),  'kWh',     'natural gas m³→kWh at 10.55 kWh/m³ calorific value'),
    'KWH': (Decimal('1'),      'kWh',     ''),
    'T':   (Decimal('1190'),   'litres',  'metric tonne diesel→litres at density 0.840 kg/L'),
    'KG':  (Decimal('1.96'),   'litres',  'LPG kg→litres at density 0.51 kg/L'),
    'ST':  (None,              None,      'piece — non-energy, cannot compute emissions'),
}

# SAP material number prefix → fuel classification
MATERIAL_FUEL_MAP = {
    'MAT-DIESEL':   'diesel',
    'MAT-PETROL':   'petrol',
    'MAT-GASÖL':    'heating_oil',
    'MAT-HEIZÖL':   'heating_oil',
    'MAT-NG':       'natural_gas',
    'MAT-GAS':      'natural_gas',
    'MAT-LPG':      'lpg',
    'FUL-DSL':      'diesel',
    'FUL-PET':      'petrol',
    'FUL-GAS':      'natural_gas',
}

# German→English SAP column header mapping
SAP_COLUMN_MAP = {
    'Bestellnummer': 'EBELN',
    'Bestellposition': 'EBELP',
    'Lieferant': 'LIFNR',
    'Werk': 'WERKS',
    'Material': 'MATNR',
    'Materialkurztext': 'MAKTX',
    'Bestellmenge': 'MENGE',
    'Bestellmengeneinheit': 'MEINS',
    'Nettopreis': 'NETPR',
    'Waehrung': 'WAERS',
    'Belegdatum': 'BEDAT',
    'Buchungskreis': 'BUKRS',
    'Kostenstelle': 'KOSTL',
}

# IATA great-circle distances (km) — common pairs
IATA_DISTANCES = {
    ('HAM', 'LHR'): 730, ('LHR', 'HAM'): 730,
    ('LHR', 'JFK'): 5540, ('JFK', 'LHR'): 5540,
    ('LHR', 'AMS'): 357, ('AMS', 'LHR'): 357,
    ('DUS', 'MUC'): 465, ('MUC', 'DUS'): 465,
    ('LHR', 'CDG'): 344, ('CDG', 'LHR'): 344,
    ('FRA', 'LHR'): 639, ('LHR', 'FRA'): 639,
    ('LHR', 'MAD'): 1246, ('MAD', 'LHR'): 1246,
    ('LHR', 'DXB'): 5488, ('DXB', 'LHR'): 5488,
    ('LHR', 'SIN'): 10841, ('SIN', 'LHR'): 10841,
    ('LHR', 'ORD'): 6350, ('ORD', 'LHR'): 6350,
    ('HAM', 'FRA'): 393,  ('FRA', 'HAM'): 393,
    ('WAW', 'LHR'): 1449, ('LHR', 'WAW'): 1449,
}

# Airport lat/lon for Haversine fallback
AIRPORT_COORDS = {
    'LHR': (51.477, -0.461), 'JFK': (40.641, -73.778), 'AMS': (52.308, 4.764),
    'CDG': (49.013, 2.550), 'FRA': (50.033, 8.571), 'HAM': (53.630, 10.006),
    'MUC': (48.353, 11.786), 'DUS': (51.289, 6.767), 'WAW': (52.166, 20.967),
    'DXB': (25.253, 55.365), 'SIN': (1.359, 103.989), 'ORD': (41.978, -87.904),
    'MAD': (40.472, -3.561),
}


def haversine_km(origin, dest):
    """Great-circle distance between two IATA codes via Haversine."""
    c = AIRPORT_COORDS.get(origin)
    d = AIRPORT_COORDS.get(dest)
    if not c or not d:
        return 800  # fallback average
    R = 6371
    lat1, lon1, lat2, lon2 = map(math.radians, [c[0], c[1], d[0], d[1]])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return int(2 * R * math.asin(math.sqrt(a)))


def get_flight_distance(origin, dest):
    """IATA pair lookup, fallback to Haversine."""
    dist = IATA_DISTANCES.get((origin, dest))
    if dist:
        return dist
    # Try DB
    try:
        row = IATADistance.objects.get(origin=origin, destination=dest)
        return row.distance_km
    except IATADistance.DoesNotExist:
        pass
    return haversine_km(origin, dest)


def get_ef(fuel_type):
    """Get emission factor dict for a fuel type."""
    return EMISSION_FACTORS.get(fuel_type, {
        'ef': Decimal('2.6391'), 'unit': 'kgCO2e/unit', 'source': 'DEFRA 2023 (default)'
    })


def detect_fuel_from_matnr(matnr: str) -> str:
    """Map SAP material number prefix to fuel type."""
    matnr_upper = matnr.upper()
    for prefix, fuel in MATERIAL_FUEL_MAP.items():
        if matnr_upper.startswith(prefix.upper()):
            return fuel
    # Heuristic from material description
    return 'diesel'  # safest default for procurement fuel


def normalise_columns(headers: list) -> list:
    """Translate German SAP headers to English field names."""
    return [SAP_COLUMN_MAP.get(h, h) for h in headers]


def parse_sap_date(datestr: str) -> date:
    """Parse SAP YYYYMMDD date format."""
    datestr = datestr.strip()
    if len(datestr) == 8 and datestr.isdigit():
        return datetime.strptime(datestr, '%Y%m%d').date()
    # Fallback: try ISO
    for fmt in ('%Y-%m-%d', '%d.%m.%Y', '%d/%m/%Y'):
        try:
            return datetime.strptime(datestr, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Cannot parse SAP date: {datestr!r}")


# ── SAP Parser ──────────────────────────────────────────────────

def parse_sap(file_content: str) -> tuple[list, list]:
    """
    Parse SAP IDoc flat file / MM-PUR-PO CSV export.
    Returns (rows, errors).

    Handles:
    - Tab or pipe delimited
    - German column headers
    - SAP date format YYYYMMDD
    - Mixed units (L, T, M3, KG, KWH)
    """
    rows = []
    errors = []

    # Detect delimiter
    first_line = file_content.split('\n')[0]
    delimiter = '|' if '|' in first_line else '\t' if '\t' in first_line else ','

    reader = csv.DictReader(io.StringIO(file_content), delimiter=delimiter)

    # Normalise German headers
    if reader.fieldnames:
        reader.fieldnames = normalise_columns(reader.fieldnames)

    required = {'EBELN', 'EBELP', 'MATNR', 'MENGE', 'MEINS', 'BEDAT', 'WERKS'}

    for i, row in enumerate(reader):
        try:
            # Check required fields
            missing = required - set(row.keys())
            if missing:
                errors.append(f"Row {i+1}: missing fields {missing}")
                continue

            ebeln = row.get('EBELN', '').strip()
            ebelp = row.get('EBELP', '').strip()
            matnr = row.get('MATNR', '').strip()
            menge_str = row.get('MENGE', '0').strip().replace(',', '.')
            meins = row.get('MEINS', '').strip().upper()
            bedat = row.get('BEDAT', '').strip()
            werks = row.get('WERKS', '').strip()

            if not all([ebeln, matnr, menge_str, meins, bedat]):
                errors.append(f"Row {i+1}: empty required field")
                continue

            menge = Decimal(menge_str)
            activity_date = parse_sap_date(bedat)

            rows.append({
                'source_record_id': f"{ebeln}-{ebelp}",
                'EBELN': ebeln,
                'EBELP': ebelp,
                'LIFNR': row.get('LIFNR', '').strip(),
                'WERKS': werks,
                'MATNR': matnr,
                'MAKTX': row.get('MAKTX', '').strip(),
                'MENGE': menge,
                'MEINS': meins,
                'NETPR': row.get('NETPR', '0').strip(),
                'WAERS': row.get('WAERS', '').strip(),
                'BEDAT': bedat,
                'BUKRS': row.get('BUKRS', '').strip(),
                'KOSTL': row.get('KOSTL', '').strip(),
                'activity_date': activity_date,
            })
        except Exception as e:
            errors.append(f"Row {i+1}: {e}")

    return rows, errors


def normalize_sap_row(row: dict, tenant, batch) -> dict:
    """Convert one parsed SAP row into EmissionRecord kwargs."""
    flags = []
    meins = row['MEINS']
    menge = row['MENGE']
    matnr = row['MATNR']
    fuel_type = detect_fuel_from_matnr(matnr)

    # Unit conversion
    unit_info = SAP_UNIT_MAP.get(meins)
    if unit_info is None:
        flags.append({'code': 'unknown_unit', 'detail': f"Unknown unit '{meins}' — defaulting to litres", 'type': 'auto'})
        qty_norm = menge
        unit_norm = meins
    elif unit_info[0] is None:
        flags.append({'code': 'non_energy', 'detail': f"Unit '{meins}' (piece) cannot be converted to energy — skipped", 'type': 'auto'})
        qty_norm = menge
        unit_norm = meins
    else:
        conv, unit_norm, note = unit_info
        qty_norm = (menge * conv).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if meins == 'T':
            flags.append({
                'code': 'unit_conversion_required',
                'detail': f"T→litres: density 0.840 kg/L assumed. Verify with supplier spec sheet.",
                'type': 'auto'
            })
        elif meins == 'M3':
            flags.append({
                'code': 'unit_conversion_required',
                'detail': f"M³→kWh: calorific value 10.55 kWh/m³ assumed (H-Gas). Verify with supplier.",
                'type': 'auto'
            })

    # Emission factor
    ef_data = get_ef(fuel_type)
    ef = ef_data['ef']
    kgco2e = (qty_norm * ef).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    # Plant lookup
    try:
        plant = PlantLookup.objects.get(plant_code=row['WERKS'])
        site_name = plant.site_name
    except PlantLookup.DoesNotExist:
        site_name = row['WERKS']
        flags.append({
            'code': 'plant_not_in_lookup',
            'detail': f"Plant code '{row['WERKS']}' not in lookup table — site name unknown",
            'type': 'auto'
        })

    return {
        'source': 'SAP IDoc / MM-PUR-PO',
        'source_record_id': row['source_record_id'],
        'scope': 1,
        'ghg_category': 'Stationary combustion' if fuel_type in ('natural_gas', 'heating_oil', 'lpg') else 'Mobile combustion',
        'activity_date': row['activity_date'],
        'quantity_raw': menge,
        'unit_raw': meins,
        'quantity_normalized': qty_norm,
        'unit_normalized': unit_norm,
        'emission_factor': ef,
        'emission_factor_unit': ef_data['unit'],
        'emission_factor_source': ef_data['source'],
        'kgco2e': kgco2e,
        'raw_metadata': {
            'EBELN': row['EBELN'], 'EBELP': row['EBELP'], 'LIFNR': row['LIFNR'],
            'WERKS': row['WERKS'], 'MATNR': matnr, 'MAKTX': row['MAKTX'],
            'NETPR': row['NETPR'], 'WAERS': row['WAERS'], 'BUKRS': row['BUKRS'],
            'KOSTL': row['KOSTL'], 'fuel_type': fuel_type, 'site_name': site_name,
        },
        'flags': flags,
        'status': 'flagged' if flags else 'pending',
    }


# ── Utility Parser ──────────────────────────────────────────────

GRID_EF_MAP = {
    'GB': 'electricity_GB', 'UK': 'electricity_GB',
    'DE': 'electricity_DE',
    'PL': 'electricity_PL',
}

def parse_utility(file_content: str) -> tuple[list, list]:
    """
    Parse utility portal CSV export.
    Expected columns: MPAN, meter_serial, site_name, billing_ref,
    billing_period_start, billing_period_end, tariff_code, total_kwh,
    peak_kwh, offpeak_kwh, grid_region, currency, total_cost
    """
    rows = []
    errors = []

    reader = csv.DictReader(io.StringIO(file_content))
    required = {'MPAN', 'billing_period_start', 'billing_period_end', 'total_kwh', 'grid_region'}

    for i, row in enumerate(reader):
        try:
            missing = required - set(row.keys())
            if missing:
                errors.append(f"Row {i+1}: missing fields {missing}")
                continue

            mpan = row['MPAN'].strip()
            billing_ref = row.get('billing_ref', '').strip()
            kwh_str = row['total_kwh'].strip().replace(',', '')
            total_kwh = Decimal(kwh_str)
            grid_region = row['grid_region'].strip()
            period_start = datetime.strptime(row['billing_period_start'].strip(), '%Y-%m-%d').date()
            period_end = datetime.strptime(row['billing_period_end'].strip(), '%Y-%m-%d').date()

            rows.append({
                'source_record_id': f"{mpan}-{billing_ref or period_start}",
                'MPAN': mpan,
                'meter_serial': row.get('meter_serial', '').strip(),
                'site_name': row.get('site_name', '').strip(),
                'billing_ref': billing_ref,
                'billing_period_start': period_start,
                'billing_period_end': period_end,
                'tariff_code': row.get('tariff_code', '').strip(),
                'total_kwh': total_kwh,
                'peak_kwh': row.get('peak_kwh', '0').strip(),
                'offpeak_kwh': row.get('offpeak_kwh', '0').strip(),
                'grid_region': grid_region,
                'currency': row.get('currency', '').strip(),
                'total_cost': row.get('total_cost', '0').strip(),
                'activity_date': period_start,
            })
        except Exception as e:
            errors.append(f"Row {i+1}: {e}")

    return rows, errors


def normalize_utility_row(row: dict, tenant, batch) -> dict:
    flags = []
    grid_region = row['grid_region']
    country_code = grid_region.split('-')[0] if '-' in grid_region else grid_region

    ef_key = GRID_EF_MAP.get(country_code.upper(), 'electricity_EU')
    ef_data = get_ef(ef_key)
    ef = ef_data['ef']

    if country_code.upper() == 'PL':
        flags.append({
            'code': 'emission_factor_uncertainty',
            'detail': 'Poland grid EF varies 0.659–0.773 kgCO2e/kWh year-on-year (coal-heavy). Using IEA 2023 mean 0.716.',
            'type': 'auto'
        })

    total_kwh = row['total_kwh']
    kgco2e = (total_kwh * ef).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    # Non-calendar billing period warning
    start = row['billing_period_start']
    end = row['billing_period_end']
    billing_days = (end - start).days + 1
    if billing_days != 30 and billing_days != 31:
        flags.append({
            'code': 'non_calendar_billing_period',
            'detail': f"Billing period {start} → {end} ({billing_days} days) does not align with calendar month. Stored as-is; prorate at reporting time.",
            'type': 'auto'
        })

    return {
        'source': 'Utility Portal CSV',
        'source_record_id': row['source_record_id'],
        'scope': 2,
        'ghg_category': 'Purchased electricity',
        'activity_date': row['activity_date'],
        'quantity_raw': total_kwh,
        'unit_raw': 'kWh',
        'quantity_normalized': total_kwh,
        'unit_normalized': 'kWh',
        'emission_factor': ef,
        'emission_factor_unit': ef_data['unit'],
        'emission_factor_source': ef_data['source'],
        'kgco2e': kgco2e,
        'raw_metadata': {
            'MPAN': row['MPAN'], 'meter_serial': row['meter_serial'],
            'site_name': row['site_name'], 'billing_ref': row['billing_ref'],
            'billing_period_start': str(start), 'billing_period_end': str(end),
            'billing_days': billing_days, 'tariff_code': row['tariff_code'],
            'peak_kwh': row['peak_kwh'], 'offpeak_kwh': row['offpeak_kwh'],
            'grid_region': grid_region, 'currency': row['currency'],
            'total_cost': row['total_cost'],
        },
        'flags': flags,
        'status': 'flagged' if flags else 'pending',
    }


# ── Travel Parser ───────────────────────────────────────────────

CLASS_EF_MAP = {
    'F': 'flight_first',
    'J': 'flight_business', 'C': 'flight_business',
    'W': 'flight_economy',  # premium eco — use economy factor as conservative
    'Y': 'flight_economy',
}

def parse_travel(file_content: str) -> tuple[list, list]:
    """
    Parse Concur / Navan travel expense CSV.
    Handles AIR, HOTEL, GROUND expense types.
    """
    rows = []
    errors = []

    reader = csv.DictReader(io.StringIO(file_content))
    required = {'report_id', 'expense_type', 'cost', 'currency'}

    for i, row in enumerate(reader):
        try:
            missing = required - set(row.keys())
            if missing:
                errors.append(f"Row {i+1}: missing fields {missing}")
                continue

            expense_type = row['expense_type'].strip().upper()
            report_id = row['report_id'].strip()
            line_num = row.get('line_num', str(i+1)).strip()

            rows.append({
                'source_record_id': f"{report_id}-{expense_type}-{line_num}",
                'report_id': report_id,
                'employee_id': row.get('employee_id', '').strip(),
                'employee_name': row.get('employee_name', '').strip(),
                'expense_type': expense_type,
                'carrier': row.get('carrier', '').strip(),
                'origin_iata': row.get('origin_iata', '').strip().upper(),
                'dest_iata': row.get('dest_iata', '').strip().upper(),
                'class_of_service': row.get('class_of_service', 'Y').strip().upper(),
                'departure_date': row.get('departure_date', '').strip(),
                'return_date': row.get('return_date', '').strip(),
                'distance_km': row.get('distance_km', '').strip(),
                'pax_count': int(row.get('pax_count', 1) or 1),
                'nights': int(row.get('nights', 0) or 0),
                'property_name': row.get('property_name', '').strip(),
                'city': row.get('city', '').strip(),
                'ground_type': row.get('ground_type', '').strip(),
                'cost': row.get('cost', '0').strip().replace(',', ''),
                'currency': row.get('currency', '').strip(),
                'purpose': row.get('purpose', '').strip(),
            })
        except Exception as e:
            errors.append(f"Row {i+1}: {e}")

    return rows, errors


def normalize_travel_row(row: dict, tenant, batch) -> dict:
    flags = []
    expense_type = row['expense_type']

    # ── AIR ──
    if expense_type == 'AIR':
        origin = row['origin_iata']
        dest = row['dest_iata']

        # Distance: use provided, else lookup, else Haversine
        if row['distance_km'] and row['distance_km'].isdigit():
            distance_km = int(row['distance_km'])
        else:
            distance_km = get_flight_distance(origin, dest)
            if not row['distance_km']:
                flags.append({
                    'code': 'distance_inferred',
                    'detail': f"Distance not provided by GDS. Computed {distance_km}km from IATA lookup / Haversine.",
                    'type': 'auto'
                })

        cos = row.get('class_of_service', 'Y')
        ef_key = CLASS_EF_MAP.get(cos, 'flight_economy')
        ef_data = get_ef(ef_key)
        ef = ef_data['ef']
        pax = row['pax_count']

        # Apply radiative forcing index for non-CO2 warming effects
        kgco2e = (Decimal(str(distance_km)) * ef * Decimal(str(pax)) * FLIGHT_RFI).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )

        # Short-haul flag: under 550km with likely rail alternative
        if distance_km < 550:
            flags.append({
                'code': 'short_haul_flag',
                'detail': f"{origin}-{dest} is {distance_km}km. Rail alternative may exist. Review travel policy.",
                'type': 'auto'
            })

        dep = row['departure_date']
        try:
            activity_date = datetime.strptime(dep, '%Y-%m-%d').date()
        except Exception:
            activity_date = date.today()

        return {
            'source': 'Concur / Navan Travel',
            'source_record_id': row['source_record_id'],
            'scope': 3,
            'ghg_category': 'Business travel — air',
            'activity_date': activity_date,
            'quantity_raw': Decimal(str(distance_km)),
            'unit_raw': 'km',
            'quantity_normalized': Decimal(str(distance_km)),
            'unit_normalized': 'km',
            'emission_factor': ef * FLIGHT_RFI,
            'emission_factor_unit': ef_data['unit'],
            'emission_factor_source': f"{ef_data['source']} + RFI 1.891",
            'kgco2e': kgco2e,
            'raw_metadata': {
                'report_id': row['report_id'], 'employee': row['employee_name'],
                'carrier': row['carrier'], 'origin': origin, 'dest': dest,
                'class_of_service': cos, 'pax_count': pax, 'distance_km': distance_km,
                'cost': row['cost'], 'currency': row['currency'], 'purpose': row['purpose'],
                'rfi_applied': str(FLIGHT_RFI),
            },
            'flags': flags,
            'status': 'flagged' if flags else 'pending',
        }

    # ── HOTEL ──
    elif expense_type == 'HOTEL':
        nights = row['nights'] or 1
        ef_data = get_ef('hotel_night')
        ef = ef_data['ef']
        kgco2e = (ef * Decimal(str(nights))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        check_in = row.get('departure_date', '') or str(date.today())
        try:
            activity_date = datetime.strptime(check_in, '%Y-%m-%d').date()
        except Exception:
            activity_date = date.today()

        return {
            'source': 'Concur / Navan Travel',
            'source_record_id': row['source_record_id'],
            'scope': 3,
            'ghg_category': 'Business travel — hotel',
            'activity_date': activity_date,
            'quantity_raw': Decimal(str(nights)),
            'unit_raw': 'nights',
            'quantity_normalized': Decimal(str(nights)),
            'unit_normalized': 'nights',
            'emission_factor': ef,
            'emission_factor_unit': ef_data['unit'],
            'emission_factor_source': ef_data['source'],
            'kgco2e': kgco2e,
            'raw_metadata': {
                'report_id': row['report_id'], 'employee': row['employee_name'],
                'property': row['property_name'], 'city': row['city'],
                'nights': nights, 'cost': row['cost'], 'currency': row['currency'],
                'note': 'DEFRA average hotel factor used. HCMI property-level data not available.',
            },
            'flags': flags,
            'status': 'pending',
        }

    # ── GROUND ──
    else:
        dist_str = row.get('distance_km', '0')
        distance_km = int(dist_str) if dist_str and str(dist_str).isdigit() else 0
        ef_data = get_ef('ground_car')
        ef = ef_data['ef']
        kgco2e = (ef * Decimal(str(distance_km))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        if not distance_km:
            flags.append({
                'code': 'distance_missing',
                'detail': 'Ground transport distance not provided. kgCO2e = 0 until distance supplied.',
                'type': 'auto'
            })

        dep = row.get('departure_date', '')
        try:
            activity_date = datetime.strptime(dep, '%Y-%m-%d').date()
        except Exception:
            activity_date = date.today()

        return {
            'source': 'Concur / Navan Travel',
            'source_record_id': row['source_record_id'],
            'scope': 3,
            'ghg_category': 'Business travel — ground',
            'activity_date': activity_date,
            'quantity_raw': Decimal(str(distance_km)),
            'unit_raw': 'km',
            'quantity_normalized': Decimal(str(distance_km)),
            'unit_normalized': 'km',
            'emission_factor': ef,
            'emission_factor_unit': ef_data['unit'],
            'emission_factor_source': ef_data['source'],
            'kgco2e': kgco2e,
            'raw_metadata': {
                'report_id': row['report_id'], 'employee': row['employee_name'],
                'ground_type': row['ground_type'], 'distance_km': distance_km,
                'cost': row['cost'], 'currency': row['currency'],
            },
            'flags': flags,
            'status': 'flagged' if flags else 'pending',
        }


# ── Main entry point ────────────────────────────────────────────

def run_ingestion(source_type: str, file_content: str, tenant, user) -> dict:
    """
    Full pipeline: parse → normalize → save to DB → log audit event.
    Returns summary dict.
    """
    batch = IngestionBatch.objects.create(
        tenant=tenant,
        source_type=source_type,
        ingested_by=user,
        status='processing',
    )

    parser_map = {'SAP': parse_sap, 'UTILITY': parse_utility, 'TRAVEL': parse_travel}
    normalizer_map = {'SAP': normalize_sap_row, 'UTILITY': normalize_utility_row, 'TRAVEL': normalize_travel_row}

    parser = parser_map.get(source_type)
    normalizer = normalizer_map.get(source_type)

    if not parser:
        batch.status = 'failed'
        batch.error_log = f"Unknown source type: {source_type}"
        batch.save()
        return {'success': False, 'error': batch.error_log}

    raw_rows, parse_errors = parser(file_content)

    saved = 0
    skipped = 0
    save_errors = []

    for row in raw_rows:
        try:
            kwargs = normalizer(row, tenant, batch)
            kwargs.update({'tenant': tenant, 'batch': batch, 'version': 1})

            # Upsert by source_record_id (re-ingestion creates new version)
            existing = EmissionRecord.objects.filter(
                tenant=tenant,
                source_record_id=kwargs['source_record_id']
            ).order_by('-version').first()

            if existing and existing.status == 'approved':
                # Don't overwrite approved records — create new version
                kwargs['version'] = existing.version + 1
                kwargs['status'] = 'pending'

            if existing and existing.status != 'approved':
                # Overwrite pending/flagged with fresh data
                for k, v in kwargs.items():
                    if k not in ('tenant', 'batch'):
                        setattr(existing, k, v)
                existing.batch = batch
                existing.save()
            else:
                EmissionRecord.objects.create(**kwargs)

            saved += 1
        except Exception as e:
            save_errors.append(str(e))
            skipped += 1

    batch.record_count = saved
    batch.status = 'staged'
    if parse_errors or save_errors:
        batch.error_log = '\n'.join(parse_errors + save_errors)
    batch.save()

    AuditEvent.objects.create(
        tenant=tenant,
        batch=batch,
        actor=user.username if user else 'system',
        action='INGEST',
        payload={
            'source_type': source_type,
            'records_saved': saved,
            'records_skipped': skipped,
            'parse_errors': parse_errors[:10],
            'save_errors': save_errors[:10],
        }
    )

    return {
        'success': True,
        'batch_id': str(batch.id),
        'records_saved': saved,
        'records_skipped': skipped,
        'parse_errors': parse_errors,
        'save_errors': save_errors,
    }
