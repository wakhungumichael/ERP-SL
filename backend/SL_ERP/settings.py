"""
Django settings for SL_ERP project — Replit-adapted.
"""
import importlib.util
import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def env_list(name, default):
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def env_bool(name, default=False):
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name, default):
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return int(raw_value)


SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "django-insecure-replit-sl-erp-change-in-production",
)

DEBUG = env_bool("DEBUG", default=True)

ALLOWED_HOSTS = ["*"]

CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", [
    "https://*.replit.dev",
    "https://*.replit.app",
    "https://*.repl.co",
    "http://localhost:8000",
    "http://localhost:5173",
])

INSTALLED_APPS = [
    "unfold",
    "unfold.contrib.filters",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "Platform_Core",
    "Platform_API",
    "SL_Weighbridge",
    "SL_HR",
    "SL_Procurement",
    "SL_CRM",
    "rest_framework",
    "rest_framework.authtoken",
    "django_filters",
    "corsheaders",
    "django_extensions",
]

# Conditionally add rangefilter if available
try:
    import rangefilter
    INSTALLED_APPS.append("rangefilter")
except ImportError:
    pass

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "SL_ERP.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "SL_ERP.wsgi.application"

# ── Database ──────────────────────────────────────────────────────────────────
# Uses DATABASE_URL from Replit environment if available
_database_url = os.getenv("DATABASE_URL")
if _database_url:
    DATABASES = {
        "default": dj_database_url.parse(_database_url, conn_max_age=600)
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": os.getenv("DB_ENGINE", "django.db.backends.postgresql"),
            "NAME": os.getenv("DB_NAME", "sl_erp"),
            "USER": os.getenv("DB_USER", "slabs"),
            "PASSWORD": os.getenv("DB_PASSWORD", "slabs321"),
            "HOST": os.getenv("DB_HOST", "localhost"),
            "PORT": os.getenv("DB_PORT", "5432"),
        }
    }

# ── Password validation ───────────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ── Internationalization ──────────────────────────────────────────────────────
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Nairobi"
USE_I18N = True
USE_TZ = True

# ── Static & media files ──────────────────────────────────────────────────────
STATIC_URL = "/django-static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── REST Framework ────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
        "rest_framework.authentication.TokenAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": env_int("API_PAGE_SIZE", 50),
}

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

# ── Indicator / weighbridge hardware settings ─────────────────────────────────
INDICATOR_API_BASE_URL = os.getenv(
    'INDICATOR_API_BASE_URL',
    'https://ws.metrixws.co.ke',
)
INDICATOR_API_ID = os.getenv('INDICATOR_API_ID', '1')
INDICATOR_REQUEST_TIMEOUT = env_int('INDICATOR_REQUEST_TIMEOUT', 5)
INDICATOR_STABLE_WEIGHT_URL = os.getenv(
    'INDICATOR_STABLE_WEIGHT_URL',
    f"{INDICATOR_API_BASE_URL.rstrip('/')}/live_weight",
)
INDICATOR_LIVE_WEIGHT_URL = os.getenv(
    'INDICATOR_LIVE_WEIGHT_URL',
    f"{INDICATOR_API_BASE_URL.rstrip('/')}/live_weight",
)
INDICATOR_LIVE_WEIGHT_STREAM_URL = os.getenv(
    'INDICATOR_LIVE_WEIGHT_STREAM_URL',
    f"{INDICATOR_API_BASE_URL.rstrip('/')}/api/indicators/{INDICATOR_API_ID}/live_weight_stream/",
)

# ── Platform settings ─────────────────────────────────────────────────────────
PLATFORM_NAME = os.getenv("PLATFORM_NAME", "SL-ERP Platform")
PLATFORM_CODE = os.getenv("PLATFORM_CODE", "sl-erp")
DEFAULT_TENANT_CODE = os.getenv("DEFAULT_TENANT_CODE", "default")
ENABLED_PLATFORM_MODULES = env_list(
    "ENABLED_PLATFORM_MODULES",
    ["core", "users", "commercial-weighbridge", "payments", "accounting"],
)

# ── Email ─────────────────────────────────────────────────────────────────────
# Prints emails to the console in development.
# Override EMAIL_BACKEND, EMAIL_HOST, EMAIL_PORT, etc. in production via env vars.
EMAIL_BACKEND    = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST       = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT       = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_USE_TLS    = os.environ.get("EMAIL_USE_TLS", "True") == "True"
EMAIL_HOST_USER  = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@sl-erp.com")

# ── Logging ───────────────────────────────────────────────────────────────────
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
