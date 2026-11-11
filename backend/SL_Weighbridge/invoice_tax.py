"""Tax-inclusive invoice calculations using exact decimal amounts."""
from decimal import Decimal, ROUND_FLOOR

CENT = Decimal("0.01")
HUNDRED = Decimal("100")


def net_unit_price(invoice, unit_price):
    """Return the pre-tax display price without changing the entered price."""
    price = Decimal(unit_price or 0)
    if invoice.prices_include_tax and invoice.tax_mode == "combined":
        return price / (1 + invoice.combined_tax_rate / HUNDRED)
    return price


def split_inclusive_combined_tax(amounts, rate):
    """Split the rounded gross total and allocate net pennies across its lines.

    Largest remainders keep the net lines equal to the invoice subtotal.
    Original entered unit prices remain on the lines for lossless editing.
    """
    factor = 1 + rate / HUNDRED
    gross = sum(amounts, Decimal("0")).quantize(CENT)
    subtotal = (gross / factor).quantize(CENT)
    raw_net = [amount / factor for amount in amounts]
    lines = [amount.quantize(CENT, rounding=ROUND_FLOOR) for amount in raw_net]
    pennies = int((subtotal - sum(lines, Decimal("0"))) / CENT)
    order = sorted(range(len(lines)), key=lambda i: raw_net[i] - lines[i], reverse=True)
    for index in order[:pennies]:
        lines[index] += CENT
    return lines, subtotal, gross - subtotal
