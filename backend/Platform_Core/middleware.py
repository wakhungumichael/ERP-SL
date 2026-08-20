from .audit import clear_audit_request, log_access_event, set_audit_request


class AuditRequestMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        set_audit_request(request)
        try:
            response = self.get_response(request)
            user = getattr(request, "user", None)
            should_log = request.method in {"GET", "POST", "PUT", "PATCH", "DELETE"}
            if should_log:
                is_authenticated = getattr(user, "is_authenticated", False)
                if request.method == "GET":
                    event_type = "view" if is_authenticated else "guest_view"
                else:
                    event_type = "request" if is_authenticated else "guest_request"
                log_access_event(request=request, response=response, user=user, event_type=event_type)
            return response
        finally:
            clear_audit_request()
