import uuid
from django.db import models
from django.contrib.auth.models import User


class Tenant(models.Model):
    """Multi-tenant isolation. Every EmissionRecord belongs to a tenant."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    sector = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class IngestionBatch(models.Model):
    """Tracks a single file/API ingestion event."""
    SOURCE_TYPES = [
        ('SAP', 'SAP IDoc / Flat File'),
        ('UTILITY', 'Utility Portal CSV'),
        ('TRAVEL', 'Concur / Navan Travel'),
    ]
    STATUS_CHOICES = [
        ('processing', 'Processing'),
        ('staged', 'Staged for Review'),
        ('failed', 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='batches')
    source_type = models.CharField(max_length=20, choices=SOURCE_TYPES)
    ingested_at = models.DateTimeField(auto_now_add=True)
    ingested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    raw_filename = models.CharField(max_length=255, blank=True)
    record_count = models.IntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='processing')
    error_log = models.TextField(blank=True)

    def __str__(self):
        return f"{self.source_type} batch {self.id} ({self.ingested_at.date()})"


class EmissionRecord(models.Model):
    """
    Core emissions row. Immutable once approved — edits create new versions.
    Covers Scope 1 (SAP fuel), Scope 2 (utility electricity), Scope 3 (travel).
    """
    SCOPE_CHOICES = [(1, 'Scope 1'), (2, 'Scope 2'), (3, 'Scope 3')]
    STATUS_CHOICES = [
        ('pending', 'Pending Review'),
        ('flagged', 'Flagged'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='records')
    batch = models.ForeignKey(IngestionBatch, on_delete=models.CASCADE, related_name='records')

    # Source identity
    source = models.CharField(max_length=100)          # "SAP IDoc", "Utility Portal CSV", "Concur API v4"
    source_record_id = models.CharField(max_length=200) # natural key from upstream (EBELN+EBELP, MPAN+billing_ref)

    # GHG classification
    scope = models.SmallIntegerField(choices=SCOPE_CHOICES)
    ghg_category = models.CharField(max_length=200)     # GHG Protocol category label

    # Activity data
    activity_date = models.DateField()
    quantity_raw = models.DecimalField(max_digits=18, decimal_places=4)
    unit_raw = models.CharField(max_length=20)          # as received from source
    quantity_normalized = models.DecimalField(max_digits=18, decimal_places=4)
    unit_normalized = models.CharField(max_length=20)   # canonical unit post-conversion

    # Emission calculation
    emission_factor = models.DecimalField(max_digits=12, decimal_places=6)
    emission_factor_unit = models.CharField(max_length=50, default='kgCO2e/unit')
    emission_factor_source = models.CharField(max_length=100)  # "DEFRA 2023", "UBA 2023"
    kgco2e = models.DecimalField(max_digits=18, decimal_places=4)

    # Source-specific metadata (stored as JSON for flexibility)
    raw_metadata = models.JSONField(default=dict)       # original row fields preserved
    flags = models.JSONField(default=list)              # [{code, detail, type: auto|manual}]

    # Workflow
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    approved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name='approved_records'
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    # Audit immutability — edits create new version rows
    version = models.IntegerField(default=1)
    superseded_by = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='previous_versions'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        # Unique per source record per version — allows re-ingestion as new version
        unique_together = [('tenant', 'source_record_id', 'version')]

    def __str__(self):
        return f"{self.source} | {self.source_record_id} | {self.kgco2e} kgCO2e"


class AuditEvent(models.Model):
    """Immutable audit log. Never updated, only appended."""
    ACTION_CHOICES = [
        ('INGEST', 'Ingest'),
        ('APPROVE', 'Approve'),
        ('REJECT', 'Reject'),
        ('FLAG', 'Flag'),
        ('UNFLAG', 'Unflag'),
        ('EDIT', 'Edit'),
        ('EXPORT', 'Export'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='audit_events')
    record = models.ForeignKey(EmissionRecord, on_delete=models.SET_NULL, null=True, blank=True)
    batch = models.ForeignKey(IngestionBatch, on_delete=models.SET_NULL, null=True, blank=True)
    actor = models.CharField(max_length=200)            # username or "system"
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    payload = models.JSONField(default=dict)            # before/after for edits
    ts = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-ts']

    def __str__(self):
        return f"{self.action} by {self.actor} at {self.ts}"


# ── Reference / lookup tables ───────────────────────────────────

class PlantLookup(models.Model):
    """SAP plant code → country/site mapping. Seeded at client onboarding."""
    plant_code = models.CharField(max_length=10, unique=True)  # e.g. DE01
    company_code = models.CharField(max_length=10)
    country_code = models.CharField(max_length=3)
    site_name = models.CharField(max_length=200)

    def __str__(self):
        return f"{self.plant_code} — {self.site_name}"


class EmissionFactorRef(models.Model):
    """Versioned emission factors. Year-matched at ingestion time."""
    fuel_type = models.CharField(max_length=100)
    region = models.CharField(max_length=100)           # "UK", "DE", "PL", "global"
    year = models.IntegerField()
    ef_value = models.DecimalField(max_digits=12, decimal_places=6)
    unit = models.CharField(max_length=50)              # e.g. "kgCO2e/litre"
    source = models.CharField(max_length=100)           # "DEFRA 2023", "UBA 2023"

    class Meta:
        unique_together = [('fuel_type', 'region', 'year')]

    def __str__(self):
        return f"{self.fuel_type} {self.region} {self.year}: {self.ef_value}"


class IATADistance(models.Model):
    """Great-circle distances between airport pairs for travel emissions."""
    origin = models.CharField(max_length=3)
    destination = models.CharField(max_length=3)
    distance_km = models.IntegerField()

    class Meta:
        unique_together = [('origin', 'destination')]

    def __str__(self):
        return f"{self.origin}-{self.destination}: {self.distance_km}km"
