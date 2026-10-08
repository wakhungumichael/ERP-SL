const GENERIC_ERROR_KEYS = new Set(['detail', 'error', 'errors', 'message', 'non_field_errors']);

const FIELD_LABELS: Record<string, string> = {
  phone_number: 'Phone number',
  number_plate: 'Number plate',
  vehicle_type: 'Vehicle type',
  operation_type: 'Operation type',
  gross_weight: 'Gross weight',
  tare_weight: 'Tare weight',
  weight_reason: 'Weight reason',
  camera_snapshot: 'Camera image',
};

function fieldLabel(field: string) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field
    .replace(/\[[0-9]+\]/g, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyFieldMessage(field: string | null, message: string) {
  const clean = message.trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const label = field ? fieldLabel(field) : '';
  const normalized = clean.toLowerCase();

  if (normalized === 'this field may not be blank.' || normalized === 'this field is required.') {
    return label ? `${label} is required.` : 'Complete all required fields.';
  }
  if (normalized === 'this field may not be null.') {
    return label ? `${label} is required.` : 'A required value is missing.';
  }
  if (normalized === 'enter a valid email address.') {
    return label ? `Enter a valid ${label.toLowerCase()}.` : 'Enter a valid email address.';
  }
  if (label && normalized.startsWith('ensure this field has')) {
    return `${label}: ${clean}`;
  }
  if (label && !normalized.includes(label.toLowerCase())) {
    return `${label}: ${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
  }
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
}

function flattenErrors(value: unknown, field: string | null = null): string[] {
  if (value == null) return [];
  if (value instanceof Error) return flattenErrors(value.message, field);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('<!DOCTYPE html>')) return [];
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return flattenErrors(JSON.parse(trimmed), field);
      } catch {
        // Treat malformed JSON as a normal server message.
      }
    }
    return [friendlyFieldMessage(field, trimmed)].filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((entry) => flattenErrors(entry, field));
  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const responseData = (candidate as any)?.response?.data ?? (candidate as any)?.data ?? (candidate as any)?.body;
    if (responseData != null) return flattenErrors(responseData, field);
    return Object.entries(candidate).flatMap(([key, entry]) => (
      flattenErrors(entry, GENERIC_ERROR_KEYS.has(key) ? field : key)
    ));
  }
  return [friendlyFieldMessage(field, String(value))].filter(Boolean);
}

export function formatApiError(value: unknown, fallback = 'The request could not be completed. Please check the form and try again.') {
  const messages = Array.from(new Set(flattenErrors(value)));
  return messages.length > 0 ? messages.join(' ') : fallback;
}

export async function apiErrorFromResponse(response: Response, fallback?: string) {
  const raw = await response.text().catch(() => '');
  return new Error(formatApiError(raw, fallback));
}
