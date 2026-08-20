"""
Seed script — run with:
  cd backend
  DJANGO_SETTINGS_MODULE=SL_ERP.settings python scripts/seed_users.py

Creates:
  • Tenant:  Siakora Labs Limited
  • Branch:  Head Office
  • Groups:  tenant_admin, finance, operator
  • Users (all passwords = SL@2024!):
      admin        → superuser (superadmin role)
      alice.admin  → tenant_admin
      bob.finance  → finance
      carol.ops    → operator
      david.ops    → operator
"""

import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "SL_ERP.settings")
django.setup()

from django.contrib.auth.models import User, Group
from Platform_Core.models import Tenant, TenantBranch, TenantUserProfile

PASSWORD = "SL@2024!"

# ── 1. Groups ─────────────────────────────────────────────────────────────────
group_names = ["tenant_admin", "finance", "operator"]
groups = {}
for name in group_names:
    g, created = Group.objects.get_or_create(name=name)
    groups[name] = g
    print(f"  {'Created' if created else 'Exists '} group: {name}")

# ── 2. Tenant ─────────────────────────────────────────────────────────────────
tenant, created = Tenant.objects.get_or_create(
    code="siakora-labs",
    defaults=dict(
        name="Siakora Labs Limited",
        legal_name="Siakora Labs Limited",
        contact_email="admin@siakoralabs.com",
        default_currency="KES",
        timezone="Africa/Nairobi",
        status="active",
        is_active=True,
    ),
)
print(f"\n  {'Created' if created else 'Exists '} tenant: {tenant.name}")

# ── 3. Branch ─────────────────────────────────────────────────────────────────
branch, created = TenantBranch.objects.get_or_create(
    tenant=tenant,
    name="Head Office",
    defaults=dict(code="HQ"),
)
print(f"  {'Created' if created else 'Exists '} branch: {branch.name}")

# ── 4. Users ──────────────────────────────────────────────────────────────────
def make_user(username, email, first, last, group=None, superuser=False, staff=False):
    user, created = User.objects.get_or_create(
        username=username,
        defaults=dict(
            email=email,
            first_name=first,
            last_name=last,
            is_superuser=superuser,
            is_staff=staff or superuser,
        ),
    )
    if created:
        user.set_password(PASSWORD)
        user.save()
    if group and not user.groups.filter(name=group).exists():
        user.groups.add(groups[group])
    # Bind to tenant
    TenantUserProfile.objects.get_or_create(
        user=user,
        tenant=tenant,
        defaults=dict(branch=branch, is_active=True),
    )
    role_label = "superadmin" if superuser else (group or "operator")
    print(f"  {'Created' if created else 'Exists '} user: {username:16s} → {role_label}")
    return user

print()
make_user("admin",       "admin@siakoralabs.com",   "Admin",  "User",    superuser=True)
make_user("alice.admin", "alice@siakoralabs.com",   "Alice",  "Mwangi",  group="tenant_admin", staff=True)
make_user("bob.finance", "bob@siakoralabs.com",     "Bob",    "Otieno",  group="finance")
make_user("carol.ops",   "carol@siakoralabs.com",   "Carol",  "Njeri",   group="operator")
make_user("david.ops",   "david@siakoralabs.com",   "David",  "Kamau",   group="operator")

print(f"""
Done! ✓
────────────────────────────────────────────────
Tenant  : Siakora Labs Limited
Branch  : Head Office

Username        Password     Role
──────────────  ──────────── ─────────────
admin           {PASSWORD}  Super Admin
alice.admin     {PASSWORD}  Tenant Admin
bob.finance     {PASSWORD}  Finance
carol.ops       {PASSWORD}  Operator
david.ops       {PASSWORD}  Operator
────────────────────────────────────────────────
""")
