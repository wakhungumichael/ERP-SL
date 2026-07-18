"""
SL_CRM — Customer & Supplier Relationship models.

Designed for multi-tenant SaaS reuse across all ERP modules.
Every top-level model carries a `tenant` FK so Super Admin can
scope data correctly across plans and subscriptions.
"""

from django.db import models
from django.contrib.auth.models import User


# ---------------------------------------------------------------------------
# Organisation (Company / Business Entity)
# ---------------------------------------------------------------------------

class Organisation(models.Model):
    """
    A business entity — could be a prospect, active customer, or partner.
    If the organisation already exists as a Weighbridge customer, it can
    be linked via `weighbridge_customer` to avoid duplicate records.
    """

    TYPE_CHOICES = [
        ("customer",  "Customer"),
        ("prospect",  "Prospect"),
        ("partner",   "Partner"),
        ("other",     "Other"),
    ]

    name                 = models.CharField(max_length=255)
    type                 = models.CharField(max_length=20, choices=TYPE_CHOICES, default="customer")
    industry             = models.CharField(max_length=120, blank=True, default="")
    website              = models.URLField(blank=True, default="")
    email                = models.EmailField(blank=True, default="")
    phone                = models.CharField(max_length=30, blank=True, default="")
    address              = models.TextField(blank=True, default="")
    notes                = models.TextField(blank=True, default="")

    # Soft-link to Weighbridge customer record (optional, for backward compat)
    weighbridge_customer = models.OneToOneField(
        "SL_Weighbridge.Customer",
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="crm_organisation",
    )

    # Tenant isolation — every record belongs to one tenant
    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="crm_organisations",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# Contact (Person)
# ---------------------------------------------------------------------------

class Contact(models.Model):
    """
    A real person — an employee, decision-maker, or point of contact
    at an organisation or supplier.
    """

    first_name   = models.CharField(max_length=100)
    last_name    = models.CharField(max_length=100, blank=True, default="")
    job_title    = models.CharField(max_length=120, blank=True, default="")
    email        = models.EmailField(blank=True, default="")
    phone        = models.CharField(max_length=30, blank=True, default="")
    organisation = models.ForeignKey(
        Organisation,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="contacts",
    )
    notes        = models.TextField(blank=True, default="")

    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="crm_contacts",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["first_name", "last_name"]

    def __str__(self):
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def organisation_name(self):
        return self.organisation.name if self.organisation else ""


# ---------------------------------------------------------------------------
# Supplier
# ---------------------------------------------------------------------------

class Supplier(models.Model):
    """
    A vendor or supplier of goods and services. Feeds into the
    Procurement module when it is built.
    """

    PAYMENT_TERMS = [
        ("immediate", "Pay on Receipt"),
        ("net_15",    "Net 15 Days"),
        ("net_30",    "Net 30 Days"),
        ("net_60",    "Net 60 Days"),
        ("net_90",    "Net 90 Days"),
    ]

    name           = models.CharField(max_length=255)
    contact_person = models.CharField(max_length=150, blank=True, default="")
    email          = models.EmailField(blank=True, default="")
    phone          = models.CharField(max_length=30, blank=True, default="")
    address        = models.TextField(blank=True, default="")
    payment_terms  = models.CharField(max_length=20, choices=PAYMENT_TERMS, default="net_30")
    account_number = models.CharField(max_length=80, blank=True, default="",
                                      help_text="Your account number with this supplier")
    notes          = models.TextField(blank=True, default="")

    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="crm_suppliers",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# Lead / Opportunity
# ---------------------------------------------------------------------------

class Lead(models.Model):
    """
    A sales opportunity being tracked through the pipeline.
    Plain-English stages map to a standard sales funnel.
    """

    STAGE_CHOICES = [
        ("new",         "New"),
        ("contacted",   "Contacted"),
        ("proposal",    "Proposal Sent"),
        ("negotiation", "Negotiating"),
        ("won",         "Won"),
        ("lost",        "Lost"),
    ]

    title                = models.CharField(max_length=255)
    organisation         = models.ForeignKey(
        Organisation, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="leads",
    )
    contact              = models.ForeignKey(
        Contact, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="leads",
    )
    stage                = models.CharField(max_length=20, choices=STAGE_CHOICES, default="new")
    value                = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="Estimated deal value",
    )
    currency             = models.CharField(max_length=10, default="KES")
    expected_close_date  = models.DateField(null=True, blank=True)
    assigned_to          = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="assigned_leads",
    )
    notes                = models.TextField(blank=True, default="")

    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="crm_leads",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title

    @property
    def organisation_name(self):
        return self.organisation.name if self.organisation else ""

    @property
    def contact_name(self):
        return str(self.contact) if self.contact else ""

    @property
    def assigned_to_name(self):
        return self.assigned_to.get_full_name() or self.assigned_to.username if self.assigned_to else ""


# ---------------------------------------------------------------------------
# Activity / Follow-up
# ---------------------------------------------------------------------------

class Activity(models.Model):
    """
    A logged interaction — call, email, meeting, or internal note.
    Can be linked to a person, company, or opportunity.
    """

    TYPE_CHOICES = [
        ("call",    "Phone Call"),
        ("email",   "Email"),
        ("meeting", "Meeting"),
        ("note",    "Note"),
        ("task",    "Task"),
    ]

    type         = models.CharField(max_length=20, choices=TYPE_CHOICES, default="note")
    summary      = models.TextField()
    date         = models.DateTimeField()
    contact      = models.ForeignKey(
        Contact, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="activities",
    )
    lead         = models.ForeignKey(
        Lead, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="activities",
    )
    organisation = models.ForeignKey(
        Organisation, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="activities",
    )
    created_by   = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="crm_activities",
    )

    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="crm_activities",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]
        verbose_name_plural = "activities"

    def __str__(self):
        return f"{self.get_type_display()} — {self.summary[:60]}"
