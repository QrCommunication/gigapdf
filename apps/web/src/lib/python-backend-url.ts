import 'server-only';

/**
 * Internal URL of the Python FastAPI backend, for server-to-server calls.
 *
 * Dev  : http://localhost:8000  (Python runs alongside Next.js)
 * Prod : http://127.0.0.1:8000  (loopback — bypasses nginx)
 *
 * Override via PYTHON_BACKEND_URL (server-only). Never use NEXT_PUBLIC_API_URL
 * here: it is the browser-facing URL and is unset on the Ploi host.
 */
export const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'http://127.0.0.1:8000'
    : 'http://localhost:8000');
