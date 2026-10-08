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
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_companies',
    )
    name = models.CharField(max_length=255)
    address = models.TextField()
    email = models.EmailField()
    phone = models.CharField(max_length=50)
    logo = models.ImageField(upload_to='logos/', blank=True, null=True)

    def __str__(self):
        return self.name



# Branch Model

class Branch(models.Model):
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_branches',
    )
    company = models.ForeignKey(Company, on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    address = models.TextField()
    email = models.EmailField()
    phone = models.CharField(max_length=50)

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
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_customers',
    )
    name = models.CharField(max_length=255)
    address = models.TextField(null=True, blank=True)
    phone_number = models.CharField(max_length=20, unique=True)
    email = models.EmailField(null=True, blank=True, max_length=255, unique=True)
    discounted = models.BooleanField(default=False)
    charge = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    is_active = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False)
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


class CustomerPortalAccount(models.Model):
    """A restricted login that may view only one customer's operational records."""
    tenant = models.ForeignKey('Platform_Core.Tenant', on_delete=models.CASCADE, related_name='customer_portal_accounts')
    customer = models.OneToOneField(Customer, on_delete=models.CASCADE, related_name='portal_account')
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='customer_portal_account')
    is_active = models.BooleanField(default=True)
    invited_at = models.DateTimeField(auto_now_add=True)
    last_invited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['customer__name']

    def __str__(self):
        return f"Customer portal: {self.customer.name}"


def _resolve_vehicle_presence_client(branch=None):
    """
    Resolve the legacy company reference for surveillance captures.

    The live VehiclePresence schema stores `client_id` against SL_Weighbridge.company,
    so we always persist the branch's operational company here.
    """
    return getattr(branch, "company", None)
    

# CustomerVehicleTypeDiscount Model
class CustomerVehicleTypeDiscount(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    vehicle_type = models.ForeignKey('VehicleType', on_delete=models.CASCADE)
    discounted_charge = models.DecimalField(max_digits=10, decimal_places=2)



# VehicleType Model
class VehicleType(models.Model):
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_vehicle_types',
    )
    name = models.CharField(max_length=50)
    description = models.TextField(blank=True, null=True)
    charge = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.ForeignKey('Currency', on_delete=models.SET_NULL, null=True)
    linked_product = models.ForeignKey(
        'SL_Sales.Product',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_vehicle_types',
    )
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

    def get_effective_charge(self):
        return self.charge


class WeighingOperationType(models.Model):
    FLOW_KIND_CHOICES = [
        ('first', 'First Weight'),
        ('second', 'Second Weight'),
        ('single', 'Single Weight'),
        ('axle', 'Axle Weight'),
    ]

    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.CASCADE,
        related_name='weighing_operation_types',
        null=True,
        blank=True,
    )
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, null=True)
    flow_kind = models.CharField(max_length=20, choices=FLOW_KIND_CHOICES, default='first')
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=10)
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ['display_order', 'name']
        unique_together = [('tenant', 'code')]

    def __str__(self):
        return self.name


# Vehicle Model
class Vehicle(models.Model):
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_vehicles',
    )
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='vehicles')
    vehicle_type = models.ForeignKey(VehicleType, on_delete=models.CASCADE)  # Mandatory field
    number_plate = models.CharField(max_length=20, unique=True)  # Unique number plate
    is_active = models.BooleanField(default=True)
    class Meta:
        ordering = ['number_plate']  # Or whatever field you want to use for ordering
    def __str__(self):
        return f"{self.vehicle_type.name} - {self.number_plate}"
    

# Currency Model
class Currency(models.Model):
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_currencies',
    )
    name = models.CharField(max_length=50)
    code = models.CharField(max_length=10)
    symbol = models.CharField(max_length=5)

    def __str__(self):
        return self.name

# Item Model
class Item(models.Model):
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='weighbridge_items',
    )
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
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE)
    operator = models.CharField(max_length=100)
    driver_name = models.CharField(max_length=120, blank=True, default="")
    driver_phone = models.CharField(max_length=40, blank=True, default="")
    item = models.ForeignKey(Item, on_delete=models.CASCADE)
    vehicle_type = models.ForeignKey(VehicleType, on_delete=models.CASCADE)
    operation_type = models.ForeignKey(
        'WeighingOperationType',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
    )
    gross_weight_date = models.DateTimeField(null=True, blank=True)
    tare_weight_date = models.DateTimeField(null=True, blank=True)
    STATUS_CHOICES = [
        ('Draft', 'Draft'),
        ('Recalled', 'Recalled'),
        ('Rejected', 'Rejected'),
        ('Completed', 'Completed'),
    ]

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Draft')
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
    payment_reference = models.CharField(max_length=120, blank=True, default="")
    payment_received_at = models.DateTimeField(blank=True, null=True)
    invoiced = models.BooleanField(default=False)
    workflow_step = models.ForeignKey(WorkflowStep, null=True, blank=True, on_delete=models.SET_NULL)
    approval_status = models.BooleanField(default=False)
    manual_weight_capture = models.BooleanField(default=False)
    weight_reason = models.TextField(blank=True, null=True)  # Optional until capture
    manual_receipt = models.FileField(upload_to='manual_receipts/', blank=True, null=True)  # File upload
    image = models.ImageField(upload_to='transaction_images/', blank=True, null=True)
    

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
                ("can_export_transaction", "Can export transactions to CSV"),
                ("can_reprint_recent_weighbridge_receipts", "Can reprint recent weighbridge receipts"),
                ("can_approve_pending_transactions", "Can approve pending transactions"),
                ("can_recall_completed_transactions", "Can recall completed transactions"),
                # Process permissions are separate from record CRUD so roles can
                # be tailored to the actual weighbridge operating flow.
                ("can_access_weighment_entry", "Can access Weighment Entry"),
                ("can_capture_first_weight", "Can capture first weight"),
                ("can_capture_second_weight", "Can capture second weight"),
                ("can_view_live_weight", "Can view live weight"),
                ("can_manage_weighbridge_reports", "Can manage weighbridge reports"),
                ("can_manage_weighbridge_settings", "Can manage weighbridge settings"),
                ("can_manage_vehicle_presence", "Can manage vehicle presence"),
                ("can_review_weighbridge_discrepancies", "Can review weighbridge discrepancies"),
            ]

                                             


    def update_charge_based_on_vehicle_type(self):
        """Update the charge based on weight type, customer discounts, and vehicle type."""
        # Case 1: If it's a second weight, charge is always 0
        if self.weight_type == 'Second Weight':
            self.charge = 0.00
            self.discounted = False
            return

        # Case 2: Handle 'First Weight' scenarios
        if self.weight_type == 'First Weight':
                base_charge = self.vehicle_type.get_effective_charge() if self.vehicle_type else 0.00
                from Platform_Core.pricing import resolve_pricing_rule

                pricing_result = resolve_pricing_rule(
                    tenant=self.tenant,
                    module_slug="weighbridge",
                    base_amount=base_charge,
                    context={
                        "customer_id": self.customer_id,
                        "vehicle_type_id": self.vehicle_type_id,
                        "weight_type": self.weight_type,
                        "weight_kg": self.gross_weight,
                    },
                )
                if pricing_result["matched"]:
                    self.charge = pricing_result["amount"]
                    self.discounted = True
                    return

                # Check for vehicle-type-specific discount
                discount = CustomerVehicleTypeDiscount.objects.filter(
                    customer=self.customer, vehicle_type=self.vehicle_type
                ).first()
                if discount:
                    # Apply the vehicle-type-specific discount
                    self.charge = discount.discounted_charge
                    self.discounted = True
                    print(f"Applied vehicle-type-specific discount: {self.charge}")
                    return

                # If no vehicle-type-specific discount, check for global customer discount
                if self.customer and self.customer.discounted:
                   self.charge = self.customer.charge if self.customer.charge is not None else self.vehicle_type.get_effective_charge()
                   self.discounted = True
                   print(f"Applied global customer charge: {self.charge}")
                   return

                # Fallback to the normal vehicle type charge
                if self.vehicle_type:
                   self.charge = self.vehicle_type.get_effective_charge()
                   self.discounted = False
                   print(f"Applied normal vehicle type charge: {self.charge}")

                else:
                    # Fallback if no vehicle type is found
                    self.charge =0.00
                    self.discounted = False
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
    CAMERA_TYPES = [
        ('hikvision', 'HikVision (ISAPI)'),
        ('generic_http', 'Generic HTTP Snapshot'),
    ]

    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='camera_configs',
    )
    name = models.CharField(max_length=100, blank=True, default='')
    connection_type = models.CharField(max_length=10, choices=CONNECTION_TYPES)
    camera_type = models.CharField(max_length=20, choices=CAMERA_TYPES, default='hikvision')
    ip_address = models.CharField(max_length=64, blank=True, null=True)
    port = models.IntegerField(blank=True, null=True, default=80)
    hikvision_channel = models.IntegerField(default=1)
    other_parameters = models.TextField(blank=True, null=True)
    username = models.CharField(max_length=100, blank=True, null=True)
    password = models.CharField(max_length=100, blank=True, null=True)
    capture_on_overweight = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.name or self.connection_type} - {self.ip_address or 'No IP'}"
    


#Vehcile Presence Model




class VehiclePresence(models.Model):
    tenant = models.ForeignKey(
        'Platform_Core.Tenant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vehicle_presences',
    )
    client = models.ForeignKey(
        Company,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vehicle_presences',
    )
    station = models.ForeignKey(
        Branch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vehicle_presence_stations',
    )
    branch = models.ForeignKey(
        Branch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vehicle_presences',
    )
    timestamp = models.DateTimeField(auto_now_add=True)
    detected_weight = models.FloatField()
    capture_status = models.BooleanField(default=False)
    plate_number = models.CharField(max_length=20, blank=True, null=True)
    image = models.ImageField(upload_to='vehicle_images/', blank=True, null=True)
    locked = models.BooleanField(default=False)  # Field to lock the record
    match_status = models.CharField(max_length=20, blank=True, default='pending')
    overweight_event = models.OneToOneField(
        'OverweightEvent',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vehicle_presence',
    )


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
        local_field_names = {field.name for field in self._meta.local_fields}
        if "station" in local_field_names and self.station_id is None:
            self.station = self.branch
        if "client" in local_field_names and self.client_id is None:
            self.client = _resolve_vehicle_presence_client(self.branch)
        if not self.match_status:
            self.match_status = 'pending'
        super().save(*args, **kwargs)


# DiscrepancyReport Model (legacy — kept for backward compat)


class DiscrepancyReport(models.Model):
    detected_weight = models.FloatField()
    timestamp = models.DateTimeField()
    image = models.ImageField(upload_to='discrepancy_images/')
    task_id = models.CharField(max_length=255, unique=True)

    def __str__(self):
        return f"Discrepancy detected on {self.timestamp} with weight {self.detected_weight}"


# ── Overweight Surveillance ──────────────────────────────────────────────────


class OverweightConfig(models.Model):
    """Per-branch configuration for overweight surveillance."""
    branch = models.OneToOneField(
        Branch, on_delete=models.CASCADE, related_name='overweight_config',
    )
    threshold_kg = models.DecimalField(
        max_digits=10, decimal_places=2, default=1000,
        help_text="Net weight (kg) at or above which an OverweightEvent is created.",
    )
    grace_window_minutes = models.IntegerField(
        default=30,
        help_text="Minutes after an OverweightEvent before it is promoted to a discrepancy "
                  "if no matching transaction is found.",
    )
    capture_interval_seconds = models.IntegerField(
        default=45,
        help_text="Minimum number of seconds between repeated vehicle-presence captures for the same branch and weight.",
    )
    surveillance_enabled = models.BooleanField(
        default=True,
        help_text="Master switch — disabling this stops all overweight event creation for this branch.",
    )
    notify_on_overweight = models.BooleanField(
        default=True,
        help_text="Send an email alert when an overweight event is created for this branch. "
                  "Disable to opt out of email notifications.",
    )
    notify_email = models.EmailField(
        blank=True, null=True,
        help_text="Email address to notify when an overweight event is detected. "
                  "Leave blank to fall back to tenant admin users.",
    )

    def __str__(self):
        return f"Overweight config — {self.branch.name} (threshold: {self.threshold_kg} kg)"


class OverweightEvent(models.Model):
    CAPTURE_SOURCE_CHOICES = [
        ('transaction', 'Transaction'),
        ('vehicle_presence', 'Vehicle Presence'),
    ]
    """Created whenever a weight reading meets or exceeds the branch threshold."""
    tenant = models.ForeignKey(
        'Platform_Core.Tenant', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='overweight_events',
    )
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='overweight_events',
    )
    vehicle_plate = models.CharField(
        max_length=20, blank=True, default='',
        help_text="Number plate at the time of capture (may be blank if no transaction was open).",
    )
    gross_weight = models.IntegerField(null=True, blank=True)
    tare_weight  = models.IntegerField(null=True, blank=True)
    net_weight   = models.IntegerField(
        help_text="The weight value that triggered this event.",
    )
    threshold_at_capture = models.IntegerField(
        help_text="Branch threshold (kg) in force when this event was created.",
    )
    recorded_at = models.DateTimeField(auto_now_add=True)
    operator = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='overweight_events_triggered',
    )
    linked_transaction = models.ForeignKey(
        'Transaction', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='overweight_events',
    )
    capture_source = models.CharField(
        max_length=32,
        choices=CAPTURE_SOURCE_CHOICES,
        default='transaction',
        help_text="Whether this surveillance event came from a saved transaction or raw vehicle presence monitoring.",
    )
    camera_image = models.ImageField(
        upload_to='overweight_images/', blank=True, null=True,
    )
    discrepancy_raised = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-recorded_at']

    def __str__(self):
        return (
            f"OverweightEvent {self.net_weight} kg "
            f"(plate: {self.vehicle_plate or '?'}, {self.recorded_at})"
        )


class WeighbridgeDiscrepancy(models.Model):
    """Raised when an OverweightEvent has no matching completed transaction after the grace window."""
    STATUS_CHOICES = [
        ('unresolved', 'Unresolved'),
        ('reviewed',   'Reviewed'),
        ('resolved',   'Resolved'),
    ]
    overweight_event = models.OneToOneField(
        OverweightEvent, on_delete=models.CASCADE,
        related_name='discrepancy',
    )
    tenant = models.ForeignKey(
        'Platform_Core.Tenant', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='weighbridge_discrepancies',
    )
    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='weighbridge_discrepancies',
    )
    resolution_status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='unresolved',
    )
    resolution_note = models.TextField(blank=True, default='')
    resolved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_discrepancies',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'Weighbridge discrepancies'

    def __str__(self):
        return (
            f"Discrepancy — {self.overweight_event} [{self.resolution_status}]"
        )
    

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
