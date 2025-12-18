# @giga-pdf/api

API client and TanStack Query hooks for GigaPDF - a collaborative PDF editor application.

## Features

- **Axios-based HTTP client** with automatic token refresh and error handling
- **TanStack Query hooks** for all API endpoints with proper caching and invalidation
- **Socket.IO client** for real-time collaboration features
- **TypeScript support** with full type safety
- **Automatic token management** with localStorage integration
- **WebSocket hooks** for document collaboration, cursor tracking, and live updates

## Installation

```bash
npm install @giga-pdf/api
```

## Usage

### Setup Providers

Wrap your application with the providers:

```tsx
import { QueryProvider, SocketProvider } from '@giga-pdf/api';

function App() {
  return (
    <QueryProvider>
      <SocketProvider autoConnect>
        {/* Your app */}
      </SocketProvider>
    </QueryProvider>
  );
}
```

### Configuration

Configure the API base URL:

```tsx
import { setApiConfig } from '@giga-pdf/api';

setApiConfig({
  baseURL: 'https://api.gigapdf.com/api/v1',
  websocketURL: 'https://api.gigapdf.com',
  timeout: 30000,
});
```

### Authentication

```tsx
import { useLogin, useCurrentUser, useLogout } from '@giga-pdf/api';

function LoginForm() {
  const login = useLogin();
  const { data: user } = useCurrentUser();
  const logout = useLogout();

  const handleLogin = async () => {
    await login.mutateAsync({
      email: 'user@example.com',
      password: 'password',
    });
  };

  return (
    <div>
      {user ? (
        <button onClick={() => logout.mutate()}>Logout</button>
      ) : (
        <button onClick={handleLogin}>Login</button>
      )}
    </div>
  );
}
```

### Documents

```tsx
import { useDocuments, useCreateDocument, useDocument } from '@giga-pdf/api';

function DocumentList() {
  const { data: documents } = useDocuments({ limit: 20 });
  const createDocument = useCreateDocument();

  const handleCreate = async () => {
    await createDocument.mutateAsync({
      title: 'New Document',
    });
  };

  return (
    <div>
      <button onClick={handleCreate}>Create Document</button>
      {documents?.items.map((doc) => (
        <div key={doc.id}>{doc.title}</div>
      ))}
    </div>
  );
}
```

### Real-time Collaboration

```tsx
import { useDocumentCollaboration } from '@giga-pdf/api';

function Editor({ documentId }: { documentId: string }) {
  const { activeUsers, cursors, sendCursorPosition } = useDocumentCollaboration(documentId);

  const handleMouseMove = (e: MouseEvent) => {
    sendCursorPosition({ x: e.clientX, y: e.clientY });
  };

  return (
    <div onMouseMove={handleMouseMove}>
      {/* Show active users */}
      <div>
        Active users: {activeUsers.map(u => u.name).join(', ')}
      </div>

      {/* Render other users' cursors */}
      {cursors.map((cursor) => (
        <div
          key={cursor.userId}
          style={{
            position: 'absolute',
            left: cursor.position.x,
            top: cursor.position.y,
          }}
        >
          {cursor.userName}
        </div>
      ))}
    </div>
  );
}
```

### File Upload

```tsx
import { useFileUpload } from '@giga-pdf/api';

function FileUploader() {
  const { uploadFile, isLoading } = useFileUpload();
  const [progress, setProgress] = useState(0);

  const handleUpload = async (file: File) => {
    await uploadFile(
      file,
      { title: file.name },
      (progress) => setProgress(progress)
    );
  };

  return (
    <div>
      <input
        type="file"
        onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
      />
      {isLoading && <div>Progress: {progress}%</div>}
    </div>
  );
}
```

### Export PDF

```tsx
import { useExportAndDownload } from '@giga-pdf/api';

function ExportButton({ documentId }: { documentId: string }) {
  const { exportAndDownload, isLoading } = useExportAndDownload();

  const handleExport = async () => {
    await exportAndDownload(
      documentId,
      { format: 'pdf', quality: 'high' },
      (status) => console.log('Export status:', status)
    );
  };

  return (
    <button onClick={handleExport} disabled={isLoading}>
      {isLoading ? 'Exporting...' : 'Export PDF'}
    </button>
  );
}
```

## Available Hooks

### Authentication
- `useLogin()` - Login with email/password
- `useRegister()` - Register new user
- `useLogout()` - Logout current user
- `useCurrentUser()` - Get current user profile
- `useUpdateProfile()` - Update user profile

### Documents
- `useDocuments()` - List documents with pagination
- `useDocument()` - Get single document
- `useCreateDocument()` - Create new document
- `useUpdateDocument()` - Update document
- `useDeleteDocument()` - Delete document
- `useDuplicateDocument()` - Duplicate document

### Pages
- `usePages()` - List pages
- `usePage()` - Get single page
- `useCreatePage()` - Create page
- `useUpdatePage()` - Update page
- `useDeletePage()` - Delete page
- `useReorderPages()` - Reorder pages

### Elements
- `useElements()` - List elements
- `useCreateElement()` - Create element
- `useUpdateElement()` - Update element
- `useDeleteElement()` - Delete element
- `useBulkUpdateElements()` - Bulk update elements
- `useGroupElements()` - Group elements

### WebSocket
- `useSocket()` - Manage socket connection
- `useDocumentCollaboration()` - Real-time collaboration
- `useDocumentUpdates()` - Listen for document updates
- `useElementUpdates()` - Listen for element updates
- `useJobStatus()` - Listen for job status updates

## API Services

All services are also exported for direct use:

```tsx
import { authService, documentService } from '@giga-pdf/api';

// Direct API calls without hooks
const user = await authService.getCurrentUser();
const documents = await documentService.list({ limit: 10 });
```

## Error Handling

The client automatically handles errors and converts them to `ApiError`:

```tsx
import { ApiError } from '@giga-pdf/api';

try {
  await login.mutateAsync({ email, password });
} catch (error) {
  if (error instanceof ApiError) {
    console.log('Status:', error.status);
    console.log('Code:', error.code);
    console.log('Message:', error.message);
  }
}
```

## Token Management

Custom token storage:

```tsx
import { setTokenStorage } from '@giga-pdf/api';

setTokenStorage({
  getAccessToken: () => sessionStorage.getItem('token'),
  getRefreshToken: () => sessionStorage.getItem('refresh'),
  setTokens: (access, refresh) => {
    sessionStorage.setItem('token', access);
    sessionStorage.setItem('refresh', refresh);
  },
  clearTokens: () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('refresh');
  },
});
```

## License

MIT
