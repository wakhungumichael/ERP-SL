"""
Shared API helpers for Platform_API module views.
"""
from rest_framework.response import Response
from rest_framework import status as http_status


def success_response(message: str, data=None, status: int = 200, **kwargs) -> Response:
    """Return a standard success envelope."""
    payload = {
        "success": True,
        "message": message,
        "status_code": status,
        "data": data if data is not None else {},
    }
    payload.update(kwargs)
    return Response(payload, status=status)


def error_response(message: str, errors=None, status: int = 400, **kwargs) -> Response:
    """Return a standard error envelope."""
    payload = {
        "success": False,
        "message": message,
        "status_code": status,
        "errors": errors or {},
    }
    payload.update(kwargs)
    return Response(payload, status=status)


def request_scope(request) -> dict:
    """Extract tenant / branch scope from request query params or headers."""
    return {
        "tenant_code": request.query_params.get("tenant_code", ""),
        "branch_id": request.query_params.get("branch_id", ""),
        "user_id": getattr(request.user, "id", None),
        "username": getattr(request.user, "username", ""),
    }
