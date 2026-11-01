"""Bounded, local document previews. Never execute or upload document contents."""
from io import BytesIO
from pathlib import PurePath
from zipfile import BadZipFile, ZipFile
from xml.etree import ElementTree
import re

from django.http import FileResponse, JsonResponse
from rest_framework.exceptions import ValidationError


def document_preview(record):
    name = record.original_name or PurePath(record.file.name).name
    extension = PurePath(name).suffix.lower()
    try:
        with record.file.open("rb") as stream:
            data = stream.read(10 * 1024 * 1024 + 1)
    except OSError:
        raise ValidationError("The stored file is unavailable. Ask an administrator to restore it.")
    if len(data) > 10 * 1024 * 1024:
        raise ValidationError("This file is too large to preview.")
    mime = None
    if data.startswith(b"%PDF-"):
        mime = "application/pdf"
    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif data.startswith((b"GIF87a", b"GIF89a")):
        mime = "image/gif"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        mime = "image/webp"
    if mime:
        response = FileResponse(BytesIO(data), content_type=mime, as_attachment=False, filename=name)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response
    def text_response(payload):
        response = JsonResponse(payload)
        response["Cache-Control"] = "private, no-store"
        return response
    if extension in {".txt", ".csv", ".log", ".md", ".json", ".xml"}:
        return text_response({"kind": "text", "text": data.decode("utf-8-sig", errors="replace")[:200000], "note": "Text preview, limited to 200,000 characters."})
    if extension in {".docx", ".pptx", ".xlsx"}:
        try:
            with ZipFile(BytesIO(data)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 30 * 1024 * 1024:
                    raise ValidationError("This document expands beyond the preview limit.")
                if extension == ".docx":
                    root = ElementTree.fromstring(archive.read("word/document.xml"))
                    text = "\n".join("".join(node.itertext()) for node in root.findall(".//{*}p"))
                elif extension == ".pptx":
                    paths = sorted((p for p in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", p)), key=lambda p: int(re.search(r"slide(\d+)", p).group(1)))
                    text = "\n\n".join(f"Slide {index + 1}\n" + "\n".join(node.text or "" for node in ElementTree.fromstring(archive.read(path)).iter() if node.tag.endswith("}t")) for index, path in enumerate(paths[:30]))
                else:
                    from openpyxl import load_workbook
                    book = load_workbook(BytesIO(data), read_only=True, data_only=True, keep_links=False)
                    try:
                        text = "\n\n".join(sheet.title + "\n" + "\n".join(" | ".join(str(value) if value is not None else "" for value in row) for row in sheet.iter_rows(max_row=100, max_col=20, values_only=True)) for sheet in list(book.worksheets)[:5])
                    finally:
                        book.close()
            return text_response({"kind": "text", "text": text[:200000], "note": "Content preview; formatting may differ. Large files are limited to the first pages, slides or rows."})
        except (BadZipFile, KeyError, ElementTree.ParseError, ValueError, OSError):
            raise ValidationError("This document could not be previewed. Download it to open it in its original application.")
    raise ValidationError("Preview is available for PDFs, images, text, Word documents, Excel workbooks and PowerPoint presentations. Download other formats to open them.")
