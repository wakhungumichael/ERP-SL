---
name: Django startup blockers and dependency quirks
description: Non-obvious import issues that prevent Django from starting in this Replit environment
---

## weasyprint
`SL_Weighbridge/utils.py` line ~414 has `from weasyprint import HTML` at module scope.
weasyprint requires system-level Cairo/Pango libs not available on Replit.
**Fix:** Wrapped in try/except — `WeasyHTML = None` on import failure. The `generate_invoice_pdf()` function raises RuntimeError if called without weasyprint.
**Do not remove** the try/except wrapper or Django admin autodiscovery will crash.

## pyserial
`SL_Weighbridge/utils.py` imports `serial` (pyserial) 5 times at top level.
pyserial IS installed in .pythonlibs. On Replit there's no real serial port; the functions that open a port will fail at runtime (which is acceptable).

## Platform_API stubs
Files NOT committed in the original GitLab repo that must exist for Django to start:
- `backend/Platform_API/__init__.py`
- `backend/Platform_API/modules/__init__.py`
- `backend/Platform_API/modules/api.py` — provides error_response, success_response, request_scope
- `backend/Platform_API/modules/mixins.py` — provides ModuleAPIViewMixin, TenantScopedQuerysetMixin
- `backend/Platform_API/modules/platform/__init__.py`
- `backend/Platform_Core/__init__.py`
- `backend/Platform_Core/integrations.py` — stub for build_integration_health_snapshot, indicator_source_registry; uses IntegrationEndpoint model (NOT "Integration")

## Installed packages
All installed globally via Replit package manager into .pythonlibs. Key packages beyond standard Django stack: pyserial, requests, channels, humanize, phonenumbers, django-phonenumber-field, tablib, django-import-export, numpy, pandas, social-auth-app-django, django-allauth, django-guardian, xhtml2pdf, svglib, lxml, pypdf.
