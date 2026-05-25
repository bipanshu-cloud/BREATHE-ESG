"""
seed_data — loads realistic sample data and creates demo users.
Run: python manage.py seed_data
"""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone
from emissions.models import Tenant, PlantLookup, IATADistance, EmissionFactorRef
from emissions.ingestion import run_ingestion


SAP_SAMPLE = """EBELN|EBELP|LIFNR|WERKS|MATNR|MAKTX|MENGE|MEINS|NETPR|WAERS|BEDAT|BUKRS|KOSTL
4500012301|00010|0001003456|DE01|MAT-DIESEL-001|Dieselkraftstoff B7|12500|L|1.48|EUR|20231115|1000|CC-LOGISTICS-01
4500012302|00010|0001007821|UK03|MAT-PETROL-001|Unleaded Petrol 95|8400|L|1.62|GBP|20231118|2000|CC-FLEET-UK
4500012303|00020|0001009234|DE01|MAT-GASÖL-003|Heizöl EL schwefelfrei|45.2|T|1180.00|EUR|20231201|1000|CC-FACILITIES-DE
4500012304|00010|0001002100|PL02|MAT-NG-005|Erdgas H-Gas|18700|M3|0.089|EUR|20231130|3000|CC-PRODUCTION-PL
4500012305|00010|0001005544|UK03|MAT-DIESEL-001|Diesel Fuel|3100|L|1.55|GBP|20231205|2000|CC-FLEET-UK
4500012306|00010|0001011200|DE02|MAT-LPG-002|Fluessiggas LPG|2800|KG|0.94|EUR|20231210|1000|CC-WAREHOUSE-DE"""

UTILITY_SAMPLE = """MPAN,meter_serial,site_name,billing_ref,billing_period_start,billing_period_end,tariff_code,total_kwh,peak_kwh,offpeak_kwh,grid_region,currency,total_cost
1012345678901,E1A02944421,"Hamburg Warehouse DE01",INV-2023-11-001,2023-11-01,2023-11-30,HH-MAX-DEMAND,142800,89340,53460,DE-TransnetBW,EUR,21420.00
2098765432100,E2B09911200,"UK Office London",INV-2023-11-002,2023-10-18,2023-11-17,SME-FLEX-GREEN,28400,19200,9200,GB-National,GBP,7100.00
3011223344550,E3C04412800,"Poznan Factory PL02",INV-2023-11-003,2023-11-01,2023-11-30,INDUSTRIAL-G11,318600,201200,117400,PL-PSE,PLN,198000.00
1012345678901,E1A02944421,"Hamburg Warehouse DE01",INV-2023-12-001,2023-12-01,2023-12-31,HH-MAX-DEMAND,158200,98100,60100,DE-TransnetBW,EUR,23730.00"""

TRAVEL_SAMPLE = """report_id,employee_id,employee_name,expense_type,carrier,origin_iata,dest_iata,class_of_service,departure_date,return_date,distance_km,pax_count,nights,property_name,city,ground_type,cost,currency,purpose,line_num
RPT-2023-11-4421,EMP-DE-00441,Thomas Bauer,AIR,LH,HAM,LHR,Y,2023-11-08,2023-11-10,,1,,,,, 412.00,EUR,Client meeting,1
RPT-2023-11-4422,EMP-UK-00108,Sarah Mitchell,AIR,BA,LHR,JFK,J,2023-11-14,2023-11-18,,1,,,,,4210.00,GBP,Board presentation,1
RPT-2023-11-4423,EMP-PL-00022,Anna Kowalska,HOTEL,,,,, 2023-11-20,2023-11-22,,1,2,Marriott Warsaw,Warsaw,,,380.00,PLN,Internal conference,1
RPT-2023-11-4424,EMP-UK-00108,Sarah Mitchell,HOTEL,,,,, 2023-11-14,2023-11-18,,1,4,The Pierre New York,New York,,,3200.00,USD,Board presentation,2
RPT-2023-11-4425,EMP-DE-00441,Thomas Bauer,GROUND,,,,,2023-11-09,,,1,,,,RENTAL_CAR,180,220.00,GBP,Client visits,1
RPT-2023-12-4500,EMP-UK-00222,James Osei,AIR,KL,LHR,AMS,Y,2023-12-05,2023-12-06,,1,,,,,189.00,GBP,Partner meeting,1
RPT-2023-12-4501,EMP-DE-00552,Petra Hoffmann,AIR,EW,DUS,MUC,Y,2023-12-12,2023-12-12,,1,,,,, 98.00,EUR,Internal meeting,1"""


class Command(BaseCommand):
    help = 'Seed database with demo users, lookup tables, and sample emission records'

    def handle(self, *args, **kwargs):
        self.stdout.write('Seeding database...')

        # Create demo users
        analyst, _ = User.objects.get_or_create(username='analyst')
        analyst.set_password('breathe123')
        analyst.email = 'analyst@meridian.com'
        analyst.save()

        admin_user, _ = User.objects.get_or_create(username='admin')
        admin_user.set_password('breathe123')
        admin_user.is_staff = True
        admin_user.is_superuser = True
        admin_user.save()

        self.stdout.write('  ✓ Users created (analyst / breathe123)')

        # Tenant
        tenant, _ = Tenant.objects.get_or_create(
            name='analyst Organisation',
            defaults={'sector': 'Manufacturing'}
        )
        self.stdout.write('  ✓ Tenant created')

        # Plant lookup table
        plants = [
            ('DE01', '1000', 'DE', 'Hamburg Logistics Centre'),
            ('DE02', '1000', 'DE', 'Frankfurt Warehouse'),
            ('UK03', '2000', 'GB', 'London Fleet Depot'),
            ('PL02', '3000', 'PL', 'Poznan Production Plant'),
        ]
        for code, bukrs, country, name in plants:
            PlantLookup.objects.get_or_create(
                plant_code=code,
                defaults={'company_code': bukrs, 'country_code': country, 'site_name': name}
            )
        self.stdout.write('  ✓ Plant lookup table seeded')

        # IATA distances
        iata_pairs = [
            ('HAM', 'LHR', 730), ('LHR', 'JFK', 5540),
            ('LHR', 'AMS', 357), ('DUS', 'MUC', 465),
            ('LHR', 'CDG', 344), ('FRA', 'LHR', 639),
        ]
        for o, d, km in iata_pairs:
            IATADistance.objects.get_or_create(origin=o, destination=d, defaults={'distance_km': km})
            IATADistance.objects.get_or_create(origin=d, destination=o, defaults={'distance_km': km})
        self.stdout.write('  ✓ IATA distances seeded')

        # Ingest sample data
        for label, src, data in [
            ('SAP', 'SAP', SAP_SAMPLE),
            ('Utility', 'UTILITY', UTILITY_SAMPLE),
            ('Travel', 'TRAVEL', TRAVEL_SAMPLE),
        ]:
            result = run_ingestion(src, data, tenant, analyst)
            self.stdout.write(f'  ✓ {label}: {result["records_saved"]} records ingested')
            if result.get('parse_errors'):
                for e in result['parse_errors'][:3]:
                    self.stdout.write(f'    ⚠ {e}')

        self.stdout.write(self.style.SUCCESS('\n✅ Seed complete. Login: analyst / breathe123'))
