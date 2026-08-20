from Platform_Core.models import Tenant, TenantBranch
from SL_Weighbridge.models import Branch, Company


def ensure_operational_company_for_tenant(tenant: Tenant):
    company = Company.objects.filter(tenant=tenant).order_by("id").first()
    if company is None:
        company = Company.objects.filter(tenant__isnull=True, name=tenant.name).order_by("id").first()
        if company is not None:
            company.tenant = tenant
            company.save(update_fields=["tenant"])
    if company is None:
        company = Company.objects.create(
            tenant=tenant,
            name=tenant.name,
            address=getattr(tenant, "legal_name", "") or tenant.name,
            email=tenant.contact_email or f"admin@{tenant.code}.local",
            phone=tenant.contact_phone or "",
        )

    changed = []
    if company.tenant_id != tenant.id:
        company.tenant = tenant
        changed.append("tenant")
    if company.name != tenant.name:
        company.name = tenant.name
        changed.append("name")
    if tenant.contact_email and company.email != tenant.contact_email:
        company.email = tenant.contact_email
        changed.append("email")
    if tenant.contact_phone and company.phone != tenant.contact_phone:
        company.phone = tenant.contact_phone
        changed.append("phone")
    if tenant.legal_name and company.address != tenant.legal_name:
        company.address = tenant.legal_name
        changed.append("address")
    if changed:
        company.save(update_fields=changed)
    return company


def sync_tenant_branch_to_operational(tenant_branch: TenantBranch):
    company = ensure_operational_company_for_tenant(tenant_branch.tenant)
    branch = (
        Branch.objects.filter(tenant=tenant_branch.tenant, name=tenant_branch.name).order_by("id").first()
        or Branch.objects.filter(company=company, name=tenant_branch.name).order_by("id").first()
    )
    if branch is None:
        branch = Branch.objects.create(
            tenant=tenant_branch.tenant,
            company=company,
            name=tenant_branch.name,
            address=tenant_branch.address or company.address,
            email=tenant_branch.email or company.email,
            phone=tenant_branch.phone or company.phone,
        )

    changed = []
    if branch.tenant_id != tenant_branch.tenant_id:
        branch.tenant = tenant_branch.tenant
        changed.append("tenant")
    if branch.company_id != company.id:
        branch.company = company
        changed.append("company")
    if branch.address != (tenant_branch.address or company.address):
        branch.address = tenant_branch.address or company.address
        changed.append("address")
    if branch.email != (tenant_branch.email or company.email):
        branch.email = tenant_branch.email or company.email
        changed.append("email")
    if branch.phone != (tenant_branch.phone or company.phone):
        branch.phone = tenant_branch.phone or company.phone
        changed.append("phone")
    if changed:
        branch.save(update_fields=changed)
    return branch


def sync_tenant_branches_to_operational(tenant: Tenant):
    operational = []
    for tenant_branch in TenantBranch.objects.filter(tenant=tenant, is_active=True).order_by("name"):
        operational.append(sync_tenant_branch_to_operational(tenant_branch))
    return operational


def get_operational_branches_for_tenant(tenant: Tenant):
    sync_tenant_branches_to_operational(tenant)
    names = list(TenantBranch.objects.filter(tenant=tenant, is_active=True).values_list("name", flat=True))
    return Branch.objects.filter(tenant=tenant, name__in=names).order_by("name")
