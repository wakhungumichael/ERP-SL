"""Tenant-aware outbound email helpers."""

import ssl

from django.core.mail import get_connection


def get_tenant_smtp_connection(settings_obj, *, fail_silently=False):
    """Build an SMTP connection using the tenant's selected encryption mode."""
    use_ssl = bool(getattr(settings_obj, "smtp_use_ssl", False))
    # Django forbids enabling implicit SSL and STARTTLS at the same time. SSL
    # wins here as a defensive measure for legacy or externally-written rows.
    use_tls = bool(getattr(settings_obj, "smtp_use_tls", False)) and not use_ssl
    connection = get_connection(
        backend="django.core.mail.backends.smtp.EmailBackend",
        host=settings_obj.smtp_host,
        port=settings_obj.smtp_port or (465 if use_ssl else 587),
        username=settings_obj.smtp_user,
        password=settings_obj.smtp_password,
        use_tls=use_tls,
        use_ssl=use_ssl,
        timeout=20,
        fail_silently=fail_silently,
    )
    if getattr(settings_obj, "smtp_allow_insecure_ssl", False):
        # Some private/cPanel mail hosts use self-signed certificates. This is
        # deliberately opt-in per tenant and should be disabled once the mail
        # server has a publicly trusted certificate.
        insecure_context = ssl.create_default_context()
        insecure_context.check_hostname = False
        insecure_context.verify_mode = ssl.CERT_NONE
        connection.ssl_context = insecure_context
    return connection
