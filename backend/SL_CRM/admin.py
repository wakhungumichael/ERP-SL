from django.contrib import admin
from .models import Organisation, Contact, Supplier, Lead, Activity


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ["name", "type", "industry", "email", "phone"]
    list_filter  = ["type"]
    search_fields = ["name", "email"]


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display  = ["full_name", "job_title", "organisation", "email", "phone"]
    search_fields = ["first_name", "last_name", "email"]
    list_filter   = ["organisation"]


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display  = ["name", "contact_person", "email", "payment_terms"]
    search_fields = ["name", "email", "contact_person"]
    list_filter   = ["payment_terms"]


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display  = ["title", "organisation", "stage", "value", "currency", "assigned_to"]
    list_filter   = ["stage", "currency"]
    search_fields = ["title"]


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display  = ["type", "summary", "date", "contact", "lead", "created_by"]
    list_filter   = ["type"]
    search_fields = ["summary"]
