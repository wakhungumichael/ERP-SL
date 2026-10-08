const GENERIC_ERROR_KEYS = new Set(['detail', 'error', 'errors', 'message', 'non_field_errors', 'nonFieldErrors', '__all__']);

export type FormValidationErrors = {
  fields: Record<string, string[]>;
  form: string[];
};

export class ApiFormError extends Error {
  validationErrors: FormValidationErrors;

  constructor(message: string, validationErrors: FormValidationErrors) {
    super(message);
    this.name = 'ApiFormError';
    this.validationErrors = validationErrors;
  }
}

const FIELD_LABELS: Record<string, string> = {
  phone_number: 'Phone number',
  number_plate: 'Number plate',
  vehicle_type: 'Vehicle type',
  operation_type: 'Operation type',
  gross_weight: 'Gross weight',
  tare_weight: 'Tare weight',
  weight_reason: 'Weight reason',
  camera_snapshot: 'Camera image',
  paired_first_transaction: 'Pending first weight',
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

function collectErrors(value: unknown, field: string | null, result: FormValidationErrors) {
  if (value == null) return;
  if (value instanceof ApiFormError) {
    Object.entries(value.validationErrors.fields).forEach(([key, messages]) => {
      result.fields[key] = [...(result.fields[key] ?? []), ...messages];
    });
    result.form.push(...value.validationErrors.form);
    return;
  }
  // Generated API errors extend Error but retain the DRF response body on
  // `data`. Read it before the generic Error message so a useful validation
  // response is not reduced to "HTTP 400 Bad Request".
  if (value instanceof Error && (value as any).data != null) {
    collectErrors((value as any).data, field, result);
    return;
  }
  if (value instanceof Error) {
    collectErrors(value.message, field, result);
    return;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Django's debug 500 pages are HTML documents, sometimes preceded by a
    // transport prefix such as "HTML 500 Internal Server Error:". Never show
    // that technical markup to an ERP user.
    if (!trimmed || /<!doctype html|<html[\s>]/i.test(trimmed)) return;
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        collectErrors(JSON.parse(trimmed), field, result);
        return;
      } catch {
        // Treat malformed JSON as a normal server message.
      }
    }
    const message = friendlyFieldMessage(field, trimmed);
    if (message) {
      if (field) result.fields[field] = [...(result.fields[field] ?? []), message];
      else result.form.push(message);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectErrors(entry, field, result));
    return;
  }
  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const responseData = (candidate as any)?.response?.data ?? (candidate as any)?.data ?? (candidate as any)?.body;
    if (responseData != null) {
      collectErrors(responseData, field, result);
      return;
    }
    Object.entries(candidate).forEach(([key, entry]) => {
      collectErrors(entry, GENERIC_ERROR_KEYS.has(key) ? field : key, result);
    });
    return;
  }
  collectErrors(String(value), field, result);
}

export function parseFormErrors(value: unknown): FormValidationErrors {
  const result: FormValidationErrors = { fields: {}, form: [] };
  collectErrors(value, null, result);
  Object.keys(result.fields).forEach((field) => {
    result.fields[field] = Array.from(new Set(result.fields[field]));
  });
  result.form = Array.from(new Set(result.form));
  return result;
}

export function formatApiError(value: unknown, fallback = 'The request could not be completed. Please check the form and try again.') {
  const errors = parseFormErrors(value);
  const messages = Array.from(new Set([...Object.values(errors.fields).flat(), ...errors.form]));
  return messages.length > 0 ? messages.join(' ') : fallback;
}

export async function apiErrorFromResponse(response: Response, fallback?: string) {
  const raw = await response.text().catch(() => '');
  const validationErrors = parseFormErrors(raw);
  const message = formatApiError(validationErrors, fallback);
  if (Object.keys(validationErrors.fields).length === 0 && validationErrors.form.length === 0) {
    validationErrors.form = [message];
  }
  return new ApiFormError(message, validationErrors);
}
