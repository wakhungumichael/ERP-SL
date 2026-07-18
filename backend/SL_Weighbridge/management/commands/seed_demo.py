"""
Management command: seed_demo
Creates realistic demo data for SL-ERP development/demo environments.
Safe to run multiple times — uses get_or_create throughout.
"""
import random
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from SL_Weighbridge.models import (
    Branch, Company, Currency, Customer, Invoice, InvoiceLine,
    Item, Transaction, Vehicle, VehicleType,
)


CUSTOMERS = [
    {"name": "Nairobi Aggregates Ltd", "phone_number": "+254700100001", "email": "ops@nairobiag.co.ke", "address": "Industrial Area, Nairobi"},
    {"name": "Mombasa Logistics Co.", "phone_number": "+254700100002", "email": "fleet@mombasalog.co.ke", "address": "Kilindini Rd, Mombasa"},
    {"name": "Rift Valley Hauliers", "phone_number": "+254700100003", "email": "admin@rvhauliers.co.ke", "address": "Nakuru Town"},
    {"name": "East Africa Quarries Ltd", "phone_number": "+254700100004", "email": "accounts@eaquarries.co.ke", "address": "Athi River"},
    {"name": "Kisumu Stone Merchants", "phone_number": "+254700100005", "email": "ops@kisumustone.co.ke", "address": "Kisumu Port"},
    {"name": "Thika Road Builders", "phone_number": "+254700100006", "email": "site@thikabuilders.co.ke", "address": "Thika Town"},
    {"name": "Coastal Cement Supplies", "phone_number": "+254700100007", "email": "orders@coastcement.co.ke", "address": "Bamburi, Mombasa"},
    {"name": "Nyanza Gravel Movers", "phone_number": "+254700100008", "email": "ops@nyanzagravel.co.ke", "address": "Kisii Town"},
    {"name": "Mt Kenya Aggregates", "phone_number": "+254700100009", "email": "info@mtkenyaag.co.ke", "address": "Nyeri Town"},
    {"name": "Savannah Transport Ltd", "phone_number": "+254700100010", "email": "fleet@savannahtrans.co.ke", "address": "Eldoret"},
    {"name": "Great Rift Construction", "phone_number": "+254700100011", "email": "projects@greatrift.co.ke", "address": "Naivasha"},
    {"name": "Lamu Port Logistics", "phone_number": "+254700100012", "email": "ops@lamulogistics.co.ke", "address": "Lamu Port"},
]

VEHICLE_TYPES_DATA = [
    {"name": "Pickup Truck", "charge": "200.00", "max_gross_weight": 3500, "max_tare_weight": 1800, "description": "Small pickups up to 3.5t"},
    {"name": "Small Lorry (3–5t)", "charge": "400.00", "max_gross_weight": 5000, "max_tare_weight": 2500, "description": "Light commercial lorry"},
    {"name": "Medium Lorry (7–10t)", "charge": "600.00", "max_gross_weight": 10000, "max_tare_weight": 4000, "description": "Medium-haul lorry"},
    {"name": "Large Lorry (14–18t)", "charge": "900.00", "max_gross_weight": 18000, "max_tare_weight": 6500, "description": "Heavy lorry"},
    {"name": "Trailer / Articulated", "charge": "1500.00", "max_gross_weight": 56000, "max_tare_weight": 15000, "description": "Full articulated truck"},
    {"name": "Tractor Unit", "charge": "500.00", "max_gross_weight": 8000, "max_tare_weight": 3500, "description": "Agricultural tractor"},
]

ITEMS_DATA = [
    "Ballast (20mm)", "Gravel (14mm)", "Sand (River)", "Murram", "Hardcore",
    "Stone Aggregate", "Quarry Dust", "Cement Clinker", "Steel Scrap",
    "Timber Logs", "Maize Grain", "Sugar Cane",
]

DESTINATIONS = [
    "Nairobi CBD", "Industrial Area", "Athi River", "Thika", "Mombasa Port",
    "Kisumu", "Nakuru", "Eldoret", "Nyeri", "Machakos",
]

OPERATORS = ["operator01", "J. Kamau", "M. Odhiambo", "P. Wanjiku", "S. Kipchoge"]


class Command(BaseCommand):
    help = "Seeds the database with realistic demo weighbridge data"

    def add_arguments(self, parser):
        parser.add_argument("--transactions", type=int, default=120, help="Number of transactions to create")
        parser.add_argument("--clear", action="store_true", help="Clear existing demo data first")

    def handle(self, *args, **options):
        if options["clear"]:
            self.stdout.write("Clearing existing data...")
            Transaction.objects.all().delete()
            Invoice.objects.all().delete()
            Vehicle.objects.all().delete()
            Customer.objects.all().delete()
            Item.objects.all().delete()
            VehicleType.objects.all().delete()

        self.stdout.write("Seeding demo data...")

        # ── Currency ──────────────────────────────────────────────────────────
        kes, _ = Currency.objects.get_or_create(
            name="Kenyan Shilling",
            defaults={"symbol": "KES"}
        )
        self.stdout.write("  ✓ Currency")

        # ── Company & Branch ──────────────────────────────────────────────────
        company, _ = Company.objects.get_or_create(
            name="Siakora Commercial Ltd",
            defaults={
                "address": "Upper Hill, Nairobi",
                "email": "info@siakora.co.ke",
                "phone": "+254700000001",
            }
        )

        branches_data = [
            {"name": "Nairobi — Main Gate",  "address": "Industrial Area, Nairobi", "email": "nairobi@siakora.co.ke",  "phone": "+254700000010"},
            {"name": "Mombasa — Port Gate",  "address": "Kilindini Rd, Mombasa",   "email": "mombasa@siakora.co.ke",  "phone": "+254700000011"},
            {"name": "Kisumu — Lakeside",     "address": "Port Rd, Kisumu",         "email": "kisumu@siakora.co.ke",   "phone": "+254700000012"},
        ]
        branches = []
        for bd in branches_data:
            b, _ = Branch.objects.get_or_create(
                name=bd["name"],
                defaults={**bd, "company": company}
            )
            branches.append(b)
        self.stdout.write(f"  ✓ {len(branches)} Branches")

        # ── Vehicle Types ─────────────────────────────────────────────────────
        vt_map = {}
        for vtd in VEHICLE_TYPES_DATA:
            vt, _ = VehicleType.objects.get_or_create(
                name=vtd["name"],
                defaults={
                    "charge": vtd["charge"],
                    "max_gross_weight": vtd["max_gross_weight"],
                    "max_tare_weight": vtd["max_tare_weight"],
                    "description": vtd["description"],
                    "currency": kes,
                }
            )
            vt_map[vt.name] = vt
        vehicle_types = list(vt_map.values())
        self.stdout.write(f"  ✓ {len(vehicle_types)} Vehicle Types")

        # ── Items ─────────────────────────────────────────────────────────────
        items = []
        for item_name in ITEMS_DATA:
            item, _ = Item.objects.get_or_create(
                name=item_name,
                defaults={"currency": kes}
            )
            items.append(item)
        self.stdout.write(f"  ✓ {len(items)} Items")

        # ── Customers ─────────────────────────────────────────────────────────
        customers = []
        for cd in CUSTOMERS:
            c, _ = Customer.objects.get_or_create(
                phone_number=cd["phone_number"],
                defaults={k: v for k, v in cd.items() if k != "phone_number"} | {"phone_number": cd["phone_number"]}
            )
            customers.append(c)
        self.stdout.write(f"  ✓ {len(customers)} Customers")

        # ── Vehicles ──────────────────────────────────────────────────────────
        plate_pool = [
            "KAA 001A", "KAB 234B", "KBC 567C", "KBD 890D", "KBE 111E",
            "KBF 222F", "KBG 333G", "KBH 444H", "KBI 555I", "KBJ 666J",
            "KCA 777K", "KCB 888L", "KCC 999M", "KCD 100N", "KCE 200P",
            "KCF 300Q", "KCG 400R", "KCH 500S", "KCI 600T", "KCJ 700U",
            "KDA 800V", "KDB 900W", "KDC 010X", "KDD 020Y", "KDE 030Z",
            "KDF 040A", "KDG 050B", "KDH 060C", "KDI 070D", "KDJ 080E",
            "KAC 123F", "KAD 456G", "KAE 789H", "KAF 012I", "KAG 345J",
            "KAH 678K", "KAI 901L", "KAJ 234M", "KBA 567N", "KBB 890P",
        ]
        vehicles = []
        for i, plate in enumerate(plate_pool):
            customer = customers[i % len(customers)]
            vt = vehicle_types[i % len(vehicle_types)]
            v, _ = Vehicle.objects.get_or_create(
                number_plate=plate,
                defaults={"customer": customer, "vehicle_type": vt}
            )
            vehicles.append(v)
        self.stdout.write(f"  ✓ {len(vehicles)} Vehicles")

        # ── Transactions ──────────────────────────────────────────────────────
        existing_count = Transaction.objects.count()
        to_create = max(0, options["transactions"] - existing_count)

        now = timezone.now()
        created_txs = []

        for i in range(to_create):
            vehicle = random.choice(vehicles)
            branch = random.choice(branches)
            item = random.choice(items)
            operator = random.choice(OPERATORS)
            destination = random.choice(DESTINATIONS)
            days_ago = random.randint(0, 45)
            tx_date = now - timedelta(days=days_ago, hours=random.randint(0, 23), minutes=random.randint(0, 59))

            # Decide if Completed or Pending
            is_completed = random.random() < 0.75
            vt = vehicle.vehicle_type

            gross = random.randint(
                (vt.max_tare_weight or 2000) + 500,
                vt.max_gross_weight or 10000
            )
            tare = random.randint(
                vt.max_tare_weight or 1500,
                (vt.max_tare_weight or 2000) + 500
            ) if vt.max_tare_weight else random.randint(1500, 3000)
            net = gross - tare if is_completed else 0

            discounted = vehicle.customer.discounted
            charge = float(vt.charge) * (0.7 if discounted else 1.0) if is_completed else 0

            payment_mode = random.choice(["Cash", "Mpesa", "Bank Deposit", "Debt"])
            payment_status = random.choice(["Paid", "Pending", "Pending"]) if is_completed else ""

            tx = Transaction(
                branch=branch,
                customer=vehicle.customer,
                vehicle=vehicle,
                operator=operator,
                item=item,
                vehicle_type=vt,
                status="Completed" if is_completed else "Pending",
                weight_type="Second Weight" if is_completed else "First Weight",
                gross_weight=gross,
                tare_weight=tare if is_completed else 0,
                net_weight=net,
                gross_weight_date=tx_date,
                tare_weight_date=tx_date + timedelta(minutes=random.randint(10, 60)) if is_completed else None,
                charge=charge,
                destination=destination,
                payment_mode=payment_mode,
                payment_status=payment_status,
                invoiced=False,
                paired=is_completed,
                weight_date=tx_date,
                created_at=tx_date,
            )
            created_txs.append(tx)

        if created_txs:
            # Bulk create — override auto_now_add by disabling it temporarily
            Transaction.objects.bulk_create(created_txs, ignore_conflicts=False)

        total_txs = Transaction.objects.count()
        self.stdout.write(f"  ✓ {total_txs} Transactions ({to_create} new)")

        # ── Invoices ──────────────────────────────────────────────────────────
        # Group uninvoiced completed transactions by customer and create invoices
        existing_invoices = Invoice.objects.count()
        if existing_invoices == 0:
            uninvoiced = list(
                Transaction.objects.filter(status="Completed", invoiced=False, payment_status="Pending")
                .select_related("customer", "vehicle_type")[:80]
            )
            # Group by customer
            from collections import defaultdict
            by_customer = defaultdict(list)
            for t in uninvoiced:
                by_customer[t.customer_id].append(t)

            invoice_count = 0
            for customer_id, txs in by_customer.items():
                if not txs:
                    continue
                customer = txs[0].customer
                total = sum(float(t.charge) for t in txs)
                inv_num = f"INV-{timezone.now().strftime('%Y%m')}-{customer_id:04d}"

                inv = Invoice.objects.create(
                    invoice_number=inv_num,
                    customer=customer,
                    total_amount=total,
                    status=random.choice(["Pending", "Pending", "Paid"]),
                )
                inv.transactions.set(txs)
                Transaction.objects.filter(id__in=[t.id for t in txs]).update(invoiced=True)

                # Create invoice lines grouped by vehicle type
                vt_totals = defaultdict(lambda: {"qty": 0, "amount": 0.0, "vt": None})
                for t in txs:
                    k = t.vehicle_type_id
                    vt_totals[k]["qty"] += 1
                    vt_totals[k]["amount"] += float(t.charge)
                    vt_totals[k]["vt"] = t.vehicle_type

                for vt_data in vt_totals.values():
                    InvoiceLine.objects.create(
                        invoice=inv,
                        vehicle_type=vt_data["vt"],
                        quantity=vt_data["qty"],
                        total_amount=vt_data["amount"],
                    )

                invoice_count += 1

            self.stdout.write(f"  ✓ {invoice_count} Invoices")
        else:
            self.stdout.write(f"  ↷ Invoices already exist ({existing_invoices}), skipping")

        self.stdout.write(self.style.SUCCESS("\n✅  Demo seed complete!"))
        self.stdout.write(f"     Customers: {Customer.objects.count()}")
        self.stdout.write(f"     Vehicles:  {Vehicle.objects.count()}")
        self.stdout.write(f"     Transactions: {Transaction.objects.count()}")
        self.stdout.write(f"     Invoices:  {Invoice.objects.count()}")
