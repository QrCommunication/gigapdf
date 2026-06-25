/**
 * Tests for /api/pdf/attachments — embedded file attachments + associated files
 * (Factur-X / ZUGFeRD / Order-X), issue #78.
 *
 * Strategy (mirrors pdfa.test.ts / compress.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc exposes attachments/addAttachment/addAssociatedFile/
 *     removeAttachment/addFileAttachmentAnnot/save/close so the route contract —
 *     status, headers, which engine method runs for each action/relationship,
 *     and the JSON list mapping — is exercised without the real engine.
 *   - Use the REAL validatePdfFile / sanitizeContentDisposition ('server-only'
 *     is stubbed so they import in jsdom).
 *   - Mock @/lib/auth-helpers to control auth and the logger to stay quiet.
 *   - Drive GET/POST directly with a fake Request whose formData() resolves sync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsdom polyfill: File/Blob.prototype.arrayBuffer ───────────────────────────
for (const proto of [File.prototype, Blob.prototype]) {
  if (!('arrayBuffer' in proto)) {
    Object.defineProperty(proto, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value: function (this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
}

// ── Hoisted engine mocks (referenced by the vi.mock factory AND the tests) ────
const engine = vi.hoisted(() => ({
  attachments: vi.fn(),
  addAttachment: vi.fn(),
  addAssociatedFile: vi.fn(),
  removeAttachment: vi.fn(),
  addFileAttachmentAnnot: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
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

import { GET, POST } from '../attachments/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const FAKE_ATTACHMENT = new Uint8Array(
  Array.from('<Invoice/>', (c) => c.charCodeAt(0) & 0xff),
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
  const req = new Request('http://localhost/api/pdf/attachments', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

const pdfFile = () => makeFile('doc.pdf', FAKE_PDF);
const xmlAttachment = () => makeFile('factur-x.xml', FAKE_ATTACHMENT, 'application/xml');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/api/pdf/attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.attachments.mockReturnValue([
      {
        name: 'factur-x.xml',
        filename: 'factur-x.xml',
        mime: 'application/xml',
        description: 'e-invoice',
        creationDate: 'D:20260101000000Z',
        modDate: null,
        data: FAKE_ATTACHMENT,
      },
    ]);
    engine.addAttachment.mockReturnValue(true);
    engine.addAssociatedFile.mockReturnValue(true);
    engine.removeAttachment.mockReturnValue(true);
    engine.addFileAttachmentAnnot.mockReturnValue(true);
    engine.save.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      attachments: engine.attachments,
      addAttachment: engine.addAttachment,
      addAssociatedFile: engine.addAssociatedFile,
      removeAttachment: engine.removeAttachment,
      addFileAttachmentAnnot: engine.addFileAttachmentAnnot,
      save: engine.save,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  // ── auth ──────────────────────────────────────────────────────────────────

  it('GET returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await GET(makeRequest([{ key: 'file', value: pdfFile() }]));
    expect(res.status).toBe(401);
  });

  it('POST returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
      ]),
    );
    expect(res.status).toBe(401);
  });

  // ── GET list ────────────────────────────────────────────────────────────────

  it('GET returns 400 when no file is supplied', async () => {
    const res = await GET(makeRequest([]));
    expect(res.status).toBe(400);
  });

  it('GET lists attachments as EmbeddedFileObject JSON', async () => {
    const res = await GET(makeRequest([{ key: 'file', value: pdfFile() }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { attachments: { name: string; mimeType: string; sizeBytes: number; dataUrl: string; description: string | null }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.attachments).toHaveLength(1);
    const att = body.data.attachments[0]!;
    expect(att.name).toBe('factur-x.xml');
    expect(att.mimeType).toBe('application/xml');
    expect(att.sizeBytes).toBe(FAKE_ATTACHMENT.length);
    expect(att.description).toBe('e-invoice');
    expect(att.dataUrl.startsWith('data:application/xml;base64,')).toBe(true);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('GET returns 422 when the engine cannot read the PDF', async () => {
    engine.open.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await GET(makeRequest([{ key: 'file', value: pdfFile() }]));
    expect(res.status).toBe(422);
  });

  // ── POST add ──────────────────────────────────────────────────────────────

  it('POST returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'action', value: 'add' }]));
    expect(res.status).toBe(400);
  });

  it('POST returns 400 for an unknown action', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'frobnicate' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/action must be/i);
  });

  it('POST add (no relationship) → addAttachment, %PDF binary, closes the doc', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Attachment-Action')).toBe('add');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    // Name defaults to the uploaded file name; mime defaults to its type.
    expect(engine.addAttachment).toHaveBeenCalledWith(
      'factur-x.xml',
      expect.any(Uint8Array),
      expect.objectContaining({ mime: 'application/xml' }),
    );
    expect(engine.addAssociatedFile).not.toHaveBeenCalled();
    expect(engine.save).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('POST add with relationship=alternative → addAssociatedFile (Factur-X), not addAttachment', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
        { key: 'relationship', value: 'alternative' },
        { key: 'description', value: 'ZUGFeRD invoice' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.addAssociatedFile).toHaveBeenCalledWith(
      'factur-x.xml',
      expect.any(Uint8Array),
      'alternative',
      expect.objectContaining({ mime: 'application/xml', description: 'ZUGFeRD invoice' }),
    );
    expect(engine.addAttachment).not.toHaveBeenCalled();
  });

  it('POST add honours an explicit name and mime override', async () => {
    await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
        { key: 'name', value: 'custom-key.xml' },
        { key: 'mime', value: 'text/xml' },
      ]),
    );
    expect(engine.addAttachment).toHaveBeenCalledWith(
      'custom-key.xml',
      expect.any(Uint8Array),
      expect.objectContaining({ mime: 'text/xml' }),
    );
  });

  it('POST add with annotate=true also drops a FileAttachment annotation', async () => {
    await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
        { key: 'annotate', value: 'true' },
        { key: 'page', value: '2' },
        { key: 'rect', value: JSON.stringify({ x: 10, y: 20, w: 30, h: 40 }) },
        { key: 'icon', value: 'Paperclip' },
      ]),
    );
    expect(engine.addFileAttachmentAnnot).toHaveBeenCalledWith(
      2,
      { x: 10, y: 20, w: 30, h: 40 },
      'factur-x.xml',
      'Paperclip',
    );
  });

  it('POST add returns 400 for an unknown relationship', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
        { key: 'relationship', value: 'sidecar' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/relationship must be one of/i);
    expect(engine.addAssociatedFile).not.toHaveBeenCalled();
  });

  it('POST add returns 400 when the attachment file is missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/attachment file field/i);
  });

  it('POST add returns 413 when the attachment exceeds the size cap', async () => {
    const big = xmlAttachment();
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 + 1, configurable: true });
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: big },
      ]),
    );
    expect(res.status).toBe(413);
  });

  it('POST add returns 422 when the engine refuses the embed', async () => {
    engine.addAttachment.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
      ]),
    );
    expect(res.status).toBe(422);
  });

  // ── POST remove ─────────────────────────────────────────────────────────────

  it('POST remove → removeAttachment, %PDF binary', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'remove' },
        { key: 'name', value: 'factur-x.xml' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Attachment-Action')).toBe('remove');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.removeAttachment).toHaveBeenCalledWith('factur-x.xml');
    expect(engine.save).toHaveBeenCalledTimes(1);
  });

  it('POST remove returns 404 when no attachment has that name', async () => {
    engine.removeAttachment.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'remove' },
        { key: 'name', value: 'ghost.bin' },
      ]),
    );
    expect(res.status).toBe(404);
  });

  it('POST remove returns 400 when no name is supplied', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'remove' },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it('POST returns 422 when the engine cannot open the PDF', async () => {
    engine.open.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'action', value: 'add' },
        { key: 'attachment', value: xmlAttachment() },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
