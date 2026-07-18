"""
Accounting module views.

Current state: provides a live dashboard aggregated from SL_Weighbridge
Transaction and Invoice models.  Full journal/ledger integration is
planned as a separate Platform_Core accounting engine.
"""
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

try:
    from SL_Weighbridge.models import Transaction, Invoice
    HAS_WEIGHBRIDGE = True
except ImportError:
    HAS_WEIGHBRIDGE = False


class AccountingDashboardView(APIView):
    """
    GET /api/accounting/dashboard/

    Returns a financial summary drawn from completed transactions and invoices:
    - this-month revenue (charge totals)
    - invoice status breakdown
    - outstanding balance
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        month_start = today.replace(day=1)
        year_start = today.replace(month=1, day=1)

        branch_id = request.query_params.get("branch_id")

        tx_totals = {
            "completed": 0,
            "pending": 0,
            "total_charge_this_month": 0.0,
            "total_charge_this_year": 0.0,
            "uninvoiced_completed": 0,
        }
        invoice_summary = {
            "draft": 0,
            "issued": 0,
            "paid": 0,
            "overdue": 0,
            "total_invoiced": 0.0,
            "total_paid": 0.0,
            "outstanding": 0.0,
        }
        recent_invoices = []

        if HAS_WEIGHBRIDGE:
            try:
                qs = Transaction.objects.all()
                if branch_id:
                    qs = qs.filter(branch_id=branch_id)

                tx_totals["completed"] = qs.filter(status="Completed").count()
                tx_totals["pending"] = qs.filter(status="Pending").count()
                tx_totals["uninvoiced_completed"] = qs.filter(
                    status="Completed", invoiced=False
                ).count()

                month_completed = list(
                    qs.filter(created_at__date__gte=month_start, status="Completed")
                )
                year_completed = list(
                    qs.filter(created_at__date__gte=year_start, status="Completed")
                )
                tx_totals["total_charge_this_month"] = float(
                    sum(t.charge or 0 for t in month_completed)
                )
                tx_totals["total_charge_this_year"] = float(
                    sum(t.charge or 0 for t in year_completed)
                )
            except Exception:
                pass

            try:
                inv_qs = Invoice.objects.select_related("customer").order_by("-created_at")
                invoice_summary["draft"] = inv_qs.filter(status="draft").count()
                invoice_summary["issued"] = inv_qs.filter(status="issued").count()
                invoice_summary["paid"] = inv_qs.filter(status="paid").count()

                invoiced_list = list(inv_qs.filter(status__in=["issued", "paid"]))
                paid_list = list(inv_qs.filter(status="paid"))

                invoice_summary["total_invoiced"] = float(
                    sum(i.total_amount or 0 for i in invoiced_list)
                )
                invoice_summary["total_paid"] = float(
                    sum(i.total_amount or 0 for i in paid_list)
                )
                invoice_summary["outstanding"] = (
                    invoice_summary["total_invoiced"] - invoice_summary["total_paid"]
                )

                for inv in inv_qs[:10]:
                    recent_invoices.append({
                        "id": inv.id,
                        "invoice_number": getattr(inv, "invoice_number", f"INV-{inv.id:04d}"),
                        "customer_name": getattr(inv.customer, "name", "") if hasattr(inv, "customer") else "",
                        "status": getattr(inv, "status", "draft"),
                        "total_amount": float(getattr(inv, "total_amount", 0) or 0),
                        "currency": getattr(inv, "currency", "KES"),
                        "due_date": str(inv.due_date) if getattr(inv, "due_date", None) else None,
                        "created_at": inv.created_at.isoformat() if hasattr(inv, "created_at") else None,
                    })
            except Exception:
                pass

        return Response({
            "period": {
                "today": today.isoformat(),
                "month_start": month_start.isoformat(),
                "year_start": year_start.isoformat(),
            },
            "transactions": tx_totals,
            "invoices": invoice_summary,
            "recent_invoices": recent_invoices,
        })


class AccountingLedgerView(APIView):
    """
    GET /api/accounting/ledger/

    Stub endpoint for journal entry / ledger integration.
    Will be powered by Platform_Core accounting engine.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "message": "Accounting ledger engine not yet connected. "
                       "This endpoint will expose journal entries, "
                       "chart of accounts, and posting records once the "
                       "Platform_Core accounting module is activated.",
            "entries": [],
            "chart_of_accounts": [],
        })
