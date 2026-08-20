# SL_Weighbridge/admin_views.py

from django.contrib import admin
from django.contrib.admin.views.decorators import staff_member_required
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.urls import path

from Platform_API.modules.mixins import NO_TENANT_ACCESS, resolve_user_tenant
from .models import VehiclePresence, Transaction


class DiscrepancyReportView(admin.ModelAdmin):
    change_list_template = "admin/discrepancy_report.html"

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('discrepancy_report/', self.admin_site.admin_view(self.discrepancy_report_view))
        ]
        return custom_urls + urls

    @staff_member_required
    def discrepancy_report_view(self, request):
        resolved = resolve_user_tenant(request.user)
        transactions = Transaction.objects.all()
        vehicle_presences = VehiclePresence.objects.all()
        if resolved is NO_TENANT_ACCESS:
            transactions = transactions.none()
            vehicle_presences = vehicle_presences.none()
        elif resolved is not None:
            transactions = transactions.filter(tenant=resolved)
            vehicle_presences = vehicle_presences.filter(tenant=resolved)

        discrepancies = []

        # Convert to dictionaries for easier comparison
        transaction_dict = {tx.vehicle_id: tx for tx in transactions}
        presence_dict = {vp.vehicle_id: vp for vp in vehicle_presences}

        # Find vehicles with transactions but no presence records
        for vehicle_id, transaction in transaction_dict.items():
            if vehicle_id not in presence_dict:
                discrepancies.append(f"Vehicle ID {vehicle_id} has a transaction but no corresponding presence record.")

        # Find vehicles with presence records but no transactions
        for vehicle_id, presence in presence_dict.items():
            if vehicle_id not in transaction_dict:
                discrepancies.append(f"Vehicle ID {vehicle_id} has a presence record but no corresponding transaction.")

        # Optionally, find discrepancies in timestamps (if available)
        for vehicle_id, transaction in transaction_dict.items():
            presence = presence_dict.get(vehicle_id)
            if presence and presence.timestamp < transaction.timestamp:
                discrepancies.append(
                    f"Vehicle ID {vehicle_id} has a transaction with timestamp {transaction.timestamp} but presence with timestamp {presence.timestamp}.")

        # Render the report using a template
        context = {
            'discrepancies': discrepancies,
            'transactions': transactions,
            'vehicle_presences': vehicle_presences,
        }
        html = render_to_string('admin/discrepancy_report.html', context)
        return HttpResponse(html)
