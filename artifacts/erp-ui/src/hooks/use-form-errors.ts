import { useState } from 'react';
import { formatApiError, parseFormErrors, type FormValidationErrors } from '@/lib/api-errors';

const EMPTY_ERRORS: FormValidationErrors = { fields: {}, form: [] };

type RequiredField = {
  value: unknown;
  label: string;
};

export function useFormErrors() {
  const [errors, setErrors] = useState<FormValidationErrors>(EMPTY_ERRORS);

  function focusFirstInvalidField(fieldNames: string[]) {
    const firstField = fieldNames[0];
    if (!firstField) return;
    window.requestAnimationFrame(() => {
      const element = document.getElementsByName(firstField)[0] as HTMLElement | undefined;
      element?.focus();
    });
  }

  function clear() {
    setErrors(EMPTY_ERRORS);
  }

  function clearField(field: string) {
    setErrors((current) => {
      if (!current.fields[field]) return current;
      const fields = { ...current.fields };
      delete fields[field];
      return { ...current, fields };
    });
  }

  function apply(error: unknown) {
    const parsed = parseFormErrors(error);
    if (Object.keys(parsed.fields).length === 0 && parsed.form.length === 0) {
      parsed.form = [formatApiError(
        error,
        'The server could not save this form. Please try again or contact your administrator if the problem continues.',
      )];
    }
    setErrors(parsed);
    focusFirstInvalidField(Object.keys(parsed.fields));
    return parsed;
  }

  function validateRequired(fields: Record<string, RequiredField>) {
    const fieldErrors = Object.fromEntries(
      Object.entries(fields)
        .filter(([, field]) => field.value == null || String(field.value).trim() === '')
        .map(([name, field]) => [name, [`${field.label} is required.`]]),
    );
    setErrors({ fields: fieldErrors, form: [] });
    focusFirstInvalidField(Object.keys(fieldErrors));
    return Object.keys(fieldErrors).length === 0;
  }

  return { errors, clear, clearField, apply, validateRequired };
}
