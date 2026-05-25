from django.contrib.auth import authenticate, login, logout
from django.db.models import Sum, Count, Q
from django.utils import timezone
from rest_framework import viewsets, status, generics
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.authtoken.models import Token

from .models import EmissionRecord, IngestionBatch, AuditEvent, Tenant
from .serializers import (
    EmissionRecordSerializer, IngestionBatchSerializer,
    AuditEventSerializer, TenantSerializer
)
from .ingestion import run_ingestion


# ── Auth ────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')
    user = authenticate(username=username, password=password)
    if user:
        token, _ = Token.objects.get_or_create(user=user)
        return Response({
            'token': token.key,
            'username': user.username,
            'email': user.email,
        })
    return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
def logout_view(request):
    request.user.auth_token.delete()
    return Response({'status': 'logged out'})


@api_view(['GET'])
def me_view(request):
    return Response({
        'username': request.user.username,
        'email': request.user.email,
        'tenant': _get_tenant(request.user).name if _get_tenant(request.user) else None,
    })


def _get_tenant(user):
    """Get or create a tenant for this user. Case-insensitive lookup."""
    name = f"{user.username} Organisation"
    try:
        return Tenant.objects.get(name__iexact=name)
    except Tenant.DoesNotExist:
        tenant, _ = Tenant.objects.get_or_create(
            name=name,
            defaults={'sector': 'Manufacturing'}
        )
        return tenant


# ── Dashboard ────────────────────────────────────────────────────

@api_view(['GET'])
def dashboard_stats(request):
    tenant = _get_tenant(request.user)
    qs = EmissionRecord.objects.filter(tenant=tenant, superseded_by__isnull=True)

    total = qs.aggregate(total=Sum('kgco2e'))['total'] or 0

    scope_agg = qs.values('scope').annotate(total=Sum('kgco2e'))
    scope_breakdown = {str(r['scope']): float(r['total'] or 0) for r in scope_agg}

    source_agg = qs.values('source').annotate(total=Sum('kgco2e'))
    source_breakdown = {r['source']: float(r['total'] or 0) for r in source_agg}

    status_counts = {
        s: qs.filter(status=s).count()
        for s in ('pending', 'flagged', 'approved', 'rejected')
    }

    return Response({
        'total_kgco2e': float(total),
        'scope_breakdown': scope_breakdown,
        'source_breakdown': source_breakdown,
        'status_counts': status_counts,
        'total_records': qs.count(),
    })


# ── Ingest ────────────────────────────────────────────────────────

@api_view(['POST'])
def ingest_file(request):
    """
    POST /api/ingest/
    Form data: source_type (SAP|UTILITY|TRAVEL), file or raw_data
    """
    source_type = request.data.get('source_type', '').upper()
    if source_type not in ('SAP', 'UTILITY', 'TRAVEL'):
        return Response({'error': 'source_type must be SAP, UTILITY, or TRAVEL'},
                        status=status.HTTP_400_BAD_REQUEST)

    # Accept file upload or raw text paste
    uploaded_file = request.FILES.get('file')
    raw_data = request.data.get('raw_data', '')

    if uploaded_file:
        try:
            file_content = uploaded_file.read().decode('utf-8', errors='replace')
        except Exception as e:
            return Response({'error': f'Cannot read file: {e}'}, status=status.HTTP_400_BAD_REQUEST)
    elif raw_data:
        file_content = raw_data
    else:
        return Response({'error': 'Provide either file or raw_data'}, status=status.HTTP_400_BAD_REQUEST)

    tenant = _get_tenant(request.user)
    result = run_ingestion(source_type, file_content, tenant, request.user)

    if result['success']:
        return Response(result, status=status.HTTP_201_CREATED)
    return Response(result, status=status.HTTP_400_BAD_REQUEST)


# ── Records ────────────────────────────────────────────────────────

class EmissionRecordViewSet(viewsets.ModelViewSet):
    serializer_class = EmissionRecordSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        tenant = _get_tenant(self.request.user)
        qs = EmissionRecord.objects.filter(tenant=tenant, superseded_by__isnull=True)

        # Filters
        scope = self.request.query_params.get('scope')
        source = self.request.query_params.get('source')
        rec_status = self.request.query_params.get('status')
        search = self.request.query_params.get('search')

        if scope:
            qs = qs.filter(scope=scope)
        if source:
            qs = qs.filter(source__icontains=source)
        if rec_status:
            qs = qs.filter(status=rec_status)
        if search:
            qs = qs.filter(
                Q(source_record_id__icontains=search) |
                Q(ghg_category__icontains=search) |
                Q(source__icontains=search)
            )
        return qs

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        record = self.get_object()
        if record.status == 'approved':
            return Response({'error': 'Already approved'}, status=status.HTTP_400_BAD_REQUEST)

        record.status = 'approved'
        record.approved_by = request.user
        record.approved_at = timezone.now()
        record.save()

        AuditEvent.objects.create(
            tenant=record.tenant,
            record=record,
            actor=request.user.username,
            action='APPROVE',
            payload={'record_id': str(record.id), 'kgco2e': str(record.kgco2e)}
        )
        return Response(EmissionRecordSerializer(record).data)

    @action(detail=True, methods=['post'])
    def flag(self, request, pk=None):
        record = self.get_object()
        reason = request.data.get('reason', 'Manually flagged by analyst')

        if not isinstance(record.flags, list):
            record.flags = []
        record.flags.append({'code': 'manual_flag', 'detail': reason, 'type': 'manual'})
        record.status = 'flagged'
        record.save()

        AuditEvent.objects.create(
            tenant=record.tenant,
            record=record,
            actor=request.user.username,
            action='FLAG',
            payload={'reason': reason}
        )
        return Response(EmissionRecordSerializer(record).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        record = self.get_object()
        record.status = 'rejected'
        record.save()
        AuditEvent.objects.create(
            tenant=record.tenant, record=record,
            actor=request.user.username, action='REJECT',
            payload={'record_id': str(record.id)}
        )
        return Response(EmissionRecordSerializer(record).data)


# ── Batches ────────────────────────────────────────────────────────

class BatchViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = IngestionBatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tenant = _get_tenant(self.request.user)
        return IngestionBatch.objects.filter(tenant=tenant)


# ── Audit ────────────────────────────────────────────────────────

class AuditEventViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tenant = _get_tenant(self.request.user)
        return AuditEvent.objects.filter(tenant=tenant)
