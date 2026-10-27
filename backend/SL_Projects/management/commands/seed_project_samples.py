"""Create identifiable, repeatable project examples without creating users or roles."""
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q, F
from django.utils import timezone

from Platform_Core.models import OrganizationMembership, SystemNotification, Tenant, TenantBranch
from SL_Projects.models import Project, ProjectMilestone, ProjectTask, TaskFollowUp

MARKER = '[ERP SAMPLE v1]'
PREFIX = 'DEMO-V1-'


class Command(BaseCommand):
    help = 'Seed removable project examples for active organizations; --clear removes untouched examples.'

    def add_arguments(self, parser):
        parser.add_argument('--all-active-tenants', action='store_true')
        parser.add_argument('--tenant', help='Organization code')
        parser.add_argument('--clear', action='store_true')
        parser.add_argument('--dry-run', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        if not options['all_active_tenants'] and not options['tenant']:
            raise CommandError('Choose --tenant CODE or --all-active-tenants.')
        tenants = Tenant.objects.filter(is_active=True)
        if options['tenant']:
            tenants = tenants.filter(code=options['tenant'])
        if not tenants.exists():
            raise CommandError('No active organizations matched.')
        for tenant in tenants.order_by('pk'):
            if options['clear']:
                self.clear(tenant)
            else:
                self.seed(tenant)
        if options['dry_run']:
            transaction.set_rollback(True)
            self.stdout.write('Dry run: no changes saved.')

    def seed(self, tenant):
        today = timezone.localdate()
        if not tenant.branches.filter(is_active=True).exists():
            TenantBranch.objects.get_or_create(tenant=tenant, name='[SAMPLE] Demo workspace', defaults={'is_active': True})
        branches = tenant.branches.filter(is_active=True).order_by('pk')
        created_projects = created_tasks = 0
        for branch in branches:
            members = list(OrganizationMembership.objects.filter(
                tenant=tenant, is_active=True, user__is_active=True,
            ).filter(Q(branch=branch) | Q(branches=branch) | Q(is_org_admin=True) |
                     Q(branch_role_assignments__branch=branch, branch_role_assignments__is_active=True) | Q(branch__isnull=True, branches__isnull=True, branch_role_assignments__isnull=True))
                .select_related('user').distinct().order_by('pk'))
            # No fake accounts, branch assignments, privileges, or module activations.
            if not members:
                continue
            project, made = Project.objects.get_or_create(
                tenant=tenant, code=f'{PREFIX}PRJ-{branch.pk}',
                defaults=dict(branch=branch, name='[SAMPLE] Customer delivery project', description=MARKER,
                              status='active', progress_percentage=40, start_date=today-timedelta(days=7), target_end_date=today+timedelta(days=21)),
            )
            created_projects += int(made)
            if project.description != MARKER:
                raise CommandError(f'Sample identifier collision in {tenant.code}.')
            milestone, _ = ProjectMilestone.objects.get_or_create(
                project=project, name='[SAMPLE] Delivery readiness',
                defaults=dict(description=MARKER, due_date=today+timedelta(days=10), status='open'),
            )
            # Every existing branch member has examples, including task-only roles.
            for member in members:
                role_name = member.effective_role_group_name()
                role = member.user.groups.filter(name=role_name).first() if role_name else None
                for index, (title, state, progress) in enumerate([
                    ('Confirm customer requirements', 'todo', 0),
                    ('Prepare delivery plan', 'in_progress', 40),
                    ('Review delivery evidence', 'in_review', 80),
                ], start=1):
                    task, made = ProjectTask.objects.get_or_create(
                        tenant=tenant, number=f'{PREFIX}TSK-{branch.pk}-{member.pk}-{index}',
                        defaults=dict(branch=branch, project=project, milestone=milestone,
                                      title=f'[SAMPLE] {title}', description=MARKER, task_type='sample',
                                      primary_assignee=member.user, assigned_role=role, status=state,
                                      priority=['high', 'medium', 'low'][index-1], progress_percentage=progress,
                                      due_date=today+timedelta(days=index-2)),
                    )
                    created_tasks += int(made)
                    if made and index == 1:
                        TaskFollowUp.objects.create(task=task, owner=member.user, follow_up_date=today,
                                                    notes=f'{MARKER} Confirm the next action with the customer.')
        self.stdout.write(f'{tenant.code}: created {created_projects} sample projects, {created_tasks} sample tasks.')

    def clear(self, tenant):
        projects = Project.objects.filter(tenant=tenant, code__startswith=PREFIX, description=MARKER)
        tasks = ProjectTask.objects.filter(tenant=tenant, number__startswith=PREFIX, description=MARKER)
        # Refuse cascading deletion of real work added to a sample, or edited samples.
        changed = tasks.filter(updated_at__gt=F('created_at') + timedelta(seconds=1)).exists()
        changed |= projects.filter(updated_at__gt=F('created_at') + timedelta(seconds=1)).exists()
        changed |= ProjectTask.objects.filter(project__in=projects).exclude(pk__in=tasks).exists()
        changed |= tasks.filter(Q(updates__isnull=False) | Q(comments__isnull=False) |
                                Q(attachments__isnull=False) | Q(dependencies__isnull=False) |
                                Q(dependent_tasks__isnull=False) | Q(collaborators__isnull=False)).exists()
        changed |= TaskFollowUp.objects.filter(task__in=tasks).exclude(notes__startswith=MARKER).exists()
        changed |= TaskFollowUp.objects.filter(task__in=tasks, updated_at__gt=F('created_at') + timedelta(seconds=1)).exists()
        changed |= projects.filter(Q(documents__isnull=False) | Q(members__isnull=False)).exists()
        changed |= ProjectMilestone.objects.filter(project__in=projects).exclude(description=MARKER).exists()
        changed |= ProjectMilestone.objects.filter(project__in=projects, updated_at__gt=F('created_at') + timedelta(seconds=1)).exists()
        changed |= ProjectTask.objects.exclude(pk__in=tasks).filter(Q(parent_task__in=tasks) | Q(milestone__project__in=projects)).exists()
        if changed:
            raise CommandError(f'{tenant.code}: sample records have been edited or contain real work; review and delete those records individually.')
        count = tasks.count()
        SystemNotification.objects.filter(tenant=tenant, source_type='project_task_overdue', source_id__in=tasks.values('pk')).delete()
        SystemNotification.objects.filter(tenant=tenant, source_type='project_task_follow_up_due', source_id__in=TaskFollowUp.objects.filter(task__in=tasks).values('pk')).delete()
        tasks.delete()
        projects.delete()
        for branch in tenant.branches.filter(name='[SAMPLE] Demo workspace'):
            if branch.owned_projects.exists() or branch.project_tasks.exists() or branch.organization_memberships.exists() or branch.organization_member_assignments.exists() or branch.member_role_assignments.exists():
                continue
            from django.db.models.deletion import ProtectedError
            try:
                branch.delete()
            except ProtectedError:
                raise CommandError(f'{tenant.code}: sample branch is now used by real records; remove it manually after review.')
        self.stdout.write(f'{tenant.code}: removed {count} untouched sample tasks and their sample projects.')
