from rest_framework import serializers
from .models import EmissionRecord, IngestionBatch, AuditEvent, Tenant


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = ['id', 'name', 'sector', 'created_at']


class IngestionBatchSerializer(serializers.ModelSerializer):
    ingested_by_username = serializers.CharField(source='ingested_by.username', read_only=True)

    class Meta:
        model = IngestionBatch
        fields = ['id', 'source_type', 'ingested_at', 'ingested_by_username',
                  'raw_filename', 'record_count', 'status', 'error_log']


class EmissionRecordSerializer(serializers.ModelSerializer):
    batch_source = serializers.CharField(source='batch.source_type', read_only=True)

    class Meta:
        model = EmissionRecord
        fields = [
            'id', 'source', 'source_record_id', 'scope', 'ghg_category',
            'activity_date', 'quantity_raw', 'unit_raw',
            'quantity_normalized', 'unit_normalized',
            'emission_factor', 'emission_factor_unit', 'emission_factor_source',
            'kgco2e', 'raw_metadata', 'flags', 'status',
            'approved_by', 'approved_at', 'version',
            'created_at', 'updated_at', 'batch_source',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'approved_by', 'approved_at', 'batch_source']


class AuditEventSerializer(serializers.ModelSerializer):
    record_id = serializers.UUIDField(source='record.id', read_only=True, allow_null=True)
    batch_id = serializers.UUIDField(source='batch.id', read_only=True, allow_null=True)

    class Meta:
        model = AuditEvent
        fields = ['id', 'record_id', 'batch_id', 'actor', 'action', 'payload', 'ts']


class DashboardStatsSerializer(serializers.Serializer):
    total_kgco2e = serializers.DecimalField(max_digits=18, decimal_places=2)
    scope_breakdown = serializers.DictField()
    source_breakdown = serializers.DictField()
    status_counts = serializers.DictField()
    total_records = serializers.IntegerField()
