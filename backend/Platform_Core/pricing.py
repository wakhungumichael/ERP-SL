from decimal import Decimal

from Platform_Core.models import ModuleDefinition, PricingRule


def _to_decimal(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _matches_condition(expected, actual):
    if expected in (None, "", []):
        return True
    if isinstance(expected, list):
        return actual in expected
    return actual == expected


def _rule_matches(rule, context):
    conditions = rule.conditions or {}
    if not _matches_condition(conditions.get("weight_type"), context.get("weight_type")):
        return False
    if not _matches_condition(conditions.get("customer_id"), context.get("customer_id")):
        return False
    if not _matches_condition(conditions.get("customer_ids"), context.get("customer_id")):
        return False
    if not _matches_condition(conditions.get("vehicle_type_id"), context.get("vehicle_type_id")):
        return False
    if not _matches_condition(conditions.get("vehicle_type_ids"), context.get("vehicle_type_id")):
        return False

    weight_kg = _to_decimal(context.get("weight_kg"))
    min_weight = _to_decimal(conditions.get("min_weight_kg"))
    max_weight = _to_decimal(conditions.get("max_weight_kg"))
    if min_weight is not None and (weight_kg is None or weight_kg < min_weight):
        return False
    if max_weight is not None and (weight_kg is None or weight_kg > max_weight):
        return False

    for key, expected in conditions.items():
        if key in {
            "weight_type",
            "customer_id",
            "customer_ids",
            "vehicle_type_id",
            "vehicle_type_ids",
            "min_weight_kg",
            "max_weight_kg",
        }:
            continue
        if key in context and not _matches_condition(expected, context.get(key)):
            return False

    return True


def _apply_adjustment(*, base_amount, rule):
    amount = _to_decimal(rule.amount) or Decimal("0")
    if rule.adjustment_mode == "override":
        return amount
    if rule.adjustment_mode == "fixed_discount":
        return max(Decimal("0"), base_amount - amount)
    if rule.adjustment_mode == "percentage_discount":
        return max(Decimal("0"), base_amount - ((base_amount * amount) / Decimal("100")))
    return base_amount


def resolve_pricing_rule(*, tenant, module_slug, base_amount, context):
    if tenant is None:
        return {
            "matched": False,
            "rule": None,
            "amount": base_amount,
        }

    module = ModuleDefinition.objects.filter(slug=module_slug).first()
    if module is None and module_slug == "weighbridge":
        module = ModuleDefinition.objects.filter(slug="commercial-weighbridge").first()
    if module is None:
        return {
            "matched": False,
            "rule": None,
            "amount": base_amount,
        }

    rules = (
        PricingRule.objects.filter(tenant=tenant, module=module, is_active=True)
        .select_related("rule_type")
        .order_by("-priority", "id")
    )
    for rule in rules:
        if not _rule_matches(rule, context):
            continue
        return {
            "matched": True,
            "rule": rule,
            "amount": _apply_adjustment(base_amount=base_amount, rule=rule),
        }

    return {
        "matched": False,
        "rule": None,
        "amount": base_amount,
    }
