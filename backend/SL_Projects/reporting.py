# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db.models import Count
from django.template import Context, Engine
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from Platform_Core.documents import RenderedDocument, _safe_logo_url
from Platform_Core.models import TenantSettings


def project_report_rows(kind, tasks, projects, followups, milestones):
    if kind == 'tasks':
        return ['Task', 'Title', 'Project', 'Assignee / Role', 'Status', 'Priority', 'Due', 'Progress %'], [
            [t.number, t.title, t.project.name if t.project_id else 'Standalone',
             (t.primary_assignee.get_full_name() or t.primary_assignee.username) if t.primary_assignee_id else (t.assigned_role.name.split(':', 2)[-1] if t.assigned_role_id else 'Unassigned'),
             t.get_status_display(), t.get_priority_display(), str(t.due_date or ''), t.progress_percentage]
            for t in tasks.order_by('due_date', 'pk')]
    if kind == 'projects':
        return ['Project', 'Name', 'Manager', 'Status', 'Due', 'Progress %'], [[p.code, p.name, (p.manager.get_full_name() or p.manager.username) if p.manager_id else '', p.get_status_display(), str(p.target_end_date or ''), p.progress_percentage] for p in projects.order_by('pk')]
    if kind == 'follow-ups':
        return ['Task', 'Title', 'Follow-up date', 'Owner', 'Status', 'Notes'], [[f.task.number, f.task.title, str(f.follow_up_date), (f.owner.get_full_name() or f.owner.username) if f.owner_id else '', f.status, f.notes] for f in followups.select_related('task', 'owner').order_by('follow_up_date', 'pk')]
    if kind == 'workload':
        rows = tasks.exclude(status__in=['completed', 'cancelled']).values('primary_assignee__username', 'primary_assignee__first_name').annotate(total=Count('pk', distinct=True)).order_by('-total')
        return ['Assignee', 'Open tasks'], [[r['primary_assignee__first_name'] or r['primary_assignee__username'] or 'Unassigned', r['total']] for r in rows]
    if kind == 'milestones':
        return ['Project', 'Milestone', 'Due', 'Status', 'Progress %'], [[m.project.code, m.name, str(m.due_date or ''), m.status, m.progress_percentage] for m in milestones.select_related('project').order_by('due_date', 'pk')]
    raise ValidationError({'report': 'Choose tasks, projects, follow-ups, workload, or milestones.'})


def report_document(tenant, kind, columns, rows, request):
    settings = TenantSettings.objects.filter(tenant=tenant).first() if tenant else None
    context = {
        'company': (getattr(tenant, 'legal_name', '') or getattr(tenant, 'name', '') or 'ERP'),
        'color': getattr(settings, 'primary_color', '') or '#000000',
        'logo': _safe_logo_url(settings, request),
        'title': f'Projects & Tasks — {kind.replace("-", " ").title()} Report',
        'generated': timezone.localtime().strftime('%d %b %Y %H:%M'),
        'period': f'{request.query_params.get("date_from", "All dates")} — {request.query_params.get("date_to", "Present")}',
        'columns': columns, 'rows': rows,
        'footer': getattr(settings, 'footer_text', '') or 'Projects & Tasks Report',
    }
    source = '''<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: a4 landscape; margin: 15mm; }
      body { font-family: Helvetica, Arial, sans-serif; font-size: 8pt; color: #17202a; }
      h1 { font-size: 17pt; color: {{ color }}; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th { background: #f1f5f9; color: {{ color }}; text-align: left; border-top: 2px solid {{ color }}; }
      td, th { padding: 7px 5px; border-bottom: 1px solid #dbe3ea; vertical-align: top; }
      .footer { margin-top: 16px; color: #64748b; font-size: 8pt; }
    </style></head><body>
      {% if logo %}<img src="{{ logo }}" width="95" style="max-height:65px;object-fit:contain;">{% endif %}
      <h1>{{ company }}</h1><h2>{{ title }}</h2><p>Generated: {{ generated }} · Period: {{ period }} · Records: {{ rows|length }}</p>
      <table repeat="1"><thead><tr>{% for column in columns %}<th>{{ column }}</th>{% endfor %}</tr></thead><tbody>
      {% for row in rows %}<tr>{% for cell in row %}<td>{{ cell }}</td>{% endfor %}</tr>{% empty %}<tr><td colspan="{{ columns|length }}">No records match the selected filters.</td></tr>{% endfor %}
      </tbody></table><p class="footer">{{ footer }}</p></body></html>'''
    html = Engine().from_string(source).render(Context(context))
    return RenderedDocument(html=html, template=None, settings=settings)
