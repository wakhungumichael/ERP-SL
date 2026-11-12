"""Read-only, balanced net/tax/gross breakdowns for invoice documents."""
from decimal import Decimal, ROUND_FLOOR

CENT = Decimal("0.01")
ZERO = Decimal("0")


def allocate_total(total, weights):
    """Allocate a stored money total by weight, preserving every penny."""
    if not weights:
        return []
    denominator = sum(weights, ZERO)
    # When these are already the raw line amounts, retain their remainders.
    # Rescaling by a rounded total can otherwise move a penny to another line.
    if denominator.quantize(CENT) == total:
        raw = weights
    else:
        raw = [total * weight / denominator for weight in weights] if denominator else [total / len(weights)] * len(weights)
    amounts = [value.quantize(CENT, rounding=ROUND_FLOOR) for value in raw]
    pennies = int((total - sum(amounts, ZERO)) / CENT)
    assert 0 <= pennies <= len(weights), "Money total must have two decimal places."
    order = sorted(range(len(weights)), key=lambda i: raw[i] - amounts[i], reverse=True)
    for index in order[:pennies]:
        amounts[index] += CENT
    return amounts


def invoice_line_breakdown(lines, subtotal, tax, *, inclusive, combined):
    """Present original prices alongside balanced amounts, without saving data."""
    weights = [Decimal(line["quantity"]) * line["entered_unit_price"] for line in lines]
    if not any(weights):
        weights = [line["total"] for line in lines]
    if inclusive:
        gross = allocate_total(subtotal + tax, weights)
        net = allocate_total(subtotal, gross)
        taxes = [amount - before_tax for amount, before_tax in zip(gross, net)]
    else:
        net = allocate_total(subtotal, weights)
        tax_weights = net if combined else [line.get("tax_amount", ZERO) for line in lines]
        if not any(tax_weights):
            tax_weights = net
        taxes = allocate_total(tax, tax_weights)
        gross = [before_tax + amount for before_tax, amount in zip(net, taxes)]
    return [{"net": before_tax, "tax": amount, "gross": after_tax} for before_tax, amount, after_tax in zip(net, taxes, gross)]
