from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('records', views.EmissionRecordViewSet, basename='records')
router.register('batches', views.BatchViewSet, basename='batches')
router.register('audit', views.AuditEventViewSet, basename='audit')

urlpatterns = [
    path('auth/login/', views.login_view),
    path('auth/logout/', views.logout_view),
    path('auth/me/', views.me_view),
    path('dashboard/', views.dashboard_stats),
    path('ingest/', views.ingest_file),
    path('', include(router.urls)),
]
