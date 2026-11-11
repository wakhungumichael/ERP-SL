/** Invoice preview uses the same precision and half-even rounding as the API. */
type Line = { qty: number; unit_price: number; tax_rate: number };
type Charge = { calculation_type: string; rate: number | string };

function scaled(value: number | string, places: number, signed = false): bigint {
  const number = Number(value);
  // Invalid or out-of-range input must not crash the form while it is edited.
  if (!Number.isFinite(number) || (!signed && number < 0) || Math.abs(number) >= 1e21) return 0n;
  return BigInt(number.toFixed(places).replace('.', ''));
}

function rounded(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) return -rounded(-numerator, denominator);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n) ? 1n : 0n);
}

/** Allocate rounded line amounts so displayed lines add up to the entered subtotal. */
export function invoiceLineTotals(lines: Pick<Line, 'qty' | 'unit_price'>[]): number[] {
  const raw = lines.map(line => scaled(line.qty, 3) * scaled(line.unit_price, 2));
  const cents = raw.map(amount => amount / 1000n);
  const target = rounded(raw.reduce((sum, amount) => sum + amount, 0n), 1000n);
  const remainder = Number(target - cents.reduce((sum, amount) => sum + amount, 0n));
  const order = raw.map((amount, index) => ({ index, fraction: amount % 1000n }))
    .sort((a, b) => a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1);
  for (const { index } of order.slice(0, remainder)) cents[index] += 1n;
  return cents.map(amount => Number(amount) / 100);
}

export function invoiceTotals(lines: Line[], taxMode: 'per_line' | 'combined', taxRate: number, pricesIncludeTax: boolean, charges: Charge[]) {
  // Quantity has three decimal places; unit prices and rates have two.
  const rawAmounts = lines.map(line => scaled(line.qty, 3) * scaled(line.unit_price, 2));
  const rawSubtotal = rawAmounts.reduce((sum, value) => sum + value, 0n);
  const inclusive = taxMode === 'combined' && pricesIncludeTax;
  const gross = rounded(rawSubtotal, 1000n);
  const subtotal = inclusive ? rounded(gross * 10000n, 10000n + scaled(taxRate, 2)) : rounded(rawSubtotal, 1000n);
  const tax = inclusive ? gross - subtotal : taxMode === 'combined'
    ? rounded(rawSubtotal * scaled(taxRate, 2), 10000000n)
    : rawAmounts.reduce((sum, amount, index) => sum + rounded(amount * scaled(lines[index].tax_rate, 2), 10000000n), 0n);
  const chargeBase = inclusive ? subtotal * 1000n : rawSubtotal;
  const charge = charges.reduce((sum, item) => sum + (item.calculation_type === 'percentage'
    ? rounded(chargeBase * scaled(item.rate, 2, true), 10000000n) : scaled(item.rate, 2, true)), 0n);
  const total = inclusive ? gross + charge : rounded(rawSubtotal + (tax + charge) * 1000n, 1000n);
  return { subtotal: Number(subtotal) / 100, taxTotal: Number(tax) / 100, chargeTotal: Number(charge) / 100, total: Number(total) / 100 };
}
