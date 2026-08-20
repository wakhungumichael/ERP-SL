from datetime import datetime, time
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import InventoryBalance, InventoryMovement, InventoryReservation, Warehouse


def _decimal(value):
    if value in (None, ""):
        return Decimal("0")
    return Decimal(str(value))


def is_stock_product(product):
    if product is None:
        return False
    if not getattr(product, "is_active", True):
        return False
    if getattr(product, "product_type", None) != "product":
        return False
    return bool(getattr(product, "is_stock_item", True))


def resolve_default_warehouse(*, tenant, branch=None):
    qs = Warehouse.objects.filter(tenant=tenant, is_default=True)
    if branch is not None:
        branch_match = qs.filter(branch=branch).first()
        if branch_match:
            return branch_match
    warehouse = qs.filter(branch__isnull=True).first()
    if warehouse:
        return warehouse

    code = f"MAIN-{branch.pk}" if branch is not None else "MAIN"
    name = f"{branch.name} Main Warehouse" if branch is not None else "Main Warehouse"
    warehouse, _ = Warehouse.objects.get_or_create(
        tenant=tenant,
        code=code,
        defaults={
            "branch": branch,
            "name": name,
            "warehouse_type": "branch" if branch is not None else "main",
            "status": "active",
            "is_default": True,
        },
    )
    if branch is not None and warehouse.branch_id is None:
        warehouse.branch = branch
        warehouse.is_default = True
        warehouse.save(update_fields=["branch", "is_default", "updated_at"])
    return warehouse


def _get_balance(*, tenant, warehouse, product):
    balance, _ = InventoryBalance.objects.get_or_create(
        tenant=tenant,
        warehouse=warehouse,
        product=product,
        defaults={
            "on_hand_qty": Decimal("0"),
            "reserved_qty": Decimal("0"),
            "available_qty": Decimal("0"),
            "average_cost": Decimal("0"),
            "valuation_amount": Decimal("0"),
        },
    )
    return balance


def _save_balance(balance):
    balance.recalculate_available()
    balance.last_movement_at = timezone.now()
    balance.save(
        update_fields=[
            "on_hand_qty",
            "reserved_qty",
            "available_qty",
            "average_cost",
            "valuation_amount",
            "last_movement_at",
            "updated_at",
        ]
    )


def _apply_receipt_delta(balance, *, quantity_delta, unit_cost):
    quantity_delta = _decimal(quantity_delta)
    unit_cost = _decimal(unit_cost)
    balance.on_hand_qty = _decimal(balance.on_hand_qty) + quantity_delta
    balance.valuation_amount = _decimal(balance.valuation_amount) + (quantity_delta * unit_cost)
    if balance.on_hand_qty > 0:
        balance.average_cost = _decimal(balance.valuation_amount) / _decimal(balance.on_hand_qty)
    else:
        balance.average_cost = Decimal("0")
        if balance.valuation_amount < 0:
            balance.valuation_amount = Decimal("0")
    _save_balance(balance)


def _apply_reservation_delta(balance, quantity_delta):
    quantity_delta = _decimal(quantity_delta)
    balance.reserved_qty = max(Decimal("0"), _decimal(balance.reserved_qty) + quantity_delta)
    _save_balance(balance)


def _apply_issue_delta(balance, *, quantity_delta):
    quantity_delta = _decimal(quantity_delta)
    average_cost = _decimal(balance.average_cost)
    balance.on_hand_qty = _decimal(balance.on_hand_qty) - quantity_delta
    if balance.on_hand_qty < 0:
        balance.on_hand_qty = Decimal("0")
    balance.valuation_amount = max(Decimal("0"), _decimal(balance.valuation_amount) - (quantity_delta * average_cost))
    if balance.on_hand_qty > 0:
        balance.average_cost = _decimal(balance.valuation_amount) / _decimal(balance.on_hand_qty)
    else:
        balance.average_cost = Decimal("0")
    _save_balance(balance)


def _upsert_movement(
    *,
    tenant,
    warehouse,
    product,
    movement_type,
    reference_type,
    reference_id,
    reference_line_id,
    reference_number,
    quantity,
    unit_cost,
    movement_date,
    notes="",
    created_by=None,
):
    quantity = _decimal(quantity)
    unit_cost = _decimal(unit_cost)
    movement = InventoryMovement.objects.filter(
        tenant=tenant,
        movement_type=movement_type,
        reference_type=reference_type,
        reference_id=reference_id,
        reference_line_id=reference_line_id,
        product=product,
        warehouse=warehouse,
    ).first()
    previous_quantity = _decimal(movement.quantity) if movement else Decimal("0")
    if movement is None:
        movement = InventoryMovement.objects.create(
            tenant=tenant,
            warehouse=warehouse,
            product=product,
            movement_type=movement_type,
            reference_type=reference_type,
            reference_id=reference_id,
            reference_line_id=reference_line_id,
            reference_number=reference_number,
            quantity=quantity,
            unit_cost=unit_cost,
            movement_date=movement_date,
            notes=notes,
            created_by=created_by,
        )
    else:
        movement.reference_number = reference_number
        movement.quantity = quantity
        movement.unit_cost = unit_cost
        movement.movement_date = movement_date
        movement.notes = notes
        movement.created_by = created_by
        movement.save()
    return movement, quantity - previous_quantity


@transaction.atomic
def sync_goods_receipt_to_inventory(receipt, *, actor=None):
    warehouse = resolve_default_warehouse(tenant=receipt.tenant, branch=receipt.branch)
    for line in receipt.lines.select_related("product", "purchase_order_item__product").all():
        product = line.product or getattr(line.purchase_order_item, "product", None)
        if not is_stock_product(product):
            continue
        balance = _get_balance(tenant=receipt.tenant, warehouse=warehouse, product=product)
        movement, delta = _upsert_movement(
            tenant=receipt.tenant,
            warehouse=warehouse,
            product=product,
            movement_type="receipt",
            reference_type="goods_receipt",
            reference_id=receipt.id,
            reference_line_id=line.id,
            reference_number=receipt.receipt_number,
            quantity=_decimal(line.accepted_quantity or line.received_quantity),
            unit_cost=_decimal(line.unit_price),
            movement_date=timezone.make_aware(datetime.combine(receipt.received_date, time.min))
            if receipt.received_date else timezone.now(),
            notes=f"Goods receipt for {receipt.purchase_order.reference}",
            created_by=actor or receipt.received_by,
        )
        if delta != 0:
            _apply_receipt_delta(balance, quantity_delta=delta, unit_cost=movement.unit_cost)


def _release_reservation(reservation, *, balance, actor=None):
    qty = _decimal(reservation.quantity)
    if reservation.status == "active" and qty > 0:
        _apply_reservation_delta(balance, -qty)
        InventoryMovement.objects.update_or_create(
            tenant=reservation.tenant,
            warehouse=reservation.warehouse,
            product=reservation.product,
            movement_type="release",
            reference_type="sales_order",
            reference_id=reservation.sales_order_id,
            reference_line_id=reservation.sales_order_line_id,
            defaults={
                "reference_number": getattr(reservation.sales_order, "order_number", ""),
                "quantity": qty,
                "unit_cost": _decimal(balance.average_cost),
                "movement_date": timezone.now(),
                "notes": "Reservation released",
                "created_by": actor or reservation.created_by,
            },
        )
    reservation.status = "released"
    reservation.released_at = timezone.now()
    reservation.save(update_fields=["status", "released_at", "updated_at"])


@transaction.atomic
def sync_sales_order_inventory(order, *, actor=None):
    warehouse = resolve_default_warehouse(tenant=order.tenant, branch=order.branch)
    lines = list(order.line_items.select_related("product").all())

    active_reservations = {
        reservation.sales_order_line_id: reservation
        for reservation in InventoryReservation.objects.select_related("product", "warehouse", "sales_order")
        .filter(sales_order=order, status="active")
    }

    if order.status in {"draft", "cancelled"}:
        for reservation in active_reservations.values():
            balance = _get_balance(tenant=order.tenant, warehouse=reservation.warehouse, product=reservation.product)
            _release_reservation(reservation, balance=balance, actor=actor)
        return

    for line in lines:
        product = line.product
        if not is_stock_product(product):
            continue
        balance = _get_balance(tenant=order.tenant, warehouse=warehouse, product=product)
        target_qty = _decimal(line.quantity)
        reservation = active_reservations.get(line.id)

        if order.status == "confirmed":
            if reservation is None:
                reservation = InventoryReservation.objects.create(
                    tenant=order.tenant,
                    warehouse=warehouse,
                    product=product,
                    sales_order=order,
                    sales_order_line=line,
                    quantity=target_qty,
                    status="active",
                    reserved_at=timezone.now(),
                    created_by=actor or order.created_by,
                )
                _apply_reservation_delta(balance, target_qty)
            else:
                delta = target_qty - _decimal(reservation.quantity)
                if delta != 0:
                    reservation.quantity = target_qty
                    reservation.save(update_fields=["quantity", "updated_at"])
                    _apply_reservation_delta(balance, delta)

            _upsert_movement(
                tenant=order.tenant,
                warehouse=warehouse,
                product=product,
                movement_type="reservation",
                reference_type="sales_order",
                reference_id=order.id,
                reference_line_id=line.id,
                reference_number=order.order_number,
                quantity=target_qty,
                unit_cost=_decimal(balance.average_cost),
                movement_date=timezone.now(),
                notes="Stock reserved for confirmed sales order",
                created_by=actor or order.created_by,
            )

        if order.status in {"fulfilled", "invoiced"}:
            if reservation is not None and reservation.status == "active":
                _apply_reservation_delta(balance, -_decimal(reservation.quantity))
                reservation.status = "consumed"
                reservation.consumed_at = timezone.now()
                reservation.save(update_fields=["status", "consumed_at", "updated_at"])

            movement, delta = _upsert_movement(
                tenant=order.tenant,
                warehouse=warehouse,
                product=product,
                movement_type="issue",
                reference_type="sales_order",
                reference_id=order.id,
                reference_line_id=line.id,
                reference_number=order.order_number,
                quantity=target_qty,
                unit_cost=_decimal(balance.average_cost),
                movement_date=timezone.now(),
                notes="Stock issued for fulfilled sales order",
                created_by=actor or order.created_by,
            )
            if delta != 0:
                _apply_issue_delta(balance, quantity_delta=delta)
