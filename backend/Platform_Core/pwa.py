"""Public, versioned installed-app branding. Organization cookies never grant access."""
import hashlib
import mimetypes
from io import BytesIO
from pathlib import PurePosixPath
from urllib.parse import urlencode, urlparse

from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps


APP_TENANT_COOKIE = "sl-erp-app-tenant"
ICON_SIZES = {64, 180, 192, 512}


def app_name(tenant, profile):
    return (
        getattr(profile, "workspace_name", "")
        or getattr(profile, "platform_name", "")
        or getattr(tenant, "name", "")
        or "Business Workspace"
    )


def icon_version(tenant, profile):
    source = "|".join(str(value or "") for value in (
        getattr(tenant, "code", ""), profile.pk, profile.updated_at,
        getattr(profile, "logo_file", ""), getattr(profile, "logo_url", ""),
        getattr(profile, "primary_color", ""), app_name(tenant, profile),
    ))
    return hashlib.sha256(source.encode()).hexdigest()[:16]


def direct_icon(profile):
    # SVGs remain vector icons. Remote logos are referenced by the browser;
    # the server must never fetch arbitrary URLs supplied in branding settings.
    logo_file = getattr(profile, "logo_file", None)
    if logo_file:
        if PurePosixPath(logo_file.name).suffix.lower() == ".svg":
            return logo_file.url
        return ""
    return getattr(profile, "logo_url", "") or ""


def app_icon_url(tenant, profile, size=192):
    direct = direct_icon(profile)
    if direct:
        return direct
    query = urlencode({
        "tenant_code": getattr(tenant, "code", "") or "",
        "size": size,
        "v": icon_version(tenant, profile),
    })
    return f"/api/platform/public/app-icon/?{query}"


def manifest_icons(tenant, profile):
    direct = direct_icon(profile)
    if direct:
        mime = mimetypes.guess_type(urlparse(direct).path)[0]
        icon = {"src": direct, "purpose": "any"}
        if mime:
            icon["type"] = mime
        if mime == "image/svg+xml":
            icon["sizes"] = "any"
        return [icon]
    return [
        {"src": app_icon_url(tenant, profile, size), "sizes": f"{size}x{size}",
         "type": "image/png", "purpose": "any"}
        for size in (192, 512)
    ]


def app_icon_bytes(tenant, profile, size):
    canvas = Image.new("RGBA", (size, size), "white")
    logo_file = getattr(profile, "logo_file", None)
    try:
        if not logo_file:
            raise ValueError("No uploaded logo")
        with logo_file.open("rb") as source, Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert("RGBA")
            image = ImageOps.contain(image, (int(size * .8), int(size * .8)), Image.Resampling.LANCZOS)
            canvas.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
    except (OSError, ValueError):
        try:
            color = ImageColor.getrgb(getattr(profile, "primary_color", "") or "#e85d26")
        except ValueError:
            color = (232, 93, 38)
        canvas = Image.new("RGBA", (size, size), color)
        initials = "".join(part[0] for part in app_name(tenant, profile).split()[:2]).upper() or "SL"
        foreground = "black" if sum(a * b for a, b in zip(color[:3], (.299, .587, .114))) > 160 else "white"
        # Pillow 9 (the Docker runtime) has no size argument on load_default.
        # Render its built-in font into a transparent tile, then size the tile.
        font = ImageFont.load_default()
        bounds = ImageDraw.Draw(canvas).textbbox((0, 0), initials, font=font)
        tile = Image.new("RGBA", (max(1, bounds[2] - bounds[0]), max(1, bounds[3] - bounds[1])))
        ImageDraw.Draw(tile).text((-bounds[0], -bounds[1]), initials, font=font, fill=foreground)
        tile = ImageOps.contain(tile, (max(1, int(size * .6)), max(1, int(size * .5))), Image.Resampling.LANCZOS)
        canvas.alpha_composite(tile, ((size - tile.width) // 2, (size - tile.height) // 2))
    output = BytesIO()
    canvas.convert("RGB").save(output, format="PNG")
    return output.getvalue()
