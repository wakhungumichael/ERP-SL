from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.shortcuts import redirect
from django.urls import include, path


def healthz(request):
    return JsonResponse({"status": "ok"})


def frontend_login_redirect(request, tenant_code=None):
    login_path = f"/login/{tenant_code}" if tenant_code else "/login"
    frontend_url = settings.ERP_FRONTEND_URL.rstrip("/")
    if not frontend_url and request.get_host().split(":", 1)[0] in {"localhost", "127.0.0.1"}:
        frontend_url = "http://localhost:5173"
    if not frontend_url:
        return JsonResponse(
            {"error": "ERP_FRONTEND_URL must be configured for browser login links."},
            status=503,
        )
    return redirect(f"{frontend_url}{login_path}")


urlpatterns = [
    # Health check (proxied at /api/healthz)
    path("api/healthz", healthz, name="healthz"),
    # Platform module API
    path("api/platform/", include("Platform_API.modules.platform.urls")),
    # Commercial Weighbridge API
    path("api/commercial-weighbridge/", include("Platform_API.modules.weighbridge.urls")),
    # Payments API
    path("api/payments/", include("Platform_API.modules.payments.urls")),
    # Accounting API
    path("api/accounting/", include("Platform_API.modules.accounting.urls")),
    # Sales API (Estimates, Products & Services, Recurring Invoices)
    path("api/sales/", include("Platform_API.modules.sales.urls")),
    # Purchases API (Bills, Vendors)
    path("api/purchases/", include("Platform_API.modules.purchases.urls")),
    # CRM API
    path("api/crm/", include("Platform_API.modules.crm.urls")),
    # HR API
    path("api/hr/", include("Platform_API.modules.hr.urls")),
    # Procurement API
    path("api/procurement/", include("Platform_API.modules.procurement.urls")),
    # Budgeting API
    path("api/budgeting/", include("Platform_API.modules.budgeting.urls")),
    # Inventory API
    path("api/inventory/", include("Platform_API.modules.inventory.urls")),
    # Ticketing API
    path("api/ticketing/", include("Platform_API.modules.ticketing.urls")),
    # Django admin (accessible at /admin/)
    path("admin/", admin.site.urls),
]

# Makes older invitation links that pointed at the API host recoverable.
urlpatterns += [
    path("login/<slug:tenant_code>", frontend_login_redirect, name="frontend-tenant-login-redirect"),
    path("login", frontend_login_redirect, name="frontend-login-redirect"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Admin customisation
admin.site.site_header = "SL-ERP Administration"
admin.site.site_title = "SL-ERP"
admin.site.index_title = "Platform Administration"
