# @giga-pdf/embed

Embed the GigaPDF editor in any website via a secure iframe.

## Installation

```bash
npm install @giga-pdf/embed
# or
pnpm add @giga-pdf/embed
```

## Usage

### Script tag (CDN)

```html
<div id="editor"></div>

<script src="https://cdn.giga-pdf.com/embed.js"></script>
<script>
  const editor = GigaPdf.init({
    apiKey: 'giga_pk_xxx',
    container: '#editor',
    height: 700,
  });

  editor.on('save', ({ documentId, pageCount }) => {
    console.log('Saved:', documentId, pageCount + ' pages');
  });
</script>
```

### Vanilla JS / ESM

```typescript
import { GigaPdf, GigaPdfEditor } from '@giga-pdf/embed';

// Factory shorthand
const editor = GigaPdf.init({
  apiKey: 'giga_pk_xxx',
  container: document.getElementById('editor'),
  documentId: 'doc_abc123',
  locale: 'fr',
  theme: 'light',
});

editor.on('ready', () => console.log('Editor ready'));
editor.on('save', ({ documentId }) => console.log('Saved:', documentId));
editor.on('error', ({ code, message }) => console.error(code, message));

// Trigger actions programmatically
editor.savePdf();
editor.exportPdf('pdf');
editor.loadDocument('doc_xyz456');

// Cleanup
editor.destroy();
```

### React

```tsx
import { useRef } from 'react';
import { GigaPdfEditor, type GigaPdfEditorRef } from '@giga-pdf/embed/react';

export function MyApp() {
  const editorRef = useRef<GigaPdfEditorRef>(null);

  return (
    <>
      <GigaPdfEditor
        ref={editorRef}
        apiKey="giga_pk_xxx"
        documentId="doc_abc123"
        height={700}
        locale="fr"
        theme="light"
        onReady={() => console.log('ready')}
        onSave={({ documentId, pageCount }) =>
          console.log('saved', documentId, pageCount)
        }
        onError={({ code, message }) => console.error(code, message)}
      />

      <button onClick={() => editorRef.current?.savePdf()}>Save</button>
      <button onClick={() => editorRef.current?.exportPdf()}>Export PDF</button>
    </>
  );
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | — | **Required.** Your GigaPDF API key |
| `container` | `HTMLElement \| string` | — | **Required.** Target element or CSS selector (vanilla only) |
| `documentId` | `string` | — | Document to load. Opens empty editor if omitted |
| `baseUrl` | `string` | `https://giga-pdf.com` | Self-hosted or staging URL |
| `width` | `string \| number` | `"100%"` | iframe width (`number` → px) |
| `height` | `string \| number` | `"600px"` | iframe height (`number` → px) |
| `locale` | `"fr" \| "en"` | `"fr"` | UI language |
| `theme` | `"light" \| "dark" \| "system"` | `"light"` | Color theme |
| `hideToolbar` | `boolean` | `false` | Hide the top toolbar |
| `tools` | `string[]` | all | Restrict available tools: `text`, `image`, `shape`, `annotation`, `form`, `signature` |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `ready` | — | Editor is loaded and ready |
| `save` | `{ documentId: string, pageCount: number }` | Document was saved |
| `export` | `{ blob: Blob, format: string }` | Export completed |
| `error` | `{ code: string, message: string }` | An error occurred |
| `pageChange` | `{ page: number, total: number }` | Active page changed |

## Methods

| Method | Description |
|--------|-------------|
| `on(event, callback)` | Subscribe to an event |
| `off(event, callback)` | Unsubscribe from an event |
| `savePdf()` | Trigger a save |
| `exportPdf(format?)` | Trigger export (default format: `"pdf"`) |
| `loadDocument(documentId)` | Load a different document |
| `destroy()` | Remove the iframe and clean up all listeners |

## React ref methods

When using the React component with a `ref`, the following methods are available:

```typescript
editorRef.current?.savePdf()
editorRef.current?.exportPdf(format?)
editorRef.current?.loadDocument(documentId)
```
