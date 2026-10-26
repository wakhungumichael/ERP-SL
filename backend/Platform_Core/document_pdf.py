# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""PDF output for the same tenant-selected HTML used by document previews."""
import re
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.conf import settings
from django.http import HttpResponse
from django.utils.http import content_disposition_header
from xhtml2pdf import pisa


def document_asset(uri, _relative=None):
    parsed = urlparse(uri)
    path = unquote(parsed.path)
    for base_url, root in ((settings.MEDIA_URL, settings.MEDIA_ROOT), (settings.STATIC_URL, settings.STATIC_ROOT)):
        prefix = urlparse(str(base_url or "")).path
        if prefix and root and path.startswith(prefix):
            base = Path(root).resolve()
            asset = (base / path.removeprefix(prefix)).resolve()
            if asset.is_relative_to(base) and asset.is_file():
                return str(asset)
            raise ValueError("Document image could not be found in uploaded media.")
    if parsed.scheme in {"https", "http", "data"}:
        return uri
    # Templates may refer to uploaded media, never arbitrary server files.
    raise ValueError("Document images must use uploaded media or an HTTP image URL.")


def document_pdf_bytes(html):
    # xhtml2pdf does not support CSS custom properties. Resolve these in older
    # and custom tenant layouts before handing the document to the PDF engine.
    variables = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;{}]+);", html))
    html = re.sub(r":root\s*\{[^}]*\}", "", html)
    html = re.sub(
        r"var\((--[\w-]+)(?:,\s*([^()]+))?\)",
        lambda match: variables.get(match[1], match[2] or "#000000"),
        html,
    )
    html = re.sub(r"color-mix\([^)]*\)", "#f1f5f9", html)
    output = BytesIO()
    result = pisa.CreatePDF(html, dest=output, encoding="utf-8", link_callback=document_asset)
    if result.err:
        raise ValueError("Unable to generate this document PDF.")
    return output.getvalue()


def document_pdf_response(rendered, filename, *, attachment=True):
    response = HttpResponse(document_pdf_bytes(rendered.html), content_type="application/pdf")
    response["Content-Disposition"] = content_disposition_header(attachment, filename)
    return response


def wants_document_pdf(request):
    return request.query_params.get("download", "").lower() in {"1", "true", "yes", "pdf"} or request.query_params.get("format") == "pdf"
