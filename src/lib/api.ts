export class ApiHtmlResponseError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(
      message ||
        `Server returned an HTML page instead of JSON (HTTP ${status}). The backend may be restarting or unavailable.`
    );
    this.name = 'ApiHtmlResponseError';
    this.status = status;
  }
}

export function parseApiResponseText<T>(
  text: string,
  status: number,
  contentType = ''
): T {
  const trimmed = text.trimStart();
  const normalizedType = contentType.toLowerCase();
  const looksLikeHtml =
    normalizedType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html');

  if (looksLikeHtml) {
    throw new ApiHtmlResponseError(status);
  }

  let parsed: unknown = null;
  if (trimmed) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Server returned non-JSON response (HTTP ${status}): ${trimmed.slice(0, 120)}`
      );
    }
  }

  if (status < 200 || status >= 300) {
    const errMsg =
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Server responded with HTTP ${status}.`;
    throw new Error(errMsg);
  }

  if (parsed === null) {
    throw new Error(`Server returned an empty JSON body (HTTP ${status}).`);
  }

  return parsed as T;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  return parseApiResponseText<T>(text, res.status, contentType);
}
