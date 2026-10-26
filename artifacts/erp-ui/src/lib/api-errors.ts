/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
const GENERIC_ERROR_KEYS = new Set(['detail', 'error', 'errors', 'message', 'non_field_errors', 'nonFieldErrors', '__all__']);

const FRIENDLY_SYSTEM_ERRORS: Array<[RegExp, string]> = [
  [/^(?:failed|fetch failed|request failed|error)$/i, 'We could not complete that request. Please try again.'],
  [/failed to fetch|networkerror|network request failed/i, 'We could not reach the server. Check your connection and try again.'],
  [/^401$|not authenticated|authentication credentials were not provided|session.*expired/i, 'Your session has expired. Please sign in again.'],
  [/^403$|permission denied|not authorized|forbidden/i, 'You do not have permission to complete this action.'],
  [/^404$|not found/i, 'The requested record is no longer available. Refresh the page and try again.'],
  [/^409$|conflict/i, 'This record was changed by another user. Refresh the page before trying again.'],
  [/^429$|too many requests/i, 'Too many requests were sent. Please wait a moment and try again.'],
  [/^5\d\d$|internal server error|server error|api server returned an html page|<!doctype html|<html[\s>]/i, 'The server could not complete this request. Please try again.'],
  [/popup.*blocked/i, 'Your browser blocked the new window. Allow pop-ups for this site and try again.'],
  [/integrityerror|traceback|django|psycopg|databaseerror|sqlstate|typeerror|referenceerror|cannot read propert|is not defined/i, 'The record could not be saved because of a server data issue. Please contact your administrator if it continues.'],
];

export type FormValidationErrors = {
  fields: Record<string, string[]>;
  form: string[];
};

export class ApiFormError extends Error {
  validationErrors: FormValidationErrors;
  status?: number;

  constructor(message: string, validationErrors: FormValidationErrors, status?: number) {
    super(message);
    this.name = 'ApiFormError';
    this.validationErrors = validationErrors;
    this.status = status;
  }
}

export type UserFacingError = {
  title: string;
  description: string;
};

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

/** Converts HTTP, browser, and server diagnostics into a message an ERP user can act on. */
export function toUserFriendlyError(value: unknown, fallback = 'We could not complete that request. Please try again.') {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (!clean) return fallback;
  for (const [pattern, message] of FRIENDLY_SYSTEM_ERRORS) {
    if (pattern.test(clean)) return message;
  }
  return clean;
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
    const message = friendlyFieldMessage(field, toUserFriendlyError(trimmed));
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
  return messages.length > 0 ? messages.join(' ') : toUserFriendlyError(value, fallback);
}

/**
 * Provides one consistent, non-technical notification for failed page loads
 * and actions. Field-level validation remains available through parseFormErrors.
 */
export function getUserFacingError(
  value: unknown,
  fallback = 'Please refresh the page and try again.',
): UserFacingError {
  const rawMessage = value instanceof Error ? value.message : String(value ?? '');
  const status = value instanceof ApiFormError
    ? value.status
    : Number(/(?:^|\s)([1-5]\d\d)(?:\s|$)/.exec(rawMessage)?.[1]) || undefined;
  if (status === 400 || status === 422) {
    return { title: 'Please check the information entered', description: formatApiError(value, fallback) };
  }
  if (status === 401) {
    return { title: 'Sign-in required', description: 'Your session has ended. Please sign in again and continue.' };
  }
  if (status === 403) {
    const description = formatApiError(value, '');
    return {
      title: 'Access restricted',
      description: description && !/^(403|forbidden|access denied)$/i.test(description.trim())
        ? description
        : 'Your role does not allow this action. Contact an administrator if you need access.',
    };
  }
  if (status === 404) {
    return { title: 'Record not available', description: 'This record may have been removed or you may no longer have access to it.' };
  }
  if (status === 409) {
    return { title: 'Record changed', description: 'Another user updated this record. Refresh the page before trying again.' };
  }
  if (status === 429) {
    return { title: 'Please wait a moment', description: 'Too many requests were sent. Try again shortly.' };
  }
  if (status != null && status >= 500) {
    return {
      title: 'This page is temporarily unavailable',
      description: 'Your data is safe. Refresh the page and try again. If the problem continues, contact your administrator.',
    };
  }

  const description = formatApiError(value, fallback);
  if (/could not reach the server|connection/i.test(description)) {
    return { title: 'Connection unavailable', description };
  }
  return { title: 'We could not complete that request', description };
}

export async function apiErrorFromResponse(response: Response, fallback?: string) {
  const raw = await response.text().catch(() => '');
  const validationErrors = parseFormErrors(raw);
  const message = formatApiError(validationErrors, fallback);
  if (Object.keys(validationErrors.fields).length === 0 && validationErrors.form.length === 0) {
    validationErrors.form = [message];
  }
  return new ApiFormError(message, validationErrors, response.status);
}
