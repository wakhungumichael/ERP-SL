from django.contrib import admin
from .models import PayPeriod, PayRecord

class PayRecordInline(admin.TabularInline):
    model = PayRecord
    extra = 0

@admin.register(PayPeriod)
class PayPeriodAdmin(admin.ModelAdmin):
    list_display = ["name", "period_start", "period_end", "status"]
    inlines = [PayRecordInline]

@admin.register(PayRecord)
class PayRecordAdmin(admin.ModelAdmin):
    list_display = ["employee", "period", "basic_pay", "allowances", "deductions", "net_pay"]
    list_filter = ["period"]
