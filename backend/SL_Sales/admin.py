from django.contrib import admin
from .models import Product, Estimate, EstimateLineItem, RecurringInvoice, RecurringInvoiceLineItem

admin.site.register(Product)
admin.site.register(Estimate)
admin.site.register(EstimateLineItem)
admin.site.register(RecurringInvoice)
admin.site.register(RecurringInvoiceLineItem)
