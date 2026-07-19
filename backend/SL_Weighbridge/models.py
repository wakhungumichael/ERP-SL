from io import BytesIO
#import logger
import qrcode
from django.core.files.storage import FileSystemStorage
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.contrib.auth.models import User
from django import forms
from django.contrib.auth.models import User
from django.db import models
from django.db.models import Max
from django.contrib.auth.models import Group
from django.db import models
from django.utils.html import mark_safe
from django.db import models
import logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Example usage
#logger.debug("Debug message")
#logger.info("Info message")
#logger.warning("Warning message")
#logger.error("Error message")




# Workflow Model

class WorkflowStep(models.Model):
    name = models.CharField(max_length=255)
    order = models.PositiveIntegerField()
    groups_allowed = models.ManyToManyField(Group, blank=True)
    is_approval_step = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.order}: {self.name}"



# Configuration File Model

class ConfigurationFile(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    file = models.FileField(upload_to='config_files/')

    def __str__(self):
        return self.name



# Company Model

class Company(models.Model):
    name = models.CharField(max_length=255)
    address = models.TextField()
    email = models.EmailField()
    phone = models.CharField(max_length=20)
    logo = models.ImageField(upload_to='logos/', blank=True, null=True)

    def __str__(self):
        return self.name



# Branch Model

class Branch(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    address = models.TextField()
    email = models.EmailField()
    phone = models.CharField(max_length=20)

    def __str__(self):
        return f"{self.name} - {self.company.name}"



# Printer Configuration Model

class PrinterConfig(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name='printer_configs')
    name = models.CharField(max_length=100)  # e.g., "Zebra ZQ220", "Epson LX-350"
    printer_type = models.CharField(max_length=50, choices=[('Zebra', 'Zebra'), ('Epson', 'Epson')])
    port = models.CharField(max_length=100)
    baud_rate = models.IntegerField(default=9600, validators=[MinValueValidator(9600), MaxValueValidator(115200)])
    data_bits = models.IntegerField(default=8, validators=[MinValueValidator(5), MaxValueValidator(8)])
    parity = models.CharField(max_length=10, default='None',
                                  choices=[('None', 'None'), ('Even', 'Even'), ('Odd', 'Odd')])
    stop_bits = models.IntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(2)])
    is_active = models.BooleanField(default=False)  # To mark the active printer

    def __str__(self):
            return f"Printer Config for {self.name}"



# Indicator Configuration Model

class IndicatorConfig(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE)
    indicator_name = models.CharField(max_length=100)
    connection_type = models.CharField(
        max_length=20,
        choices=[('USB', 'USB'), ('Ethernet', 'Ethernet'), ('Serial', 'Serial'), ('HTTP', 'HTTP / REST API')]
    )
    port = models.CharField(max_length=100, blank=True, null=True)
    baud_rate = models.IntegerField(blank=True, null=True)
    data_bits = models.IntegerField(default=8)
    parity = models.CharField(
        max_length=10,
        choices=[('None', 'None'), ('Even', 'Even'), ('Odd', 'Odd')],
        default='None'
    )
    stop_bits = models.IntegerField(default=1)
    command_file = models.OneToOneField(ConfigurationFile, on_delete=models.CASCADE, null=True, blank=True)

    # HTTP indicator fields (used when connection_type == 'HTTP')
    live_weight_url = models.CharField(
        max_length=500, blank=True, null=True,
        help_text="URL that returns {value, stable, timestamp} — polled for live display. "
                  "e.g. https://ws.metrixws.co.ke/live_weight"
    )
    stable_weight_url = models.CharField(
        max_length=500, blank=True, null=True,
        help_text="URL that returns a stable/confirmed reading. Falls back to live_weight_url if blank."
    )

    # Workflow age window
    max_first_weight_age_days = models.IntegerField(
        default=3,
        help_text="How many days back to look for a matching pending First Weight when capturing Second Weight. Default 3."
    )

    # Mode and node number
    mode = models.IntegerField(default=1, choices=[(0, 'No Transmission'), (1, 'Continuous Transmission'),
                                                   (2, 'Transmission if No-Motion'), (3, 'On Demand Transmission')])
    node_number = models.IntegerField(default=49, validators=[MinValueValidator(0), MaxValueValidator(250)])

    def __str__(self):
        return f"{self.indicator_name} - {self.branch.name}"



# Customer Model

class Customer(models.Model):
    name = models.CharField(max_length=255)
    address = models.TextField(null=True, blank=True)
    phone_number = models.CharField(max_length=20, unique=True)
    email = models.EmailField(null=True, blank=True, max_length=255, unique=True)
    discounted = models.BooleanField(default=False)
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    vehicle_type_discounts = models.ManyToManyField(
        'VehicleType',  # Use string reference
        through='CustomerVehicleTypeDiscount',
        related_name='discounted_customers',
        blank=True
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name
    

# CustomerVehicleTypeDiscount Model
class CustomerVehicleTypeDiscount(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    vehicle_type = models.ForeignKey('VehicleType', on_delete=models.CASCADE)
    discounted_charge = models.DecimalField(max_digits=10, decimal_places=2)



# VehicleType Model
class VehicleType(models.Model):
    name = models.CharField(max_length=50)
    description = models.TextField(blank=True, null=True)
    charge = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.ForeignKey('Currency', on_delete=models.SET_NULL, null=True)
    max_gross_weight = models.PositiveIntegerField(
        null=True, 
        blank=True, 
        help_text="Maximum gross weight in KG for this vehicle type."
    )  

    max_tare_weight = models.PositiveIntegerField(
        null=True,
        help_text="Maximum tare weight in KG for this vehicle type."
    )

    def __str__(self):
        return self.name


# Vehicle Model
class Vehicle(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='vehicles')
    vehicle_type = models.ForeignKey(VehicleType, on_delete=models.CASCADE)  # Mandatory field
    number_plate = models.CharField(max_length=20, unique=True)  # Unique number plate
    class Meta:
        ordering = ['number_plate']  # Or whatever field you want to use for ordering
    def __str__(self):
        return f"{self.vehicle_type.name} - {self.number_plate}"
    

# Currency Model
class Currency(models.Model):
    name = models.CharField(max_length=50)
    code = models.CharField(max_length=10)
    symbol = models.CharField(max_length=5)

    def __str__(self):
        return self.name

# Item Model
class Item(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    currency = models.ForeignKey(Currency, on_delete=models.SET_NULL, null=True)

    def __str__(self):
        return self.name


# Transaction Model
class Transaction(models.Model):
    # ── Tenant isolation ──────────────────────────────────────────────────────
    # Nullable so that records created before multi-tenancy was introduced remain
    # accessible to superusers without breaking existing functionality.  Non-
    # superuser API access is scoped to this field automatically.
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='weighbridge_transactions',
    )
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, default=1)  # Default branch to 1
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE)
    operator = models.CharField(max_length=100)
    item = models.ForeignKey(Item, on_delete=models.CASCADE)
    vehicle_type = models.ForeignKey(VehicleType, on_delete=models.CASCADE)
    gross_weight_date = models.DateTimeField(null=True, blank=True)
    tare_weight_date = models.DateTimeField(null=True, blank=True)
    STATUS_CHOICES = [
        ('Pending', 'Pending'),
        ('Completed', 'Completed'),
    ]

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='Pending')
    gross_weight = models.IntegerField(null=True, blank=True, default=0)  # Default to 0
    tare_weight = models.IntegerField(null=True, blank=True, default=0)  # Default to 0
    net_weight = models.IntegerField(null=True, blank=True, default=0)  # Default to 0
    manual_weight_capture = models.BooleanField(default=False)
    discounted = models.BooleanField(default=False)
    weight_date = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, related_name='created_transactions', on_delete=models.SET_NULL, null=True, blank=True)
    last_modified_by = models.ForeignKey(User, related_name='modified_transactions', on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    paired = models.BooleanField(default=False) 
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)  # Add charge field
    destination = models.CharField(
    max_length=100, 
    verbose_name="Destination"  # Optional: for a more readable label in the admin/form
)
    weight_type = models.CharField(
        max_length=20,
        choices=[
            ('', 'Select Payment Status'),  # Initial blank choice  
            ('First Weight', 'First Weight'), ('Second Weight', 'Second Weight')],
        blank=False,
    )
    PAYMENT_MODE_CHOICES = [
        ('', 'Select Payment Mode'),  # Initial blank choice
        ('Cash', 'Cash'),
        ('Mpesa', 'Mpesa - Direct'),
        ('Bank Deposit', 'Bank Deposit'),
        ('Debt', 'Debt'),
    ]
    payment_mode = models.CharField(
        max_length=20, 
        choices=PAYMENT_MODE_CHOICES,
        blank=False)
    PAYMENT_STATUS_CHOICES = [
        ('', 'Select Payment Status'),  # Initial blank choice
        ('Paid', 'Paid'),
        ('Pending', 'Pending'),
    ]
    payment_status = models.CharField(
        max_length=20, 
        choices=PAYMENT_STATUS_CHOICES,
        blank=False)
    invoiced = models.BooleanField(default=False)
    workflow_step = models.ForeignKey(WorkflowStep, null=True, blank=True, on_delete=models.SET_NULL)
    approval_status = models.BooleanField(default=False)
    manual_weight_capture = models.BooleanField(default=False)
    weight_reason = models.TextField(blank=True, null=True)  # Optional until capture
    manual_receipt = models.FileField(upload_to='manual_receipts/', blank=True, null=True)  # File upload
    

    paired_first_transaction = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='paired_second_transactions',
        limit_choices_to={'weight_type': 'First Weight'}
    )
    auto_invoice = models.ForeignKey(
        'Invoice',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='auto_invoiced_transactions',
    )
    
    
    
    
    class Meta:
            permissions = [
               # ('can_export_csv', 'Can export transactions to CSV'),
                ("can_export_transaction", "Can export transactions to CSV"),

                ('can_approve_pending_transactions', 'Can pending completed transactions'),  # approve permission
                ('can_recall_completed_transactions', 'Can recall completed transactions'),  # recall permission


            ]

                                             


    def update_charge_based_on_vehicle_type(self):
        """Update the charge based on weight type, customer discounts, and vehicle type."""
        # Case 1: If it's a second weight, charge is always 0
        if self.weight_type == 'Second Weight':
            self.charge = 0.00
            return

        # Case 2: Handle 'First Weight' scenarios
        if self.weight_type == 'First Weight':
                # Check for vehicle-type-specific discount
                discount = CustomerVehicleTypeDiscount.objects.filter(
                    customer=self.customer, vehicle_type=self.vehicle_type
                ).first()
                if discount:
                    # Apply the vehicle-type-specific discount
                    self.charge = discount.discounted_charge
                    print(f"Applied vehicle-type-specific discount: {self.charge}")
                    return

                 # If no vehicle-type-specific discount, check for global customer discount
                if self.customer and self.customer.discounted:
                   self.charge = self.customer.charge if self.customer.charge is not None else self.vehicle_type.charge
                   print(f"Applied global customer charge: {self.charge}")
                   return

                # Fallback to the normal vehicle type charge
                if self.vehicle_type:
                   self.charge = self.vehicle_type.charge
                   print(f"Applied normal vehicle type charge: {self.charge}")

                else:
                    # Fallback if no vehicle type is found
                    self.charge =0.00
                    print("No vehicle type found; charge set to 0.00")




    # Calculate Net Weight
    def calculate_net_weight(self):
        try:
            if self.gross_weight is not None and self.tare_weight is not None:
                self.net_weight = abs(float(self.gross_weight) - float(self.tare_weight))  # Ensure net weight is positive
            else:
                self.net_weight = None
        except ValueError as e:
            logger.error(f"Error calculating net weight: {e}")
            self.net_weight = None
        except Exception as e:
            logger.error(f"Unexpected error in calculate_net_weight: {e}")
            self.net_weight = None

   

    def save(self, *args, **kwargs):
    # Validate maximum gross weight during manual weight capture
        if self.manual_weight_capture and self.gross_weight:
           max_gross_weight = self.vehicle.vehicle_type.max_gross_weight
           if max_gross_weight is not None and self.gross_weight > max_gross_weight:
              raise ValueError(
                f"Gross weight {self.gross_weight} KG exceeds the maximum limit of {max_gross_weight} KG for vehicle type '{self.vehicle.vehicle_type.name}'."
            )
    
    # If it's the first weight, ensure net weight is 0
        if self.weight_type == "First Weight":
           self.net_weight = 0
           if not self.manual_weight_capture:
              self.tare_weight = 0  # Set tare_weight to 0 only for non-manual capture
        else:
        # For second weight or other types, calculate net weight
            self.calculate_net_weight()

    # Update charge based on vehicle type
        self.update_charge_based_on_vehicle_type()

    # Call the original save method
        super().save(*args, **kwargs)



    def generate_qr_code(self):
        qr_data = f"Transaction: {self.id}\nCustomer: {self.customer.name}\nVehicle: {self.vehicle.number_plate}\nWeight: {self.net_weight}"
        qr = qrcode.make(qr_data)
        qr_io = BytesIO()
        qr.save(qr_io, 'PNG')
        qr_image = FileSystemStorage().save(f'qrcodes/transaction_{self.id}.png', qr_io)
        return qr_image

    def __str__(self):
        return f"Transaction for {self.customer.name} - {self.vehicle.number_plate}"
    


#CAmera models

class CameraConfig(models.Model):
    CONNECTION_TYPES = [
        ('IP', 'IP'),
        ('Cable', 'Cable'),
        ('Other', 'Other'),
    ]

    connection_type = models.CharField(max_length=10, choices=CONNECTION_TYPES)
    ip_address = models.CharField(max_length=15, blank=True, null=True)
    port = models.IntegerField(blank=True, null=True)
    other_parameters = models.TextField(blank=True, null=True)
    username = models.CharField(max_length=100, blank=True, null=True)
    password = models.CharField(max_length=100, blank=True, null=True)

    def __str__(self):
        return f"{self.connection_type} - {self.ip_address or 'No IP'}"
    


#Vehcile Presence Model




class VehiclePresence(models.Model):
    timestamp = models.DateTimeField(auto_now_add=True)
    detected_weight = models.FloatField()
    capture_status = models.BooleanField(default=False)
    plate_number = models.CharField(max_length=20, blank=True, null=True)
    image = models.ImageField(upload_to='vehicle_images/', blank=True, null=True)
    locked = models.BooleanField(default=False)  # Field to lock the record


    def __str__(self):
        return f"Presence at {self.timestamp} - {self.detected_weight} KG"

    def image_tag(self):
        """Returns an HTML image tag for the admin interface."""
        if self.image:
            return mark_safe(f'<img src="{self.image.url}" width="100" height="100" />')
        return "No Image"

    image_tag.short_description = 'Image Preview'

    def save(self, *args, **kwargs):
        """Ensures the image path is formatted correctly before saving."""
        # This condition checks if the image field has been uploaded
        if self.image and hasattr(self.image, 'name'):
            # Replace any backslashes with forward slashes in the file name
            self.image.name = self.image.name.replace('\\', '/')
        super().save(*args, **kwargs)


# DiscrepancyReport Model



class DiscrepancyReport(models.Model):
    detected_weight = models.FloatField()
    timestamp = models.DateTimeField()
    image = models.ImageField(upload_to='discrepancy_images/')
    task_id = models.CharField(max_length=255, unique=True)

    def __str__(self):
        return f"Discrepancy detected on {self.timestamp} with weight {self.detected_weight}"
    

# INVOICE MODULE.py

from django.db import models
from django.utils import timezone
from datetime import timedelta


class Invoice(models.Model):
    STATUS_CHOICES = [
        ('draft',   'Draft'),
        ('issued',  'Issued'),
        ('paid',    'Paid'),
        ('overdue', 'Overdue'),
    ]
    SOURCE_MODULE_CHOICES = [
        ('weighbridge',  'Weighbridge'),
        ('hr',           'HR'),
        ('procurement',  'Procurement'),
        ('crm',          'CRM'),
        ('manual',       'Manual'),
    ]

    # ── Tenant isolation ──────────────────────────────────────────────────────
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='invoices',
    )
    transactions   = models.ManyToManyField('Transaction', blank=True)
    invoice_number = models.CharField(max_length=100, unique=True, blank=True)
    total_amount   = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency       = models.CharField(max_length=10, default='KES')
    issued_date    = models.DateTimeField(auto_now_add=True)          # creation timestamp
    issued_at      = models.DateTimeField(null=True, blank=True)       # set when formally issued
    customer       = models.ForeignKey('Customer', on_delete=models.CASCADE)
    due_date       = models.DateField(null=True, blank=True)
    status         = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    notes          = models.TextField(blank=True, null=True)
    source_module  = models.CharField(max_length=20, choices=SOURCE_MODULE_CHOICES, default='manual')
    source_id      = models.IntegerField(null=True, blank=True)

    # ── created_at alias so serializers can use either name ──────────────────
    @property
    def created_at(self):
        return self.issued_date

    def _next_invoice_number(self):
        from django.utils import timezone as tz
        year = tz.now().year
        seq  = Invoice.objects.filter(invoice_number__startswith=f"INV-{year}-").count() + 1
        return f"INV-{year}-{seq:04d}"

    def save(self, *args, **kwargs):
        if not self.invoice_number:
            self.invoice_number = self._next_invoice_number()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Invoice {self.invoice_number}"

    class Meta:
        ordering = ['-issued_date']


class InvoiceLine(models.Model):
    invoice      = models.ForeignKey(Invoice, related_name='lines', on_delete=models.CASCADE)
    vehicle_type = models.ForeignKey('VehicleType', on_delete=models.SET_NULL, null=True, blank=True)
    description  = models.CharField(max_length=300, blank=True)
    quantity     = models.PositiveIntegerField(default=1)
    unit_price   = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        label = self.description or (self.vehicle_type.name if self.vehicle_type else 'Line')
        return f"{label} - Qty: {self.quantity} - Amount: {self.total_amount}"





class InvoiceEmailLog(models.Model):
    """Records each attempt to send a payment-link email for an invoice."""
    invoice         = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='email_logs')
    recipient       = models.EmailField(max_length=255)
    sent_at         = models.DateTimeField(auto_now_add=True)
    success         = models.BooleanField(default=False)
    failure_reason  = models.TextField(blank=True, null=True)

    class Meta:
        ordering = ['-sent_at']

    def __str__(self):
        status = "OK" if self.success else "FAILED"
        return f"Email to {self.recipient} [{status}] for Invoice {self.invoice_id}"


class Report(models.Model):
    REPORT_TYPE_CHOICES = [
        ('transactions', 'Transaction Report'),
        ('vehicles', 'Vehicle Presence Report'),
        ('invoices', 'Invoice Report'),
    ]

    name = models.CharField(max_length=200)
    report_type = models.CharField(max_length=20, choices=REPORT_TYPE_CHOICES)
    generated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    generated_at = models.DateTimeField(auto_now_add=True)
    file = models.FileField(upload_to='generated_reports/', blank=True, null=True)
    filters_applied = models.TextField(blank=True, help_text="JSON or description of filters used")

    def __str__(self):
        return f"{self.get_report_type_display()} - {self.generated_at.strftime('%Y-%m-%d %H:%M')}"
