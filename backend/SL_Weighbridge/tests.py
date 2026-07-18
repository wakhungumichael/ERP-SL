#Author : Michael Wakhungu
#Company: Siakora Labs Limited

#IMPORTS
from django.core.files.storage import FileSystemStorage
from .models import (Company, Branch, PrinterConfig, IndicatorConfig, Customer, VehicleType,
                     Vehicle, Currency, Item, Transaction, VehiclePresence, DiscrepancyReport, ConfigurationFile)
from SL_Weighbridge.utils import capture_weight_from_indicator, print_receipt, get_printer_command
from .management.commands.printer_commands import get_printer_command
from .models import CameraConfig
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.models import User, Group
from django.urls import path, reverse
from django.http import HttpResponseRedirect, JsonResponse
from django.utils.html import format_html
from django.contrib import admin
from SL_Weighbridge.models import Transaction, IndicatorConfig
from SL_Weighbridge.utils import capture_weight_from_indicator
from reportlab.lib.units import inch
from PIL import Image, ImageDraw, ImageFont
from django.http import HttpResponse
from PIL import Image
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from io import BytesIO
import qrcode
import datetime
from django.utils.html import format_html
from .utils import capture_weight_for_transaction  # Ensure this is imported
from django.contrib.auth.models import User  # Import if you need to reference the User model
import csv
from django.http import HttpResponse
from django.utils.timezone import localtime
from datetime import datetime
from django.utils.html import format_html
from django.core.exceptions import ValidationError
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.shortcuts import redirect
from .models import Transaction  # Ensure you import your Transaction model
    
from django.shortcuts import redirect
from .models import Transaction  # Make sure to import your Transaction model

from django.utils.safestring import mark_safe
from django.contrib import admin
from .models import Transaction, Invoice
from django.utils import timezone
from datetime import timedelta
from decimal import Decimal
from django.utils.timezone import now

# Ensure you have the correct import at the top
from datetime import datetime  # Or import datetime module as shown above


from django.contrib import admin
from import_export import resources
from import_export.admin import ImportExportModelAdmin
from .models import Transaction

from django.contrib import admin, messages
from django.utils import timezone

from django import forms
from django.contrib import admin
from django.utils.safestring import mark_safe
from django.urls import path
from django.http import JsonResponse
from .models import Transaction
from .utils import capture_weight_for_transaction
from django.forms.models import model_to_dict





# unregister - User,Group
admin.site.unregister(User)
admin.site.unregister(Group)


# User
@admin.register(User)
class UserAdmin(BaseUserAdmin, UnfoldModelAdmin):
    pass

# Group

@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, UnfoldModelAdmin):
    pass





class TransactionResource(resources.ModelResource):
    class Meta:
        model = Transaction
        fields = ('id', 'branch', 'customer', 'vehicle', 'operator', 'item', 'vehicle_type', 'gross_weight',
                  'tare_weight', 'net_weight', 'status', 'manual_weight_capture', 'discounted', 'weight_date', 'charge', 'weight_type')
        export_order = ('id', 'branch', 'customer', 'vehicle', 'operator', 'item', 'vehicle_type', 'gross_weight',
                        'tare_weight', 'net_weight', 'status', 'manual_weight_capture', 'discounted', 'weight_date', 'charge', 'weight_type')



class TransactionAdminForm(forms.ModelForm):
    class Meta:
        model = Transaction
        fields = '__all__'  # Or list specific fields

    def clean(self):
        cleaned_data = super().clean()
        manual_weight_capture = cleaned_data.get("manual_weight_capture")
        weight_reason = cleaned_data.get("weight_reason")
        manual_receipt = cleaned_data.get("manual_receipt")

        if manual_weight_capture:
            if not weight_reason:
                self.add_error('weight_reason', 'This field is required when manual weight capture is enabled.')
            if not manual_receipt:
                self.add_error('manual_receipt', 'This field is required when manual weight capture is enabled.')

        return cleaned_data





# Transaction

@admin.register(Transaction)
class TransactionAdmin(UnfoldModelAdmin) :


    # Read Only Logic

     #readonly_fields = ['gross_weight', 'tare_weight', 'net_weight', 'branch']


    change_form_template = "admin/custom_change_form.html"

    actions = ['approve_pending_transactions', 'capture_weight', 'download_lx350', 'export_as_csv','generate_invoices','mark_as_paid']


    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('get-weight/', self.admin_site.admin_view(self.get_weight), name='get_weight'),
        ]
        return custom_urls + urls

    def get_weight(self, request):
        # Here you can add your logic to fetch the weight from the API
        weight_data = self.fetch_weight_from_api()  # Implement this method
        return JsonResponse({'weight': weight_data})

    def fetch_weight_from_api(self):
        # Example API call - adjust this according to your actual API
        import requests

        try:
            response = requests.get("http://172.29.45.173:8083/SL_weighbridge/api/get_weight/")  # Replace with your API endpoint
            response.raise_for_status()
            return response.json().get('weight', 0)  # Adjust according to your API response
        except requests.exceptions.RequestException as e:
            return 0  # Handle the error as appropriate





    # Define autocomplete fields and fieldsets
    autocomplete_fields = [ 'customer','vehicle']

    change_form_template = "admin/transaction_change_form.html"

    fieldsets = (
        ('General Information', {
            'fields': (
                ('vehicle','weight_type', 'customer'),
                'manual_weight_capture',
                'gross_weight', 'tare_weight',  # Original field names for saving
                'weight_reason',  # New field for reason
                'manual_receipt',  # New field for manual receipt upload
            )
        }),
        ('Other Details', {
            'fields': (
                ('vehicle_type', 'operator', 'item', 'destination'),
            )
        }),
        ('Payment Details', {
            'fields': (
                ('payment_mode', 'payment_status'),
                
            )
        }),
    )

    # List display options
    list_display = (
        'No', 'customer', 'vehicle_type', 'get_vehicle_number_plate',
        'first_weight', 'second_weight', 'varience_weight', 'status','type_weight',
        'first_weight_date', 'second_weight_date', 'charge', 'payment_mode',
        'payment_status', 'destination', 'invoiced', 'item', 'operator_driver',
         'teller'
    )

    list_per_page = 5  # Limit items displayed per page

    def No(self, obj):
        return obj.id  # Custom numbering logic

    No.admin_order_field = 'id'
    No.short_description = 'SNo'

    def get_vehicle_number_plate(self, obj):
        return obj.vehicle.number_plate  # Access the number_plate from the Vehicle model

    get_vehicle_number_plate.admin_order_field = 'vehicle__number_plate'
    get_vehicle_number_plate.short_description = 'Vehicle No'

    def type_weight(self, obj):
        return obj.weight_type
    type_weight.admin_order_field = 'weight_type'
    type_weight.short_description = "Weight"

    def first_weight(self, obj):
        return obj.gross_weight
    first_weight.admin_order_field = 'gross_weight'
    first_weight.short_description = "First (kg)"

    def second_weight(self, obj):
        return obj.tare_weight
    second_weight.admin_order_field = 'tare_weight'
    second_weight.short_description = "Second (kg)"

    def varience_weight(self, obj):
        return obj.net_weight
    varience_weight.admin_order_field = 'net_weight'
    varience_weight.short_description = "Variance (kg)"

    def first_weight_date(self, obj):
        return obj.gross_weight_date
    first_weight_date.admin_order_field = 'gross_weight_date'
    first_weight_date.short_description = "First Weight Date"

    def second_weight_date(self, obj):
        return obj.tare_weight_date
    second_weight_date.admin_order_field = 'tare_weight_date'
    second_weight_date.short_description = "Second Weight Date"

    def operator_driver(self, obj):
        return obj.operator
    operator_driver.admin_order_field = 'operator'
    operator_driver.short_description = "Driver/Operator"

    def teller(self, obj):
        return obj.created_by
    teller.admin_order_field = 'created_by'
    teller.short_description = "Teller"

    # JavaScript for toggling weight fields
    def render_change_form(self, request, context, *args, **kwargs):
        context['inline_js'] = mark_safe("""
           <script type="text/javascript">
            document.addEventListener("DOMContentLoaded", function() {
                // Get the manual_weight_capture checkbox, gross_weight, tare_weight, weight_reason, and manual_receipt fields
                const manualWeightCheckbox = document.querySelector("#id_manual_weight_capture");
                const grossWeightField = document.querySelector(".field-gross_weight");
                const tareWeightField = document.querySelector(".field-tare_weight");
                const weightReasonField = document.querySelector(".field-weight_reason");
                const manualReceiptField = document.querySelector(".field-manual_receipt");

                // Define a function to toggle the visibility of the fields
                function toggleWeightFields() {
                    const shouldShow = manualWeightCheckbox.checked; // Check if the checkbox is checked

                    // Toggle visibility based on the checkbox state
                    grossWeightField.style.display = shouldShow ? "block" : "none";
                    tareWeightField.style.display = shouldShow ? "block" : "none";
                    weightReasonField.style.display = shouldShow ? "block" : "none";
                    manualReceiptField.style.display = shouldShow ? "block" : "none";
                }

                // Run the toggle function on load and on checkbox change
                toggleWeightFields(); // Initial run
                manualWeightCheckbox.addEventListener("change", toggleWeightFields); // Event listener for changes
            });
        </script>
    """)
    
    # Optional: Add CSS to initially hide fields
        context['inline_css'] = mark_safe("""
        <style>
            .field-weight_reason,
            .field-manual_receipt {
                display: none; /* Initially hide these fields */
            }
        </style>
    """)

        return super().render_change_form(request, context, *args, **kwargs)

    # Custom URL for capturing weight
    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('capture-weight/', self.capture_weight_for_single_transaction, name='capture-weight'),
        ]
        return custom_urls + urls

    def capture_weight_for_single_transaction(self, request):
        transaction_id = request.GET.get('transaction_id')
        try:
            transaction = Transaction.objects.get(pk=transaction_id)
            result_message = capture_weight_for_transaction(transaction)

            if "Captured" in result_message:
                transaction.status = 'Completed'
                transaction.save()
                return JsonResponse({"message": result_message})
            else:
                return JsonResponse({"error": result_message}, status=400)

        except Transaction.DoesNotExist:
            return JsonResponse({"error": "Transaction not found."}, status=404)

    # Media class for including custom JS and CSS
    class Media:
        css = {
            'all': ('admin/custom_styles.css',),  # Custom CSS
        }
        js = ('admin/custom_script.js', 'admin/js/manual_weight_toggle.js')  # Custom JS

    # Optional: if you want to mark headers as resizable
    def change_view(self, request, object_id, form_url='', extra_context=None):
        extra_context = extra_context or {}
        extra_context['resizable'] = True  # Context for JavaScript
        return super().change_view(request, object_id, form_url, extra_context=extra_context)



    search_fields = ('status','operator','item__name','customer__name','payment_status','payment_mode', 'vehicle__vehicle_type__name','vehicle__number_plate','destination')


    list_filter = (('weight_date', admin.DateFieldListFilter),'payment_mode','payment_status','invoiced','created_by','status','weight_type','vehicle_type')
    #actions = ['capture_weight', 'download_lx350','export_as_csv']


   # actions = ['capture_weight', 'download_lx350', 'download_zebra_zq220', 'export_as_csv']
   

    def has_export_permission(self, request):
        """
           Allow export permission only if the user is a superuser or belongs to 'Owner' or 'Operations' groups.
           """
        if request.user.is_superuser:
            return True
        allowed_groups = ['Owner', 'Operations']
        if request.user.groups.filter(name__in=allowed_groups).exists():
            return True
        return False

    def get_actions(self, request):
        """
           Filter the available actions based on the user's permissions.
           """
        actions = super().get_actions(request)
        # Remove the 'export_as_csv' action if the user doesn't have the required permissions
        if not self.has_export_permission(request):
            actions.pop('export_as_csv', None)
        return actions
    



    def capture_weight(self, request, queryset):
     for transaction in queryset:
        if transaction.status == 'Completed':
            self.message_user(
                request, f"Transaction {transaction.id} is already completed and locked.", level=messages.WARNING
            )
            continue  # Skip this transaction if it's already completed

        # Use the utility function to capture weight and update the transaction
        result_message = capture_weight_for_transaction(transaction)
        
        if "Captured" in result_message:
            self.message_user(request, f"Transaction {transaction.id}: {result_message}")
            transaction.status = 'Completed'
            transaction.save()
        else:
            self.message_user(request, result_message, level=messages.ERROR)

    capture_weight.short_description = "Capture Weight"

     

    # Conditionally set readonly fields based on transaction status
    def get_readonly_fields(self, request, obj=None):
        if obj and obj.status == 'Completed':
            # If the transaction is completed, make all fields read-only
            return [field.name for field in self.model._meta.fields]
        else:
            # Allow editing when the status is pending or other values
            return super().get_readonly_fields(request, obj)


    def save_model(self, request, obj, form, change):
        """
        Save a transaction with specific logic for First Weight and Second Weight cases.
        """
        # Set the user who created or modified the transaction
        if not change:
            obj.created_by = request.user
        obj.last_modified_by = request.user

        # Handle "First Weight" case
        if obj.weight_type == "First Weight":
            # Ensure net weight and tare weight are set to 0 for "First Weight"
            obj.net_weight = 0
            obj.tare_weight = 0  # Optional: You can set to None if no value is expected
        else:
            # Automatically calculate net weight for "Second Weight"
            obj.calculate_net_weight()

            # Pair the "Second Weight" with a "First Weight" transaction if applicable
            if obj.weight_type == "Second Weight":
                recent_transaction = Transaction.objects.filter(
                    vehicle=obj.vehicle,
                    weight_type="First Weight",
                    paired=False,
                    gross_weight__isnull=False
                ).order_by('-gross_weight_date').first()

                if recent_transaction:
                    # Mark the "First Weight" transaction as paired
                    recent_transaction.paired = True
                    recent_transaction.save()

                    # Use the previous gross weight for net weight calculation
                    obj.gross_weight = recent_transaction.gross_weight
                    obj.net_weight = abs(obj.gross_weight - obj.tare_weight)
                    obj.gross_weight_date = recent_transaction.gross_weight_date

        # Handle manual weight capture case
        if obj.manual_weight_capture:
            if obj.gross_weight is None or obj.tare_weight is None:
                messages.warning(
                    request,
                    "Manual weight capture is enabled, but weights are not filled."
                )

        # Call the super method to save the transaction
        super().save_model(request, obj, form, change)



    #def get_form(self, request, obj=None, **kwargs):
       # """
       # Customize the form for adding a new transaction, prepopulating fields for 'Second Weight'.
       # """
        #form = super().get_form(request, obj, **kwargs)

        #if request.method == "GET" and 'vehicle' in request.GET:
          #  vehicle = request.GET.get('vehicle')
         #   weight_type = request.GET.get('weight_type')

          #  if vehicle and weight_type == "Second Weight":
                # Check for an unpaired "First Weight" transaction within the last 3 days
          #      recent_transaction = Transaction.objects.filter(
           #         vehicle=vehicle,
           #         weight_type="First Weight",
            #        paired=False,
            #        gross_weight__isnull=False,
             #       gross_weight_date__gte=now() - timedelta(days=3)
            #    ).order_by('-gross_weight_date').first()

               # if recent_transaction:
                    # Exclude specific fields from prepopulating
                 #   excluded_fields = [
                 #       'updated_at', 'created_at', 'created_by', 'weight_date',
                 #       'manual_weight_capture', 'weight_reason', 'manual_receipt',
                #        'invoiced', 'payment_status', 'payment_mode', 'status'
                #    ]
               #     initial_data = model_to_dict(recent_transaction, exclude=excluded_fields)
           #         initial_data['weight_type'] = "Second Weight"  # Override weight type

                    # Prepopulate form fields
           #         for field, value in initial_data.items():
           #             if field in form.base_fields:
         #                   form.base_fields[field].initial = value

      #  return form




    @staticmethod
    def get_transaction_data(request, vehicle_id):
        if not vehicle_id:
            return JsonResponse({'error': 'Vehicle ID is required.'}, status=400)

        # Fetch the most recent transaction for the vehicle
        transaction = Transaction.objects.filter(
            vehicle_id=vehicle_id,
            weight_type="First Weight",
            paired=False,
            gross_weight__isnull=False,
            gross_weight_date__gte=now() - timedelta(days=3)
        ).order_by('-gross_weight_date').first()

        if not transaction:
            return JsonResponse({'error': 'No recent transaction found.'}, status=404)

        # Convert the transaction to a dictionary and exclude specific fields
        data = model_to_dict(transaction, exclude=[
            'id', 'updated_at', 'created_at', 'created_by',
            'manual_weight_capture', 'weight_reason', 'manual_receipt',
            'status'
        ])

        return JsonResponse(data)




    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)

        if request.method == "GET" and 'vehicle' in request.GET:
            # Get vehicle and weight_type from the GET parameters
            vehicle_id = request.GET.get('vehicle')
            weight_type = request.GET.get('weight_type')

            if vehicle_id and weight_type == "Second Weight":
                # Fetch recent transaction for pre-population
                recent_transaction = Transaction.objects.filter(
                    vehicle_id=vehicle_id,
                    weight_type="First Weight",
                    paired=False,
                    gross_weight__isnull=False,
                    gross_weight_date__gte=now() - timedelta(days=3)
                ).order_by('-gross_weight_date').first()

                if recent_transaction:
                    initial_data = model_to_dict(recent_transaction, exclude=[
                        'id', 'updated_at', 'created_at', 'created_by', 
                        'manual_weight_capture', 'weight_reason', 'manual_receipt',
                        'status'
                    ])
                    form.base_fields['customer'].initial = initial_data.get('customer')
                    form.base_fields['gross_weight'].initial = initial_data.get('gross_weight')
                    form.base_fields['item'].initial = initial_data.get('item')
                    form.base_fields['vehicle_type'].initial = initial_data.get('vehicle_type')

        return form




    def add_view(self, request, *args, **kwargs):
        """
        Add a new transaction with specific validation logic for Second Weight.
        """
        if request.method == "POST":
            # Get vehicle and weight_type from the form
            vehicle = request.POST.get('vehicle')
            weight_type = request.POST.get('weight_type')

            if vehicle:
                # Check for any 'Pending' transaction for the same vehicle
                pending_transaction = Transaction.objects.filter(vehicle=vehicle, status='Pending').exists()
                if pending_transaction:
                    # Show a user-friendly error message
                    messages.error(
                        request,
                        f"A transaction for vehicle {vehicle} is already pending. Please complete it before adding a new one."
                    )
                    # Redirect back to the add form without saving
                    return redirect(request.path)

                    
                    
            # Initialize recent_transaction to None
                recent_transaction = None

                # Check for "Second Weight" specific rules
                if weight_type == "Second Weight":
                    # Check for an unpaired "First Weight" transaction within the last 3 days
                    recent_transaction = Transaction.objects.filter(
                        vehicle=vehicle,
                        weight_type="First Weight",
                        paired=False,
                        gross_weight__isnull=False,
                        gross_weight_date__gte=now() - timedelta(days=3)
                    ).order_by('-gross_weight_date').first()

                    if not recent_transaction:
                        # Show an error message and prevent adding a new "Second Weight" transaction
                        messages.error(
                            request,
                            "Previous gross weight not found for this vehicle within the last 3 days. Transaction not saved."
                        )
                        # Redirect back to the add form without saving
                        return redirect(request.path)
                    
                    
                # Prepopulate fields with the "First Weight" transaction data
                excluded_fields = [
                    'updated_at', 'created_at', 'created_by', 'weight_date', 
                    'manual_weight_capture', 'weight_reason', 'manual_receipt', 
                     'status'
                ]
                # Safely use recent_transaction for prepopulation
                if recent_transaction:
                    initial_data = model_to_dict(recent_transaction, exclude=excluded_fields)
                    initial_data['weight_type'] = 'Second Weight'  # Override weight type
                    initial_data['customer'] = recent_transaction.customer.id  # Use the customer ID

                    # Make POST mutable and populate it with the initial data
                    request.POST = request.POST.copy()  # Make POST mutable
                    initial_data.pop('id')  # Remove the ID to prevent duplication
                    for key, value in initial_data.items():
                        if key in request.POST and not request.POST[key]:
                            request.POST[key] = value



            # If no issues, proceed with adding the transaction
            return super().add_view(request, *args, **kwargs)
        

        # Default behavior for GET requests
        return super().add_view(request, *args, **kwargs)






    @admin.action(description="Approve Transactions")
    def approve_pending_transactions(self, request, queryset):
        # Check if the user has the required permission
        if not request.user.has_perm('SL_Weighbridge.can_approve_transaction'):
            self.message_user(request, "You do not have permission to approve transactions.", level=messages.ERROR)
            return

        # Process the transactions for approval
        for transaction in queryset:
            if transaction.status == 'Pending' and transaction.manual_weight_capture:
                # Set the transaction status to 'Completed'
                transaction.status = 'Completed'

                # Update date fields based on weight type
                if transaction.weight_type == 'First Weight':
                    transaction.gross_weight_date = transaction.weight_date
                    transaction.net_weight = 0  # Ensure net weight is 0 for "First Weight"
                elif transaction.weight_type == 'Second Weight':
                    transaction.tare_weight_date = transaction.weight_date
                    

                # Save the transaction with the updated status and dates
                transaction.save()
                self.message_user(request, f"Transaction {transaction.id} has been approved and marked as completed.")
            else:
                self.message_user(
                    request,
                    f"Transaction {transaction.id} does not meet the conditions for approval.",
                    level=messages.WARNING
                )

    def get_actions(self, request):
        actions = super().get_actions(request)

        # Check if the user has the required permission
        if not request.user.has_perm('SL_Weighbridge.can_approve_transaction'):
            if 'approve_pending_transactions' in actions:
                del actions['approve_pending_transactions']

        return actions
    


    @admin.action(description="Recall Transactions")
    def recall_completed_transactions(self, request, queryset):
        # Check if the user has the required permission
        if not request.user.has_perm('SL_Weighbridge.can_recall_transaction'):
            self.message_user(request, "You do not have permission to recall transactions.", level=messages.ERROR)
            return

        # Process the transactions for approval
        for transaction in queryset:
            if transaction.status == 'Completed':
                # Set the transaction status to 'Completed'
                transaction.status = 'Pending'

                # Update date fields based on weight type
                #if transaction.weight_type == 'First Weight':
                    #transaction.gross_weight_date = transaction.weight_date
                   # transaction.net_weight = 0  # Ensure net weight is 0 for "First Weight"
                #elif transaction.weight_type == 'Second Weight':
                    #transaction.tare_weight_date = transaction.weight_date
                    

                # Save the transaction with the updated status and dates
                transaction.save()
                self.message_user(request, f"Transaction {transaction.id} has been recalled and marked as Pending.")
            else:
                self.message_user(
                    request,
                    f"Transaction {transaction.id} does not meet the conditions for recall.",
                    level=messages.WARNING
                )

    def get_actions(self, request):
        actions = super().get_actions(request)

        # Check if the user has the required permission
        if not request.user.has_perm('SL_Weighbridge.can_recall_transaction'):
            if 'recall_completed_transactions' in actions:
                del actions['recall_completed_transactions']

        return actions






    # Format receipt data including QR code generation
    def format_receipt(self, transaction):
        receipt_data = f"""
            METRIX WEIGHBRIDGE SERVICES
            Athi River, Machakos
            Customer Name: {transaction.customer.name}
            Weighing Type: {transaction.weight_type}
            Vehicle No: {transaction.vehicle.number_plate}
            Gross Weight (kg): {transaction.gross_weight}
            Tare Weight (kg): {transaction.tare_weight}
            Net Weight (kg): {transaction.net_weight}
        """

        # QR Code generation
        qr_data = f"Transaction ID: {transaction.id}\nNet Weight: {transaction.net_weight}"
        qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=5, border=4)
        qr.add_data(qr_data)
        qr.make(fit=True)
        qr_img = qr.make_image(fill='black', back_color='white')

        qr_io = BytesIO()
        qr_img.save(qr_io, 'PNG')
        qr_code_path = f"qrcodes/transaction_{transaction.id}.png"
        FileSystemStorage().save(qr_code_path, qr_io)

        receipt_data += f"\nQR Code: {qr_code_path}"

        return receipt_data, qr_io

    # Action to print receipts
    def print_receipt(self, request, queryset):
        for transaction in queryset:
            printer_config = PrinterConfig.objects.filter(is_active=True).first()
            if not printer_config:
                self.message_user(request, "No active printer found.", level='error')
                return

            receipt_data, _ = self.format_receipt(transaction)
            command = get_printer_command(printer_config, transaction)

            if command:
                print_receipt(command)
                self.message_user(request, f"Receipt printed for transaction {transaction.id}")
            else:
                self.message_user(request, "Failed to generate printer command.", level='error')

    # Overriding save_model to automatically calculate net weight
    #def save_model(self, request, obj, form, change):
      #  obj.calculate_net_weight()
       # super().save_model(request, obj, form, change)




    @admin.action(description="Download Receipt")

    def download_lx350(self, request, queryset):
        from datetime import datetime

        """Download receipts for LX-350 printer, formatted for half A4 page in landscape mode with minimal space."""
        buffer = BytesIO()

        # Set page size to half of A4, landscape orientation, with minimal margins
        doc = SimpleDocTemplate(buffer, pagesize=landscape((A4[0], A4[1] / 2)),
                                leftMargin=3, rightMargin=5, topMargin=0, bottomMargin=2)  # Top margin set to 0

        elements = []

        # Define styles
        styles = getSampleStyleSheet()

        # Define left-aligned style with slight right shift
        left_style = ParagraphStyle(
            'LeftShiftedBold',
            parent=styles['Normal'],
            fontName='Courier-Bold',
            fontSize=13,
            alignment=0,  # Left alignment
            leftIndent=40,  # Indent from the left
            spaceAfter=5  # Reduced space after each paragraph
        )

        # Define center-aligned, bold style for the header
        header_style = ParagraphStyle(
            'CenteredBold',
            parent=styles['Normal'],
            fontName='Courier-Bold',
            fontSize=13,
            alignment=1,  # Center alignment
            spaceAfter=5  # Remove space after the header
        )

        # Header for the document with no extra line breaks
        header_data = """
        METRIX WEIGHBRIDGE SERVICES<br/>
        Athi River, Machakos<br/>
        Tel: 0715 488 903<br/>
        Email: info@metrixws.co.ke<br/>
        Website: www.metrixws.co.ke
        """
        header_paragraph = Paragraph(header_data.replace('\n', '<br/>'), header_style)
        elements.append(header_paragraph)

        for transaction in queryset:
            customer_name = transaction.customer.name
            vehicle_no = transaction.vehicle.number_plate
            gross_weight = transaction.gross_weight
            tare_weight = transaction.tare_weight
            net_weight = transaction.net_weight
            charge = transaction.charge
            item = transaction.item.name

            # Format date for both display and filename
            # Get current date and time only within this method
            date_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')  # Current date and time for display
            date_for_filename = datetime.now().strftime('%Y-%m-%d')  # C

            # Arrange transaction data in two rows, using a Table for better formatting
            table_data = [
                ['Customer:', customer_name, 'Item:', item],
                ['Date:', date_str, 'Vehicle No:', vehicle_no],
                ['First(kg) ', gross_weight, 'Second (kg)  ',    tare_weight],
                ['Variance(kg) ', net_weight, 'Charges(KES) ', charge]
            ]

            table = Table(table_data, colWidths=[90, 150, 90, 150])  # Adjust column widths

            # Add a table style to align to the left, with some padding
            table.setStyle(TableStyle([
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('LEFTPADDING', (0, 0), (-1, -1), 40),
                ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
                ('FONTSIZE', (0, 0), (-1, -1), 11),
                ('FONTNAME', (0, 0), (-1, -1), 'Courier-Bold'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('RIGHTPADDING', (2, 2), (2, 2), 20),  # Add right padding to create space after (kg)

            ]))

            elements.append(table)

            # Generate QR code based on transaction details
            qr_data = f"Customer: {customer_name}, Vehicle: {vehicle_no}, Gross: {gross_weight}, Net: {net_weight}, Date: {date_str}"
            qr = qrcode.make(qr_data)
            qr_buffer = BytesIO()
            qr.save(qr_buffer, format="PNG")
            qr_buffer.seek(0)

            # Add QR code below the table
            qr_img = Image(qr_buffer, 1.2 * inch, 1.2 * inch)  # This should now work
            qr_img.hAlign = 'CENTER'
            elements.append(qr_img)

        # Build the PDF document
        doc.build(elements)

        buffer.seek(0)

        # Use vehicle number and date for the filename
        filename = f"lx350_receipt_{vehicle_no}_{date_for_filename}.pdf"

        # Set Content-Disposition with dynamic filename
        response = HttpResponse(buffer, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'

        return response

    #ZPL
 

    @admin.action(description="Zdesign-ZQ220 Receipt")
    def download_zebra_zq220(self, request, queryset):
        """Download image receipt for Zebra ZQ220 printer, moved slightly to the right"""
        for transaction in queryset:
            # Create a blank white image (width: 400px, height: dynamic)
            img_width = 400
            img_height = 600  # Adjust height as needed
            img = Image.new('RGB', (img_width, img_height), color='white')

            # Initialize drawing context
            draw = ImageDraw.Draw(img)

            # Load a font
            font = ImageFont.load_default()  # You can load a TTF font with a specific size if needed

            # Offset for moving content to the right
            x_offset = 50  # Adjust this to move the content further to the right

            # Customer and vehicle details
            customer_name = transaction.customer.name
            vehicle_no = transaction.vehicle.number_plate
            gross_weight = transaction.gross_weight
            tare_weight = transaction.tare_weight
            net_weight = transaction.net_weight
            charge = transaction.charge
            #date = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            date_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')  # Current date and time for display


            # Set initial y position for text
            y_pos = 10

            # Draw header, moved slightly to the right
            draw.text((x_offset, y_pos), "METRIX WEIGHBRIDGE SERVICES", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), "Athi River, Machakos", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), "Tel: 0715 488 903", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), "Email: info@metrixws.co.ke", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), "Website: www.metrixws.co.ke", font=font, fill='black')

            # Separator, moved slightly to the right
            y_pos += 30
            draw.line((x_offset, y_pos, img_width - 10, y_pos), fill="black", width=1)
            y_pos += 10

            # Draw customer and vehicle details, moved slightly to the right
            draw.text((x_offset, y_pos), f"Customer Name: {customer_name}", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), f"Vehicle No: {vehicle_no}", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), f"Date: {date_str}", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), f"Gross Weight (kg): {gross_weight}", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), f"Tare Weight (kg): {tare_weight}", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), f"Net Weight (kg): {net_weight}", font=font, fill='black')
            y_pos += 20
            draw.text((x_offset, y_pos), f"charges (KES): {charge}", font=font, fill='black')

            # Separator, moved slightly to the right
            y_pos += 30
            draw.line((x_offset, y_pos, img_width - 10, y_pos), fill="black", width=1)
            y_pos += 10

            # Generate QR code
            qr_data = f"Customer: {customer_name}, Vehicle: {vehicle_no}, Gross: {gross_weight}, Net: {net_weight}, Date: {date_str}"
            qr = qrcode.make(qr_data)

            # Resize QR code and paste it onto the image, keeping it horizontally centered
            qr_size = 100
            qr = qr.resize((qr_size, qr_size))
            img.paste(qr, (int((img_width - qr_size) / 2), y_pos))

            # Save the image to a BytesIO object for downloading
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            buffer.seek(0)

            # Return the image as an HTTP response
            response = HttpResponse(buffer, content_type='image/png')
            response['Content-Disposition'] = f'attachment; filename="Zdesigner_zq220_receipt_{transaction.id}.png"'

            return response



    # Action to generate consolidated invoices for customers with pending debts
# Action to generate consolidated invoices for customers with pending debts
    @admin.action(description="Generate Invoices")

    def generate_invoices(self, request, queryset):
    # Filter transactions that are in debt, have "Pending" payment status, and are not invoiced
         transactions_to_invoice = queryset.filter(payment_mode='Debt', payment_status='Pending', invoiced=False)

    # Group transactions by customer
         transactions_by_customer = {}
         for transaction in transactions_to_invoice:
            customer = transaction.customer
            if customer not in transactions_by_customer:
               transactions_by_customer[customer] = []
            transactions_by_customer[customer].append(transaction)

    # Create an invoice for each customer
            invoice_count = 0
            for customer, transactions in transactions_by_customer.items():
        # Consolidate total amount for all transactions of this customer
                total_amount = sum(Decimal(transaction.charge) for transaction in transactions)  # Convert charge to Decimal

        # Generate a unique invoice number
                invoice_number = f"INV-{timezone.now().strftime('%Y%m%d%H%M%S')}"
 
        # Set the due date to 30 days from now
                due_date = timezone.now() + timezone.timedelta(days=30)

        # Create the invoice record
                invoice = Invoice.objects.create(
                    customer=customer,
                    invoice_number=invoice_number,
                    total_amount=total_amount,
                    due_date=due_date
        )

        # Add the selected transactions to the invoice's ManyToMany relationship
                invoice.transactions.set(transactions)  # This sets the selected transactions for this invoice

        # Mark all transactions for this customer as invoiced
                for transaction in transactions:
                    transaction.invoiced = True
                    transaction.save()

                    invoice_count += 1

    # Provide feedback in the Django admin
            self.message_user(request, f"{invoice_count} invoices have been generated.")
    generate_invoices.short_description = "Generate Invoices"
    actions = ['generate_invoices']


    def mark_as_paid(self, request, queryset):
        transactions_to_pay = queryset.filter(payment_status='Pending', invoiced=True)
        for transaction in transactions_to_pay:
            transaction.payment_status = 'Paid'
            transaction.save()

        self.message_user(request, f"{transactions_to_pay.count()} transactions have been marked as Paid.")
    mark_as_paid.short_description = "Mark Selected Transactions as Paid"


    #actions = ['approve_pending_transactions', 'capture_weight', 'download_lx350', 'export_as_csv','generate_invoices','mark_as_paid']

    actions = ['approve_pending_transactions','recall_completed_transactions', 'capture_weight', 'download_lx350', 'export_as_csv']



#Export CSV



    @admin.action(description="Export to CSV")
    def export_as_csv(self, request, queryset):
        # Check if the user has the required permission
        if not request.user.has_perm('SL_Weighbridge.can_export_transaction'):
            self.message_user(request, "You do not have permission to export transactions.", level=messages.ERROR)
            return HttpResponse(status=403)

        # Get the current date to include in the filename
        current_date = datetime.now().strftime('%Y-%m-%d')
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="Metrixws_transactions_{current_date}.csv"'

        writer = csv.writer(response)

        # Write the CSV header
        writer.writerow([
            'No', 'Date', 'Time', 'Customer Name', 'Vehicle No Plate', 'Vehicle Type', 'Item', 'Weight Type',
            'First Weight', 'Second Weight', 'Variance Weight', 'Charges', 'Payment Mode', 'Payment Status', 
            'Invoiced', 'First Weight Date', 'First Weight Time',
            'Second Weight Date', 'Second Weight Time', 'Driver/Operator', 'Teller', 'Destination'
        ])

        # Write data rows with date and time split
        for transaction in queryset:
            weight_date = localtime(transaction.weight_date).date() if transaction.weight_date else ''
            weight_time = localtime(transaction.weight_date).strftime('%I:%M %p') if transaction.weight_date else ''

            gross_weight_date = localtime(transaction.gross_weight_date).date() if transaction.gross_weight_date else ''
            gross_weight_time = localtime(transaction.gross_weight_date).strftime('%I:%M %p') if transaction.gross_weight_date else ''

            tare_weight_date = localtime(transaction.tare_weight_date).date() if transaction.tare_weight_date else ''
            tare_weight_time = localtime(transaction.tare_weight_date).strftime('%I:%M %p') if transaction.tare_weight_date else ''

            writer.writerow([
                transaction.id,
                weight_date,
                weight_time,
                transaction.customer.name,
                transaction.vehicle.number_plate,
                transaction.vehicle_type.name,
                transaction.item.name,
                transaction.weight_type,
                transaction.gross_weight,
                transaction.tare_weight,
                transaction.net_weight,
                transaction.charge,
                transaction.payment_mode,
                transaction.payment_status,
                transaction.invoiced,
                gross_weight_date,
                gross_weight_time,
                tare_weight_date,
                tare_weight_time,
                transaction.operator,
                transaction.created_by,
                transaction.destination
            ])

        return response

    def get_actions(self, request):
        actions = super().get_actions(request)

        # Check if the user has the required permission
        if not request.user.has_perm('SL_Weighbridge.can_export_transaction'):
            if 'export_as_csv' in actions:
                del actions['export_as_csv']

        return actions
    





from django.utils.html import format_html
from django.contrib import admin
from .models import VehiclePresence

from django.utils.html import format_html

@admin.register(VehiclePresence)
class VehiclePresenceAdmin(UnfoldModelAdmin):
    fieldsets = (
        ('Captured Information', {
            'fields': ('timestamp', 'detected_weight', 'image_display','locked')
        }),
    )

    

    # Display image and other fields in the list view
    list_display = ('weight_date', 'detected_weight', 'image_tag')




    def weight_date(self, obj):
        return obj.timestamp
    weight_date.short_description = "Date & Time"  # Short label for gross_weight


    def image_tag(self, obj):
        return obj.image_tag
    image_tag.short_description = "Vehicle"  # Short label for gross_weight

    # Filter and search capabilities
    list_filter = ('timestamp', 'detected_weight')
    #search_fields = ('detected_weight', 'timestamp')

    # Make certain fields read-only
    readonly_fields = ('timestamp', 'detected_weight', 'image_display')

    # Function to display image in list view
    def image_tag(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="max-width:100px; max-height:100px;" />', obj.image.url)
        return "No Image"

    image_tag.short_description = 'Image Preview'  # List view column name

    # Function to display image in change view
    def image_display(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="max-width:300px; max-height:300px;" />', obj.image.url)
        return 'No Image'

    image_display.short_description = 'Image'  # Change view field label







# DiscrepancyReport

from django.http import HttpResponse
from django.contrib import admin
from .models import DiscrepancyReport  # Make sure to replace 'yourapp' with your actual app name

@admin.register(DiscrepancyReport)
class DiscrepancyReportAdmin(UnfoldModelAdmin):
    list_display = ('detected_weight', 'timestamp', 'image_preview', 'task_id')
    search_fields = ('detected_weight', 'timestamp', 'task_id')
    list_filter = ('detected_weight', 'timestamp', 'task_id')
    actions = ['generate_report']

    def generate_report(self, request, queryset):
        # Generate the discrepancy report
        from django.core.management import call_command
        call_command('generate_discrepancy_report')

        self.message_user(request, "Discrepancy report generated successfully")

    def image_preview(self, obj):
        if obj.image:  # Assuming the image field contains the file path
            return f'<img src="{obj.image.url}" width="100" height="100" />'  # Adjust dimensions as needed
        return "-"
    image_preview.allow_tags = True  # Allow HTML tags in the column

    def get_urls(self):
        from django.urls import path
        urls = super().get_urls()
        custom_urls = [
            path('download_report/', self.download_report)  # Adjust if you want to keep download functionality
        ]
        return custom_urls + urls

    def download_report(self, request):
        # This functionality might be redundant now but can be kept for historical reasons
        # Adjust the logic as needed based on how you want to handle the downloaded content
        discrepancies = DiscrepancyReport.objects.all()  # You can filter if needed

        if discrepancies.exists():
            response = HttpResponse(content_type='text/plain')
            response['Content-Disposition'] = 'attachment; filename="discrepancy_report.txt"'

            report_content = "Detected Weight | Timestamp | Image URL | Task ID\n"
            report_content += "-" * 50 + "\n"

            for report in discrepancies:
                report_content += f"{report.detected_weight} | {report.timestamp} | {report.image.url} | {report.task_id}\n"

            response.write(report_content)
            return response
        else:
            self.message_user(request, "No discrepancies found to download.")
            return HttpResponse(status=204)



# Company

@admin.register(Company)
class CompanyAdmin(UnfoldModelAdmin):
    list_display = ('name', 'address', 'email', 'phone')
    search_fields = ('name', 'address', 'email', 'phone')
    list_filter = ('name', 'address', 'email', 'phone')


# PrinterConfig

@admin.register(PrinterConfig)
class PrinterConfigAdmin(UnfoldModelAdmin):
    list_display = ('branch', 'name', 'printer_type')
    search_fields = ('branch', 'name', 'printer_type')
    list_filter = ('branch', 'name', 'printer_type')


# Branch

@admin.register(Branch)
class BranchAdmin(UnfoldModelAdmin):
    list_display = ('company', 'name', 'address')
    search_fields = ('company', 'name', 'address')
    list_filter = ('company', 'name', 'address')


# IndicatorConfig

@admin.register(IndicatorConfig)
class IndicatorConfigAdmin(UnfoldModelAdmin):
    list_display = ('indicator_name', 'connection_type', 'port')
    search_fields = ('indicator_name', 'connection_type', 'port')
    list_filter = ('indicator_name', 'connection_type', 'port')


# Customer

@admin.register(Customer)
class CustomerAdmin(UnfoldModelAdmin):
    list_display = ('name', 'phone_number', 'email','discounted','address')
    search_fields = ['name','phone_number']  # Assuming 'name' is a field in your Customer model
    list_filter = ('discounted','charge')

    fieldsets = (
        ('Customer Information', {
            'fields': (
                ('name', 'phone_number'),
            )
        }),
        #('Other Details', {
            #'fields': (
               #('email', 'discounted', 'charge', 'address'),
            #)
        #}),
    )


# Vehicle type

@admin.register(VehicleType)
class VehicleTypeAdmin(UnfoldModelAdmin):
    list_display = ('name', 'description', 'charge', 'currency')
    search_fields = ('name', 'charge')
    list_filter = ('name', 'charge')

    fieldsets = (
        ('Vehicle Type Information', {
            'fields': (
                ('name', 'currency','charge'),
            )
        }),
        #('Other Details', {
          #  'fields': (
            #    ('description'),
           # )
       # }),
    )



# Vehicle

@admin.register(Vehicle)
class VehicleAdmin(UnfoldModelAdmin):
    list_display = ('customer', 'vehicle_type', 'number_plate')
    search_fields = ['number_plate']  # Assuming 'name' is a field in your Customer model
    list_filter = ('customer', 'vehicle_type', 'number_plate')


# Currency

@admin.register(Currency)
class CurrencyAdmin(UnfoldModelAdmin):
    list_display = ('name', 'code', 'symbol')
    list_filter = ('name', 'code', 'symbol')
    search_fields = ('name', 'code', 'symbol')


# Item

@admin.register(Item)
class ItemAdmin(UnfoldModelAdmin):
    list_display = ('name', 'description', 'currency')
    list_filter = ('name', 'currency')
    search_fields = ('name', 'currency')

    fieldsets = (
        ('Item Information', {
            'fields': (
                ('name', 'currency'),
            )
        }),
        #('Other Details', {
          #  'fields': (
            #    ('description'),
           # )
       # }),
    )


# Camera Config

@admin.register(CameraConfig)
class CameraConfigAdmin(UnfoldModelAdmin):
    list_display = ('connection_type', 'ip_address', 'port')
    list_filter = ('connection_type', 'ip_address', 'port')
    search_fields = ('connection_type', 'ip_address', 'port')


from .models import CustomerVehicleTypeDiscount

@admin.register(CustomerVehicleTypeDiscount)
class CustomerVehicleTypeDiscountAdmin(UnfoldModelAdmin):
    list_display = ('customer', 'vehicle_type', 'discounted_charge')  # Display these fields in the list view
    search_fields = ('customer__name', 'vehicle_type__name')  # Add search fields for easier navigation
    list_filter = ('vehicle_type',)  # Allow filtering by vehicle type

#admin.site.register(CustomerVehicleTypeDiscount, CustomerVehicleTypeDiscountAdmin)

from django.contrib import admin
from .models import Invoice, Transaction
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle
from reportlab.lib import colors
from django.utils import timezone
from django.http import HttpResponse

from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
from reportlab.pdfgen import canvas
from django.contrib import admin
from .models import Invoice

@admin.register(Invoice)
class InvoiceAdmin(UnfoldModelAdmin):
    list_display = ('invoice_number', 'transaction_list', 'total_amount', 'issued_date', 'due_date', 'status')
    search_fields = ('invoice_number', 'transaction__customer__name')
    list_filter = ('status',)

    # Custom method to show the list of related transactions
    def transaction_list(self, obj):
        # Iterate over related transactions and return their IDs as a string
        return ", ".join(str(transaction.id) for transaction in obj.transactions.all())  # Use 'transactions' for ManyToManyField
    transaction_list.short_description = 'Transactions'

    # Custom action to generate a PDF invoice
    def generate_invoice_pdf(self, request, queryset):
        response = HttpResponse(content_type='application/pdf')
        response['Content-Disposition'] = 'attachment; filename="customer_invoices.pdf"'

        pdf_file = canvas.Canvas(response, pagesize=letter)
        y_position = 750  # Starting Y position for content

        # Draw the header
        pdf_file.setFont("Helvetica-Bold", 12)
        pdf_file.drawString(100, y_position, "METRIX WEIGHBRIDGE SERVICES")
        pdf_file.setFont("Helvetica", 10)
        pdf_file.drawString(100, y_position - 20, "Athi River, Machakos")
        pdf_file.drawString(100, y_position - 40, "Tel: 0715 488 903")
        pdf_file.drawString(100, y_position - 60, "Email: info@metrixws.co.ke")
        pdf_file.drawString(100, y_position - 80, "Website: www.metrixws.co.ke")
        y_position -= 100

        # Group invoices by customer
        invoices_by_customer = {}
        for invoice in queryset:
            customer = invoice.customer  # Accessing customer directly from Invoice model
            if customer not in invoices_by_customer:
                invoices_by_customer[customer] = []
            invoices_by_customer[customer].append(invoice)

        # Generate consolidated invoice per customer
        for customer, invoices in invoices_by_customer.items():
            # Draw the customer details
            pdf_file.setFont("Helvetica-Bold", 11)
            pdf_file.drawString(100, y_position, f"Customer: {customer.name}")
            y_position -= 20

            # Prepare table data
            data = [["Item Description", "Quantity", "Vehicle", "Operator", "Gross Weight", "Tare Weight", "Net Weight", "Amount"]]
            total_amount = 0

            # Populate table data from transactions
            for invoice in invoices:
                for transaction in invoice.transactions.all():  # Loop through each related transaction
                    item_description = transaction.item.name  # Adjust if 'item' has a different field
                    vehicle = transaction.vehicle.number_plate  # Example field for vehicle
                    operator = transaction.operator
                    gross_weight = transaction.gross_weight
                    tare_weight = transaction.tare_weight
                    net_weight = transaction.net_weight
                    amount = transaction.charge  # Total amount for the transaction
                    total_amount += amount

                    # Add the transaction details to the table
                    data.append([item_description, 1, vehicle, operator, gross_weight, tare_weight, net_weight, f"{amount:.2f}"])

            # Draw the table
            table = Table(data, colWidths=[100, 50, 70, 70, 70, 70, 70, 70])
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('GRID', (0, 0), (-1, -1), 1, colors.black),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ]))
            table.wrapOn(pdf_file, 100, y_position)
            table.drawOn(pdf_file, 100, y_position - (20 * len(data)))
            y_position -= 20 * (len(data) + 2)

            # Draw total amount
            pdf_file.setFont("Helvetica-Bold", 10)
            pdf_file.drawString(100, y_position, f"Total Amount: {total_amount:.2f}")
            y_position -= 40

            # Add a new page if space runs out
            if y_position < 100:
                pdf_file.showPage()
                y_position = 750

        pdf_file.save()
        return response


    generate_invoice_pdf.short_description = "Generate PDF Invoice"
    actions = ['generate_invoice_pdf', 'mark_as_paid']

    # Custom action to mark invoice and related transactions as paid
    def mark_as_paid(self, request, queryset):
        # Mark each selected invoice as paid
        for invoice in queryset:
            invoice.status = 'Paid'  # Assuming 'Paid' is a valid status for invoice
            invoice.save()

            # Also update the associated transactions
            for transaction in invoice.transactions.all():
                transaction.payment_status = 'Paid'  # Assuming 'Paid' is a valid status for payment
                transaction.save()

        self.message_user(request, "Selected invoices and transactions marked as paid.")
    mark_as_paid.short_description = "Receive Payment"

    actions = ['mark_as_paid','generate_invoice_pdf']



# Register Models
admin.site.register(ConfigurationFile)


