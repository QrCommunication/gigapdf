/**
 * Tests for POST /api/pdf/unlock — remove the password protection from a PDF.
 *
 * Strategy (mirrors color.test.ts / page-boxes.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake engine records encryptionInfo / openEncrypted and the fake doc
 *     records removeEncryption() + close(), returning real `%PDF` bytes, so the
 *     route contract — status, headers, body, which engine method runs, and that
 *     doc.close() always fires — is exercised end to end.
 *   - Use the REAL validatePdfFile / sanitizeContentDisposition (server-only is
 *     stubbed so they import in jsdom).
 *   - Mock @/lib/auth-helpers to control auth, and the logger to stay quiet.
 *   - Drive POST directly with a fake Request whose formData() resolves sync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsdom polyfill: File.prototype.arrayBuffer ────────────────────────────────
if (!('arrayBuffer' in File.prototype)) {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function (this: File): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

// ── Hoisted engine mocks (referenced by the vi.mock factory AND the tests) ────
const engine = vi.hoisted(() => ({
  encryptionInfo: vi.fn(),
  openEncrypted: vi.fn(),
  removeEncryption: vi.fn(),
  close: vi.fn(),
  loadDefault: vi.fn(),
}));

vi.mock('@qrcommunication/gigapdf-lib', () => ({
  GigaPdfEngine: { loadDefault: engine.loadDefault },
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 'server-only' guard — pulled in by request-validation + content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '../unlock/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENCRYPTED_PDF = new Uint8Array(
  Array.from('%PDF-1.7\nencrypted\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

/** Distinct bytes so the passthrough test can prove the body is unchanged. */
const PLAIN_PDF = new Uint8Array(
  Array.from('%PDF-1.4\nplaintext-passthrough\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

/** What removeEncryption() hands back — a different body again. */
const UNLOCKED_PDF = new Uint8Array(
  Array.from('%PDF-1.7\nunlocked-output\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const mockAuthOk = {
  ok: true as const,
  context: { userId: 'user-123', email: 'test@example.com', role: 'user' },
};

const mockAuthFail = {
  ok: false as const,
  response: new Response(JSON.stringify({ success: false, error: 'Authentication required.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
};

function makeFile(name: string, content: Uint8Array, type = 'application/pdf'): File {
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type });
}

function makeRequest(fields: { key: string; value: File | string }[]): Request {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);
  const req = new Request('http://localhost/api/pdf/unlock', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

/** A request with a valid PDF file + the given password. */
function makeUnlockRequest(
  content: Uint8Array,
  password: string | null,
  name = 'doc.pdf',
): Request {
  const fields: { key: string; value: File | string }[] = [
    { key: 'file', value: makeFile(name, content) },
  ];
  if (password !== null) fields.push({ key: 'password', value: password });
  return makeRequest(fields);
}

async function responseBytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

function startsWithPdf(buf: Uint8Array): boolean {
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/unlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    // Default: an encrypted document that opens with the right password.
    engine.encryptionInfo.mockReturnValue({
      encrypted: true,
      permissions: -1,
      version: 5,
      revision: 6,
    });
    engine.removeEncryption.mockReturnValue(UNLOCKED_PDF);
    engine.close.mockReturnValue(undefined);
    engine.openEncrypted.mockReturnValue({
      removeEncryption: engine.removeEncryption,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({
      encryptionInfo: engine.encryptionInfo,
      openEncrypted: engine.openEncrypted,
    });
  });

  // ── Auth + input guards ─────────────────────────────────────────────────────

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeUnlockRequest(ENCRYPTED_PDF, 'secret'));
    expect(res.status).toBe(401);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'password', value: 'secret' }]));
    expect(res.status).toBe(400);
    expect(engine.encryptionInfo).not.toHaveBeenCalled();
  });

  it('returns 400 when the file is empty', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('empty.pdf', new Uint8Array(0)) },
        { key: 'password', value: 'secret' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/empty/i);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('encrypted + correct password → 200 application/pdf, removeEncryption() + close()', async () => {
    const res = await POST(makeUnlockRequest(ENCRYPTED_PDF, 'secret'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-PDF-Unlock-Status')).toBe('unlocked');
    expect(res.headers.get('Content-Disposition')).toContain('doc.pdf');

    const body = await responseBytes(res);
    expect(startsWithPdf(body)).toBe(true);
    expect(Array.from(body)).toEqual(Array.from(UNLOCKED_PDF));

    // openEncrypted received the raw bytes + the password.
    const call = engine.openEncrypted.mock.calls[0];
    expect(call?.[0]).toBeInstanceOf(Uint8Array);
    expect(call?.[1]).toBe('secret');
    expect(engine.removeEncryption).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  // ── Not-encrypted passthrough ───────────────────────────────────────────────

  it('not-encrypted PDF → 200 passthrough, body unchanged, never opens/decrypts', async () => {
    engine.encryptionInfo.mockReturnValue({
      encrypted: false,
      permissions: -1,
      version: 0,
      revision: 0,
    });
    const res = await POST(makeUnlockRequest(PLAIN_PDF, 'whatever'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-PDF-Unlock-Status')).toBe('not-encrypted');

    const body = await responseBytes(res);
    expect(Array.from(body)).toEqual(Array.from(PLAIN_PDF));
    expect(engine.openEncrypted).not.toHaveBeenCalled();
    expect(engine.removeEncryption).not.toHaveBeenCalled();
  });

  // ── Wrong / missing password ────────────────────────────────────────────────

  it('encrypted + wrong password (openEncrypted → null) → 422', async () => {
    engine.openEncrypted.mockReturnValue(null);
    const res = await POST(makeUnlockRequest(ENCRYPTED_PDF, 'nope'));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/incorrect password/i);
    expect(engine.removeEncryption).not.toHaveBeenCalled();
    // doc was null → nothing to close.
    expect(engine.close).not.toHaveBeenCalled();
  });

  it('encrypted + missing password → 400 (password required)', async () => {
    const res = await POST(makeUnlockRequest(ENCRYPTED_PDF, null));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/password is required/i);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
  });

  it('encrypted + empty-string password → 400 (password required)', async () => {
    const res = await POST(makeUnlockRequest(ENCRYPTED_PDF, ''));
    expect(res.status).toBe(400);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
  });

  // ── Engine error surfaces ───────────────────────────────────────────────────

  it('returns 422 when the file cannot be parsed as a PDF (encryptionInfo throws)', async () => {
    engine.encryptionInfo.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(makeUnlockRequest(ENCRYPTED_PDF, 'secret'));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/corrupted/i);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
  });

  it('returns 422 when removeEncryption() throws, and still closes the doc', async () => {
    engine.removeEncryption.mockImplementation(() => {
      throw new Error('unsupported cipher');
    });
    const res = await POST(makeUnlockRequest(ENCRYPTED_PDF, 'secret'));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/failed to remove the protection/i);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });
});
