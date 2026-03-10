# Services Validation Checklist

This document helps verify that all services are properly configured and working.

## Pre-flight Checklist

### 1. Dependencies Installed

Check that all required dependencies are installed:

```bash
cd /home/rony/Projets/gigapdf/apps/mobile
npm list axios expo-secure-store expo-file-system @tanstack/react-query
```

Expected output:
- axios@^1.7.7
- expo-secure-store@~15.0.8
- expo-file-system@~19.0.21
- @tanstack/react-query@^5.59.0

### 2. TypeScript Configuration

Verify TypeScript can compile without errors:

```bash
npx tsc --noEmit
```

### 3. Import Test

Create a test file to verify all imports work:

```typescript
// Test file: test-imports.ts
import {
  apiClient,
  authService,
  documentsService,
  pagesService,
  elementsService,
  annotationsService,
} from './src/services';

console.log('All imports successful!');
```

Run:
```bash
npx tsx test-imports.ts
```

## Service Tests

### Authentication Service

```typescript
import { authService } from '@/services';

// Test login (with valid credentials)
const testLogin = async () => {
  try {
    const response = await authService.login({
      email: 'test@example.com',
      password: 'password123',
    });
    console.log('✅ Login successful:', response.user.email);
  } catch (error) {
    console.log('❌ Login failed:', error.message);
  }
};

// Test getting current user
const testCurrentUser = async () => {
  try {
    const user = await authService.getCurrentUser();
    console.log('✅ Current user:', user.email);
  } catch (error) {
    console.log('❌ Get current user failed:', error.message);
  }
};
```

### Documents Service

```typescript
import { documentsService } from '@/services';

// Test listing documents
const testListDocuments = async () => {
  try {
    const response = await documentsService.list({ page: 1, per_page: 10 });
    console.log('✅ Documents loaded:', response.data.length);
  } catch (error) {
    console.log('❌ List documents failed:', error.message);
  }
};

// Test uploading document
const testUploadDocument = async (file: any) => {
  try {
    const document = await documentsService.upload(
      { file },
      (progress) => console.log(`Upload progress: ${progress}%`)
    );
    console.log('✅ Document uploaded:', document.id);
  } catch (error) {
    console.log('❌ Upload failed:', error.message);
  }
};
```

### Pages Service

```typescript
import { pagesService } from '@/services';

// Test getting pages
const testGetPages = async (documentId: string) => {
  try {
    const pages = await pagesService.list(documentId);
    console.log('✅ Pages loaded:', pages.length);
  } catch (error) {
    console.log('❌ Get pages failed:', error.message);
  }
};

// Test getting page preview
const testGetPreview = async (documentId: string, pageNumber: number) => {
  try {
    const preview = await pagesService.getPreview(documentId, pageNumber);
    console.log('✅ Preview loaded:', preview.preview_url);
  } catch (error) {
    console.log('❌ Get preview failed:', error.message);
  }
};
```

### Elements Service

```typescript
import { elementsService, ElementType } from '@/services';

// Test creating element
const testCreateElement = async (documentId: string, pageNumber: number) => {
  try {
    const element = await elementsService.create(documentId, pageNumber, {
      type: ElementType.TEXT,
      page_number: pageNumber,
      position: { x: 100, y: 100 },
      size: { width: 200, height: 50 },
      content: 'Test Text',
      font_size: 14,
    });
    console.log('✅ Element created:', element.id);
  } catch (error) {
    console.log('❌ Create element failed:', error.message);
  }
};
```

### Annotations Service

```typescript
import { annotationsService } from '@/services';

// Test creating annotation
const testCreateAnnotation = async (documentId: string, pageNumber: number) => {
  try {
    const annotation = await annotationsService.createHighlight(
      documentId,
      pageNumber,
      {
        coordinates: [
          { x: 100, y: 200 },
          { x: 300, y: 200 },
          { x: 300, y: 220 },
          { x: 100, y: 220 },
        ],
        color: '#FFFF00',
      }
    );
    console.log('✅ Annotation created:', annotation.id);
  } catch (error) {
    console.log('❌ Create annotation failed:', error.message);
  }
};
```

## React Query Integration Test

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDocuments } from '@/services/examples';

// Setup QueryClient
const queryClient = new QueryClient();

// Test component
function TestComponent() {
  const { data, isLoading, error } = useDocuments();

  if (isLoading) {
    console.log('Loading documents...');
    return null;
  }

  if (error) {
    console.log('❌ Error loading documents:', error.message);
    return null;
  }

  console.log('✅ Documents loaded via React Query:', data?.data.length);
  return null;
}

// Render test
<QueryClientProvider client={queryClient}>
  <TestComponent />
</QueryClientProvider>
```

## Error Handling Test

```typescript
import { getErrorMessage, isValidationError } from '@/services/utils';

// Test error handling
const testErrorHandling = async () => {
  try {
    await authService.login({ email: '', password: '' });
  } catch (error) {
    console.log('Error message:', getErrorMessage(error));
    console.log('Is validation error:', isValidationError(error));
  }
};
```

## Token Management Test

```typescript
import { tokenManager } from '@/services';

// Test token storage
const testTokenManagement = async () => {
  // Set tokens
  await tokenManager.setTokens('access-token', 'refresh-token');
  console.log('✅ Tokens saved');

  // Get tokens
  const accessToken = await tokenManager.getAccessToken();
  const refreshToken = await tokenManager.getRefreshToken();
  console.log('✅ Tokens retrieved:', { accessToken, refreshToken });

  // Clear tokens
  await tokenManager.clearTokens();
  console.log('✅ Tokens cleared');

  // Verify cleared
  const clearedToken = await tokenManager.getAccessToken();
  console.log('✅ Tokens verified cleared:', clearedToken === null);
};
```

## File Validation Test

```typescript
import { validateFile, formatBytes } from '@/services/utils';

// Test file validation
const testFileValidation = () => {
  const validFile = {
    size: 1024 * 1024, // 1 MB
    type: 'application/pdf',
  };

  const result = validateFile(validFile);
  console.log('✅ Valid file:', result.valid);

  const invalidFile = {
    size: 200 * 1024 * 1024, // 200 MB (too large)
    type: 'application/pdf',
  };

  const result2 = validateFile(invalidFile);
  console.log('✅ Invalid file detected:', !result2.valid);
  console.log('Error message:', result2.error);
};
```

## Progress Tracking Test

```typescript
import { useUploadProgress } from '@/services/utils';

// Test progress tracking hook
function TestProgressComponent() {
  const { progress, isUploading, startUpload, updateProgress, finishUpload } =
    useUploadProgress();

  const simulateUpload = () => {
    startUpload();

    let current = 0;
    const interval = setInterval(() => {
      current += 10;
      updateProgress(current);

      if (current >= 100) {
        clearInterval(interval);
        finishUpload();
        console.log('✅ Upload simulation complete');
      }
    }, 100);
  };

  return (
    <button onClick={simulateUpload}>
      {isUploading ? `Uploading ${progress}%` : 'Start Upload'}
    </button>
  );
}
```

## API Configuration Test

```typescript
import { API_CONFIG, getApiUrl, getEnvironment } from '@/services/config';

// Test configuration
const testConfiguration = () => {
  console.log('Environment:', getEnvironment());
  console.log('API URL:', getApiUrl());
  console.log('Timeout:', API_CONFIG.timeouts.default);
  console.log('Max file size:', API_CONFIG.upload.maxFileSize);
  console.log('✅ Configuration loaded successfully');
};
```

## Validation Results

After running all tests, you should see:

```
✅ All dependencies installed
✅ TypeScript compiles without errors
✅ All imports successful
✅ Authentication working
✅ Documents service working
✅ Pages service working
✅ Elements service working
✅ Annotations service working
✅ React Query integration working
✅ Error handling working
✅ Token management working
✅ File validation working
✅ Progress tracking working
✅ Configuration loaded
```

## Common Issues and Solutions

### Issue: "Cannot find module '@/services'"

**Solution:** Configure path alias in tsconfig.json:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

### Issue: "expo-secure-store not found"

**Solution:** Install the dependency:

```bash
npx expo install expo-secure-store
```

### Issue: "Network request failed"

**Solution:** Check API URL in config.ts and ensure the server is running.

### Issue: "401 Unauthorized"

**Solution:** Login first or check if token has expired:

```typescript
const isAuth = await authService.isAuthenticated();
if (!isAuth) {
  await authService.login({ email, password });
}
```

## Production Readiness Checklist

- [ ] All tests passing
- [ ] Error handling tested
- [ ] Token management working
- [ ] File uploads working
- [ ] API endpoints accessible
- [ ] TypeScript types correct
- [ ] React Query configured
- [ ] Progress tracking working
- [ ] Offline handling (optional)
- [ ] Security review done

## Next Steps

1. Run all validation tests
2. Fix any failing tests
3. Update API_CONFIG with production URL
4. Add more specific tests for your use case
5. Implement proper error tracking (Sentry, etc.)
6. Add analytics tracking
7. Configure monitoring

---

**Last Updated:** 2025-12-20
**Status:** Ready for Testing
