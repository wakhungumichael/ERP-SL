import type { ApiEnvelope, QueryParamValue, QueryScope } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const TOKEN_STORAGE_KEY = "platform-console-api-token";

function buildUrl(path: string, scope: QueryScope, extras?: Record<string, QueryParamValue>) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (scope.tenantCode) {
    url.searchParams.set("tenant_code", scope.tenantCode);
  }
  if (scope.branchId) {
    url.searchParams.set("branch_id", scope.branchId);
  }
  Object.entries(extras || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function buildHeaders(token?: string) {
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };
  if (token) {
    headers.Authorization = `Token ${token}`;
  }
  return headers;
}

async function parseResponseBody(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function buildErrorFromResponse(response: Response, payload: unknown) {
  function formatErrors(errors: unknown): string | null {
    if (Array.isArray(errors)) {
      return errors.map((item) => String(item)).join(" ");
    }

    if (errors && typeof errors === "object") {
      const values = Object.values(errors as Record<string, unknown>)
        .map((value) => formatErrors(value))
        .filter(Boolean);
      return values.length ? values.join(" ") : null;
    }

    if (typeof errors === "string" && errors.trim()) {
      return errors;
    }

    return null;
  }

  if (payload && typeof payload === "object") {
    const message = (payload as { message?: string }).message;
    const errors = (payload as { errors?: unknown }).errors;
    if (message && errors) {
      const formattedErrors = formatErrors(errors);
      if (formattedErrors) {
        return new Error(formattedErrors);
      }
      return new Error(message);
    }
    if (message) {
      return new Error(message);
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    return new Error(payload);
  }

  return new Error(`Request failed with status ${response.status}`);
}

export function getSavedToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

export function saveToken(token: string) {
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export async function fetchEnvelope<T>(
  path: string,
  scope: QueryScope,
  extras?: Record<string, QueryParamValue>,
  token?: string,
): Promise<ApiEnvelope<T>> {
  const response = await fetch(buildUrl(path, scope, extras), {
    headers: buildHeaders(token),
  });
  const payload = await parseResponseBody(response);
  if (!response.ok) {
    throw buildErrorFromResponse(response, payload);
  }
  return payload as ApiEnvelope<T>;
}

export async function postEnvelope<T>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<ApiEnvelope<T>> {
  const response = await fetch(new URL(`${API_BASE_URL}${path}`, window.location.origin).toString(), {
    method: "POST",
    headers: {
      ...buildHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await parseResponseBody(response);
  if (!response.ok) {
    throw buildErrorFromResponse(response, payload);
  }
  return payload as ApiEnvelope<T>;
}
