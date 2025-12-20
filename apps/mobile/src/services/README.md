# GigaPDF API Services

Complete API client services for the GigaPDF React Native mobile application.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Services Overview](#services-overview)
- [Usage Examples](#usage-examples)
- [Error Handling](#error-handling)
- [TypeScript Support](#typescript-support)

## Installation

All required dependencies are already included in the project:

```bash
npm install axios expo-secure-store expo-file-system
```

## Configuration

### API Base URL

The API is configured to use `https://giga-pdf.com/api/v1` by default. To change this, modify the `API_BASE_URL` constant in `/home/rony/Projets/gigapdf/apps/mobile/src/services/api.ts`.

### Authentication

The services automatically handle JWT token storage using `expo-secure-store` for secure token management.

## Services Overview

### 1. API Client (`api.ts`)

Core Axios instance with automatic token refresh, error handling, and request/response interceptors.

**Features:**
- Automatic JWT token injection
- Token refresh on 401 errors
- Secure token storage with expo-secure-store
- Upload/download progress tracking
- Request/response logging in development
- Centralized error handling

### 2. Authentication Service (`auth.ts`)

Handles user authentication and account management.

**Methods:**
- `login(credentials)` - Login with email/password
- `register(data)` - Register new user
- `logout()` - Logout and clear tokens
- `refreshToken()` - Refresh access token
- `getCurrentUser()` - Get current user data
- `updateProfile(data)` - Update user profile
- `changePassword()` - Change password
- `requestPasswordReset(email)` - Request password reset
- `resetPassword()` - Reset password with token
- `verifyEmail(token)` - Verify email address
- `deleteAccount(password)` - Delete user account

**Social Auth:**
- `socialAuthService.loginWithGoogle(idToken)`
- `socialAuthService.loginWithFacebook(accessToken)`
- `socialAuthService.loginWithApple(identityToken, authCode)`

**Two-Factor Auth:**
- `twoFactorAuthService.enable()`
- `twoFactorAuthService.confirm(code)`
- `twoFactorAuthService.disable(password)`
- `twoFactorAuthService.verify(code, tempToken)`

### 3. Documents Service (`documents.ts`)

Manages PDF documents with comprehensive operations.

**Methods:**
- `list(params)` - Get paginated documents
- `get(id)` - Get document details
- `upload(data, onProgress)` - Upload PDF
- `update(id, data)` - Update document
- `delete(id)` - Delete document
- `download(id, onProgress)` - Download to local file
- `unlock(id, password)` - Unlock protected PDF
- `extractText(id, pageNumbers)` - Extract text
- `searchText(id, query)` - Search within document
- `duplicate(id, title)` - Duplicate document
- `merge(documentIds, title)` - Merge multiple PDFs
- `split(id, splitPoints)` - Split document
- `compress(id, quality)` - Compress PDF
- `protect(id, password, permissions)` - Add password protection
- `addWatermark(id, watermarkData)` - Add watermark
- `share(id, emails, permissions)` - Share with users

### 4. Pages Service (`pages.ts`)

Handles page-level operations within documents.

**Methods:**
- `list(documentId)` - Get all pages
- `get(documentId, pageNumber)` - Get page details
- `getPreview(documentId, pageNumber, width, height)` - Get preview image
- `add(documentId, data, onProgress)` - Add page
- `delete(documentId, pageNumber)` - Delete page
- `reorder(documentId, data)` - Reorder pages
- `rotate(documentId, pageNumber, rotation)` - Rotate page
- `extract(documentId, data)` - Extract pages
- `duplicate(documentId, pageNumber, position)` - Duplicate page
- `move(documentId, pageNumber, newPosition)` - Move page
- `replace(documentId, pageNumber, file)` - Replace page
- `crop(documentId, pageNumber, cropData)` - Crop page
- `resize(documentId, pageNumber, width, height)` - Resize page
- `extractText(documentId, pageNumber)` - Extract text from page
- `convertToImage(documentId, pageNumber, format)` - Convert to image

### 5. Elements Service (`elements.ts`)

Manages PDF elements (text, images, signatures, shapes, etc.).

**Methods:**
- `list(documentId, pageNumber)` - Get all elements on page
- `get(documentId, elementId)` - Get element details
- `create(documentId, pageNumber, data, onProgress)` - Create element
- `update(documentId, elementId, data)` - Update element
- `delete(documentId, elementId)` - Delete element
- `duplicate(documentId, elementId, offset)` - Duplicate element
- `moveToPage(documentId, elementId, pageNumber)` - Move to page
- `bringToFront(documentId, elementId)` - Bring to front
- `sendToBack(documentId, elementId)` - Send to back
- `lock(documentId, elementId)` - Lock element
- `unlock(documentId, elementId)` - Unlock element
- `group(documentId, elementIds)` - Group elements
- `align(documentId, elementIds, alignment)` - Align elements
- `rotate(documentId, elementId, rotation)` - Rotate element
- `updateText(documentId, elementId, content)` - Update text
- `replaceImage(documentId, elementId, image)` - Replace image

### 6. Annotations Service (`annotations.ts`)

Handles annotations (highlights, notes, links, markup).

**Methods:**
- `list(documentId, pageNumber)` - Get page annotations
- `listAll(documentId)` - Get all document annotations
- `get(documentId, annotationId)` - Get annotation details
- `createHighlight(documentId, pageNumber, data)` - Create highlight
- `createUnderline(documentId, pageNumber, data)` - Create underline
- `createStrikeout(documentId, pageNumber, data)` - Create strikeout
- `createNote(documentId, pageNumber, data)` - Create note
- `createLink(documentId, pageNumber, data)` - Create link
- `update(documentId, annotationId, data)` - Update annotation
- `delete(documentId, annotationId)` - Delete annotation
- `updateColor(documentId, annotationId, color)` - Change color
- `addReply(documentId, annotationId, content)` - Add reply
- `markAsResolved(documentId, annotationId)` - Mark resolved
- `export(documentId, format)` - Export annotations
- `import(documentId, file, format)` - Import annotations

## Usage Examples

### Authentication

```typescript
import { authService } from '@/services';

// Login
try {
  const response = await authService.login({
    email: 'user@example.com',
    password: 'password123',
  });

  console.log('Logged in:', response.user);
  // Tokens are automatically stored
} catch (error) {
  console.error('Login failed:', error.message);
}

// Get current user
const user = await authService.getCurrentUser();

// Logout
await authService.logout();
```

### Document Upload

```typescript
import { documentsService } from '@/services';
import * as DocumentPicker from 'expo-document-picker';

// Pick and upload document
const result = await DocumentPicker.getDocumentAsync({
  type: 'application/pdf',
});

if (result.type === 'success') {
  const document = await documentsService.upload(
    {
      file: result,
      title: 'My Document',
    },
    (progress) => {
      console.log(`Upload progress: ${progress}%`);
    }
  );

  console.log('Uploaded:', document);
}
```

### Document Operations

```typescript
import { documentsService, pagesService } from '@/services';

// Get documents list
const documents = await documentsService.list({
  page: 1,
  per_page: 20,
  sort_by: 'created_at',
  sort_order: 'desc',
});

// Download document
const localUri = await documentsService.download(
  documentId,
  (progress) => {
    console.log(`Download: ${progress}%`);
  }
);

// Extract text
const textData = await documentsService.extractText(documentId);
console.log('Extracted text:', textData.full_text);

// Merge documents
const merged = await documentsService.merge(
  ['doc-id-1', 'doc-id-2', 'doc-id-3'],
  'Merged Document'
);
```

### Page Management

```typescript
import { pagesService } from '@/services';

// Get page preview
const preview = await pagesService.getPreview(
  documentId,
  1,
  800,
  1200
);

// Rotate page
await pagesService.rotate(documentId, 1, { rotation: 90 });

// Reorder pages
await pagesService.reorder(documentId, {
  page_numbers: [3, 1, 2, 4, 5],
});

// Extract pages to new document
const newDoc = await pagesService.extract(documentId, {
  page_numbers: [1, 3, 5],
  create_new_document: true,
  new_document_title: 'Extracted Pages',
});
```

### Elements

```typescript
import { elementsService, ElementType } from '@/services';

// Add text element
const textElement = await elementsService.create(
  documentId,
  1,
  {
    type: ElementType.TEXT,
    page_number: 1,
    position: { x: 100, y: 100 },
    size: { width: 200, height: 50 },
    content: 'Hello World',
    font_size: 16,
    color: '#000000',
  }
);

// Add image element
const imageElement = await elementsService.create(
  documentId,
  1,
  {
    type: ElementType.IMAGE,
    page_number: 1,
    position: { x: 50, y: 50 },
    size: { width: 300, height: 200 },
    image: imageFile,
  },
  (progress) => console.log(`Upload: ${progress}%`)
);

// Update element
await elementsService.update(documentId, elementId, {
  position: { x: 150, y: 150 },
  rotation: 45,
});

// Delete element
await elementsService.delete(documentId, elementId);
```

### Annotations

```typescript
import { annotationsService } from '@/services';

// Create highlight
const highlight = await annotationsService.createHighlight(
  documentId,
  1,
  {
    coordinates: [
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 220 },
      { x: 100, y: 220 },
    ],
    color: '#FFFF00',
    opacity: 0.5,
    text_content: 'Important text',
  }
);

// Create note
const note = await annotationsService.createNote(
  documentId,
  1,
  {
    position: { x: 400, y: 300 },
    content: 'This is a comment',
    color: '#FF0000',
  }
);

// Add reply
await annotationsService.addReply(
  documentId,
  annotationId,
  'I agree with this comment'
);

// Get all annotations
const annotations = await annotationsService.listAll(documentId);
```

## Error Handling

All services throw `ApiException` errors with detailed information:

```typescript
import { isApiException, getErrorMessage } from '@/services';

try {
  await documentsService.upload(file);
} catch (error) {
  if (isApiException(error)) {
    console.error('API Error:', error.message);
    console.error('Status:', error.status);
    console.error('Validation errors:', error.errors);
  } else {
    console.error('Unexpected error:', getErrorMessage(error));
  }
}
```

### Common Error Codes

- `401` - Unauthorized (token expired or invalid)
- `403` - Forbidden (insufficient permissions)
- `404` - Resource not found
- `422` - Validation error (check `error.errors` for details)
- `429` - Too many requests (rate limited)
- `500` - Server error

## TypeScript Support

All services are fully typed with TypeScript:

```typescript
import {
  Document,
  Page,
  Element,
  Annotation,
  User,
  DocumentListParams,
  CreateElementData,
} from '@/services/types';

// Type-safe API calls
const documents: PaginatedResponse<Document> = await documentsService.list({
  page: 1,
  per_page: 10,
});

const page: Page = await pagesService.get(documentId, 1);
```

## React Query Integration

These services work great with React Query (already installed):

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { documentsService } from '@/services';

// Query
const { data, isLoading } = useQuery({
  queryKey: ['documents'],
  queryFn: () => documentsService.list(),
});

// Mutation
const uploadMutation = useMutation({
  mutationFn: (file: any) => documentsService.upload({ file }),
  onSuccess: (document) => {
    console.log('Uploaded:', document);
  },
});
```

## Advanced Features

### Progress Tracking

Upload and download operations support progress callbacks:

```typescript
await documentsService.upload(
  { file },
  (progress) => {
    setUploadProgress(progress);
  }
);

await documentsService.download(
  documentId,
  (progress) => {
    setDownloadProgress(progress);
  }
);
```

### Automatic Token Refresh

The API client automatically refreshes expired tokens and retries failed requests:

```typescript
// This will automatically refresh token if expired
const user = await authService.getCurrentUser();
```

### Request Cancellation

Use AbortController for request cancellation:

```typescript
const controller = new AbortController();

try {
  const documents = await documentsService.list({
    signal: controller.signal,
  });
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request cancelled');
  }
}

// Cancel request
controller.abort();
```

## Security Best Practices

1. Tokens are stored securely using `expo-secure-store`
2. HTTPS is enforced for all API requests
3. Sensitive data is never logged in production
4. Automatic token rotation on refresh
5. Request timeout protection (30s default, 5min for uploads)

## File Structure

```
src/services/
├── api.ts          # API client configuration
├── auth.ts         # Authentication service
├── documents.ts    # Documents service
├── pages.ts        # Pages service
├── elements.ts     # Elements service
├── annotations.ts  # Annotations service
├── types.ts        # TypeScript type definitions
├── index.ts        # Export all services
└── README.md       # This file
```

## Support

For API documentation, visit: https://giga-pdf.com/api/docs

For issues or questions, contact: support@giga-pdf.com
