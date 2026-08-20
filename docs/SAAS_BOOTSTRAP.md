# SaaS Bootstrap

## Goal

This project is owned by **Siakora Labs Limited** as the default SaaS owner.

For a new environment, we want a repeatable bootstrap that:
- seeds platform modules and plans
- creates the owner tenant
- creates owner staff accounts
- allows future tenant provisioning from a stable superadmin account

## Command

Run after `python manage.py migrate`:

```bash
cd backend
source ../.venv/bin/activate
python manage.py bootstrap_saas_owner --default-password 'ChangeMeNow!123'
```

## What it creates

Tenant:
- `Siakora Labs Limited`

Branch:
- `Head Office`

Groups:
- `Tenant Admin`
- `Finance`
- `Operator`

Accounts:
- platform superadmin: `slabs`
- owner tenant admin: `siakora.admin`
- owner finance: `siakora.finance`
- owner operator: `siakora.ops`

If you do not pass `--default-password`, secure random passwords are generated and printed once.

## Optional overrides

Example:

```bash
python manage.py bootstrap_saas_owner \
  --company-name 'Siakora Labs Limited' \
  --tenant-code 'siakora-labs' \
  --contact-email 'info@siakoralabs.co.ke' \
  --platform-admin-username 'slabs' \
  --platform-admin-email 'info@siakoralabs.co.ke'
```

## Existing environments

If an environment already has subscriptions created before the latest module-entitlement fixes, run:

```bash
python manage.py sync_all_subscription_modules
```

For a single tenant:

```bash
python manage.py sync_all_subscription_modules --tenant-id 12
```

## Suggested bootstrap flow for a brand-new environment

```bash
cd /srv/sl-erp
source .venv/bin/activate
cd backend
python manage.py migrate
python manage.py bootstrap_saas_owner --default-password 'ChangeMeNow!123'
python manage.py runserver 0.0.0.0:8080
```

If you are working from the repository root in local development, the equivalent activation command after `cd backend` is:

```bash
source ../.venv/bin/activate
```

Then in the frontend:
1. Log in as `slabs`
2. Create a tenant
3. Assign a plan
4. Set `demo_days` if trial access is needed

That tenant will then get:
- a generated tenant admin password
- a subscription
- synced module activations
- module-limited navigation based on plan/trial
