/**
 * Tests for POST /api/pdf/change-password — change or set a PDF's password.
 *
 * Strategy (mirrors unlock.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake engine records encryptionInfo / openEncrypted / open and the fake
 *     doc records changePasswords() / saveEncrypted() + close(), returning real
 *     `%PDF` bytes, so the route contract — status, headers, body, which engine
 *     method runs, and that doc.close() always fires — is exercised end to end.
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
  open: vi.fn(),
  changePasswords: vi.fn(),
  saveEncrypted: vi.fn(),
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

import { POST } from '../change-password/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENCRYPTED_PDF = new Uint8Array(
  Array.from('%PDF-1.7\nencrypted\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PLAIN_PDF = new Uint8Array(
  Array.from('%PDF-1.4\nplaintext\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

/** What changePasswords()/saveEncrypted() hand back — a distinct body. */
const REENCRYPTED_PDF = new Uint8Array(
  Array.from('%PDF-1.7\nre-encrypted-output\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
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
  const req = new Request('http://localhost/api/pdf/change-password', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

/** A request with a valid PDF file + the given password fields. */
function makeChangeRequest(
  content: Uint8Array,
  fields: { currentPassword?: string; newUserPassword?: string; newOwnerPassword?: string; algorithm?: string },
  name = 'doc.pdf',
): Request {
  const entries: { key: string; value: File | string }[] = [
    { key: 'file', value: makeFile(name, content) },
  ];
  for (const key of ['currentPassword', 'newUserPassword', 'newOwnerPassword', 'algorithm'] as const) {
    const value = fields[key];
    if (value !== undefined) entries.push({ key, value });
  }
  return makeRequest(entries);
}

async function responseBytes(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

function startsWithPdf(buf: Uint8Array): boolean {
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/change-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    // Default: an encrypted document that opens with the right password.
    engine.encryptionInfo.mockReturnValue({
      encrypted: true,
      permissions: -44, // a non-trivial bitmask we assert is preserved
      version: 5,
      revision: 6,
    });
    engine.changePasswords.mockReturnValue(REENCRYPTED_PDF);
    engine.saveEncrypted.mockReturnValue(REENCRYPTED_PDF);
    engine.close.mockReturnValue(undefined);
    const doc = {
      changePasswords: engine.changePasswords,
      saveEncrypted: engine.saveEncrypted,
      close: engine.close,
    };
    engine.openEncrypted.mockReturnValue(doc);
    engine.open.mockReturnValue(doc);
    engine.loadDefault.mockResolvedValue({
      encryptionInfo: engine.encryptionInfo,
      openEncrypted: engine.openEncrypted,
      open: engine.open,
    });
  });

  // ── Auth + input guards ─────────────────────────────────────────────────────

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'old', newUserPassword: 'new' }));
    expect(res.status).toBe(401);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'newUserPassword', value: 'new' }]));
    expect(res.status).toBe(400);
    expect(engine.encryptionInfo).not.toHaveBeenCalled();
  });

  it('returns 400 when no new password is supplied', async () => {
    const res = await POST(makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'old' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/new password is required/i);
    expect(engine.encryptionInfo).not.toHaveBeenCalled();
  });

  it('returns 400 for an unsupported algorithm', async () => {
    const res = await POST(
      makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'old', newUserPassword: 'new', algorithm: 'RC4' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/algorithm must be one of/i);
  });

  // ── Happy path: rotate an existing password ─────────────────────────────────

  it('encrypted + correct current password → 200, changePasswords() preserves permissions + close()', async () => {
    const res = await POST(
      makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'old', newUserPassword: 'new', newOwnerPassword: 'owner' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-PDF-Password-Status')).toBe('changed');
    expect(res.headers.get('Content-Disposition')).toContain('doc.pdf');

    const body = await responseBytes(res);
    expect(startsWithPdf(body)).toBe(true);
    expect(Array.from(body)).toEqual(Array.from(REENCRYPTED_PDF));

    // openEncrypted received the raw bytes + the CURRENT password.
    const openCall = engine.openEncrypted.mock.calls[0];
    expect(openCall?.[0]).toBeInstanceOf(Uint8Array);
    expect(openCall?.[1]).toBe('old');

    // changePasswords received the NEW user password, a fileId, and opts that
    // carry the owner password + the preserved permission bitmask.
    expect(engine.changePasswords).toHaveBeenCalledTimes(1);
    const changeCall = engine.changePasswords.mock.calls[0];
    expect(changeCall?.[0]).toBe('new');
    expect(typeof changeCall?.[1]).toBe('string');
    expect(changeCall?.[2]).toMatchObject({
      ownerPassword: 'owner',
      algorithm: 'aes256',
      permissions: -44,
    });
    expect(engine.saveEncrypted).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('maps AES-128 to the engine identifier aes128', async () => {
    await POST(
      makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'old', newUserPassword: 'new', algorithm: 'AES-128' }),
    );
    expect(engine.changePasswords.mock.calls[0]?.[2]).toMatchObject({ algorithm: 'aes128' });
  });

  // ── Set a password on a plaintext PDF ───────────────────────────────────────

  it('not encrypted → 200, saveEncrypted() sets the password (no current password needed)', async () => {
    engine.encryptionInfo.mockReturnValue({ encrypted: false, permissions: -1, version: 0, revision: 0 });
    const res = await POST(makeChangeRequest(PLAIN_PDF, { newUserPassword: 'new' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-PDF-Password-Status')).toBe('protected');

    expect(engine.open).toHaveBeenCalledTimes(1);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
    expect(engine.saveEncrypted).toHaveBeenCalledTimes(1);
    expect(engine.changePasswords).not.toHaveBeenCalled();
    // No permissions preserved for a plaintext source (defaults to all granted).
    expect(engine.saveEncrypted.mock.calls[0]?.[2]).not.toHaveProperty('permissions');
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  // ── Wrong / missing current password ────────────────────────────────────────

  it('encrypted + missing current password → 400, never opens', async () => {
    const res = await POST(makeChangeRequest(ENCRYPTED_PDF, { newUserPassword: 'new' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/current password is required/i);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
  });

  it('encrypted + wrong current password (openEncrypted → null) → 422, no re-encrypt, no close', async () => {
    engine.openEncrypted.mockReturnValue(null);
    const res = await POST(makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'nope', newUserPassword: 'new' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/incorrect current password/i);
    expect(engine.changePasswords).not.toHaveBeenCalled();
    expect(engine.close).not.toHaveBeenCalled();
  });

  // ── Engine error surfaces ───────────────────────────────────────────────────

  it('returns 422 when the file cannot be parsed (encryptionInfo throws)', async () => {
    engine.encryptionInfo.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'old', newUserPassword: 'new' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/corrupted/i);
    expect(engine.openEncrypted).not.toHaveBeenCalled();
  });

  it('returns 422 when changePasswords() throws, and still closes the doc', async () => {
    engine.changePasswords.mockImplementation(() => {
      throw new Error('unsupported cipher');
    });
    const res = await POST(makeChangeRequest(ENCRYPTED_PDF, { currentPassword: 'old', newUserPassword: 'new' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/failed to change the password/i);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });
});
