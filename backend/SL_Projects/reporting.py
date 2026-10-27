# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db.models import Count
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from Platform_Core.documents import (
    RenderedDocument,
    _brand_stylesheet,
    _default_body,
    _default_stylesheet,
    _get_settings,
    _render_template_string,
    _safe_logo_url,
    resolve_document_template,
)
from Platform_Core.models import TenantSettings


def _user_display_name(user):
    """Best-effort display name for a user, tolerating anonymous users."""
    getter = getattr(user, "get_full_name", None)
    if getter:
        return getter() or user.get_username()
    return getattr(user, "get_username", lambda: "")()


def _task_assignee_name(task):
    """Prefer the primary assignee, then the assigned role, else 'Unassigned'."""
    if task.primary_assignee_id:
        return _user_display_name(task.primary_assignee)
    if task.assigned_role_id:
        return task.assigned_role.name.split(":", 2)[-1]
    return "Unassigned"


def _task_rows(tasks):
    return (
        [
            "Task",
            "Title",
            "Project",
            "Assignee / Role",
            "Status",
            "Priority",
            "Due",
            "Progress %",
        ],
        [
            [
                t.number,
                t.title,
                t.project.name if t.project_id else "Standalone",
                _task_assignee_name(t),
                t.get_status_display(),
                t.get_priority_display(),
                str(t.due_date or ""),
                t.progress_percentage,
            ]
            for t in tasks.order_by("due_date", "pk")
        ],
    )


def _project_rows(projects):
    return (
        ["Project", "Name", "Manager", "Status", "Due", "Progress %"],
        [
            [
                p.code,
                p.name,
                _user_display_name(p.manager) if p.manager_id else "",
                p.get_status_display(),
                str(p.target_end_date or ""),
                p.progress_percentage,
            ]
            for p in projects.order_by("pk")
        ],
    )


def _follow_up_rows(followups):
    return (
        ["Task", "Title", "Follow-up date", "Owner", "Status", "Notes"],
        [
            [
                f.task.number,
                f.task.title,
                str(f.follow_up_date),
                _user_display_name(f.owner) if f.owner_id else "",
                f.status,
                f.notes,
            ]
            for f in followups.select_related("task", "owner").order_by(
                "follow_up_date", "pk"
            )
        ],
    )


def _workload_rows(tasks):
    rows = (
        tasks.exclude(status__in=["completed", "cancelled"])
        .values("primary_assignee__username", "primary_assignee__first_name")
        .annotate(total=Count("pk", distinct=True))
        .order_by("-total")
    )
    return (
        ["Assignee", "Open tasks"],
        [
            [
                r["primary_assignee__first_name"]
                or r["primary_assignee__username"]
                or "Unassigned",
                r["total"],
            ]
            for r in rows
        ],
    )


def _milestone_rows(milestones):
    return (
        ["Project", "Milestone", "Due", "Status", "Progress %"],
        [
            [
                m.project.code,
                m.name,
                str(m.due_date or ""),
                m.status,
                m.progress_percentage,
            ]
            for m in milestones.select_related("project").order_by("due_date", "pk")
        ],
    )


_REPORT_BUILDERS = {
    "tasks": _task_rows,
    "projects": _project_rows,
    "follow-ups": _follow_up_rows,
    "workload": _workload_rows,
    "milestones": _milestone_rows,
}


def project_report_rows(kind, tasks, projects, followups, milestones):
    if kind == "tasks":
        return _task_rows(tasks)
    if kind == "workload":
        return _workload_rows(tasks)
    if kind == "projects":
        return _project_rows(projects)
    if kind == "follow-ups":
        return _follow_up_rows(followups)
    if kind == "milestones":
        return _milestone_rows(milestones)
    raise ValidationError(
        {"report": "Choose tasks, projects, follow-ups, workload, or milestones."}
    )


_REPORT_KIND_LABELS = {
    "tasks": "Task Report",
    "projects": "Project Report",
    "follow-ups": "Task Follow-ups Report",
    "workload": "Workload Report",
    "milestones": "Milestone Report",
}


def report_document(tenant, report_type, columns, rows, request=None):
    """Render a branded HTML report document using the report template."""
    settings_obj = _get_settings(tenant)
    primary_color = getattr(settings_obj, "primary_color", "") or "#E85D26"
    footer_text = getattr(settings_obj, "footer_text", "") or ""
    company_name = (
        getattr(tenant, "legal_name", "") or getattr(tenant, "name", "") or "SL-ERP"
    )
    title = _REPORT_KIND_LABELS.get(report_type, "Report")
    prepared_by = _user_display_name(getattr(request, "user", None) or "")
    display_rows = [
        [
            {
                "value": str(value),
                "align": "right" if isinstance(value, int) else "left",
            }
            for value in row
        ]
        for row in rows
    ]
    report_context = {
        "title": title,
        "category_label": title,
        "row_count": len(rows),
        "columns": [{"label": label, "align": "left"} for label in columns],
        "display_rows": display_rows,
    }
    context = {
        "branding": {
            "logo_url": _safe_logo_url(settings_obj, request),
            "primary_color": primary_color,
            "footer_text": footer_text,
        },
        "company": {
            "name": company_name,
            "prepared_by": prepared_by,
        },
        "document": {"number": title.upper().replace(" ", "-")},
        "report": report_context,
        "generated_at": timezone.now(),
    }
    template, _ = resolve_document_template(tenant=tenant, document_type="report")
    template_body = (
        template.body_template
        if template and template.body_template
        else _default_body("report")
    )
    stylesheet = (
        template.stylesheet
        if template and template.stylesheet
        else _default_stylesheet(primary_color)
    )
    stylesheet = _render_template_string(stylesheet, context)
    rendered_body = _render_template_string(template_body, context)
    html = f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <style>{_brand_stylesheet(primary_color)}{stylesheet}</style>
  </head>
  <body>{rendered_body}</body>
</html>"""
    return RenderedDocument(html=html, template=template, settings=settings_obj)
