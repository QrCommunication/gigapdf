# Quick Integration Guide

This guide will help you integrate the GigaPDF API services into your React Native application.

## Table of Contents

1. [Setup](#setup)
2. [Basic Usage](#basic-usage)
3. [React Query Integration](#react-query-integration)
4. [Authentication Flow](#authentication-flow)
5. [Error Handling](#error-handling)
6. [Best Practices](#best-practices)

## Setup

### 1. Install Dependencies

All dependencies are already installed in the project:

```bash
npm install axios expo-secure-store expo-file-system @tanstack/react-query
```

### 2. Configure API Base URL

The default API URL is `https://giga-pdf.com/api/v1`. To change it:

Edit `/home/rony/Projets/gigapdf/apps/mobile/src/services/config.ts`:

```typescript
export const API_CONFIG = {
  baseURL: 'YOUR_API_URL',
  // ... rest of config
};
```

### 3. Setup React Query Provider

Wrap your app with QueryClientProvider:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 3,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Your app content */}
    </QueryClientProvider>
  );
}
```

## Basic Usage

### Import Services

```typescript
import {
  authService,
  documentsService,
  pagesService,
  elementsService,
  annotationsService,
} from '@/services';
```

### Simple API Calls

```typescript
// Login
const response = await authService.login({
  email: 'user@example.com',
  password: 'password123',
});

// Get documents
const documents = await documentsService.list({ page: 1, per_page: 20 });

// Upload document
const document = await documentsService.upload(
  { file: selectedFile },
  (progress) => console.log(`${progress}%`)
);
```

## React Query Integration

### Using Pre-built Hooks

```typescript
import { useDocuments, useDocumentUpload } from '@/services/examples';

function DocumentsScreen() {
  const { data, isLoading, error } = useDocuments({ page: 1 });
  const uploadMutation = useDocumentUpload();

  const handleUpload = async (file: any) => {
    await uploadMutation.mutateAsync({
      data: { file },
      onProgress: (progress) => setProgress(progress),
    });
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <View>
      {data?.data.map((doc) => (
        <DocumentItem key={doc.id} document={doc} />
      ))}
    </View>
  );
}
```

### Creating Custom Hooks

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { documentsService } from '@/services';

function useMyDocuments() {
  return useQuery({
    queryKey: ['my-documents'],
    queryFn: () => documentsService.list(),
  });
}

function useDocumentUpdate() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      documentsService.update(id, data),
  });
}
```

## Authentication Flow

### 1. Login Screen

```typescript
import { useLogin } from '@/services/examples';
import { useState } from 'react';

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const loginMutation = useLogin();

  const handleLogin = async () => {
    try {
      const response = await loginMutation.mutateAsync({
        email,
        password,
      });

      // Navigate to home screen
      navigation.navigate('Home');
    } catch (error) {
      // Show error message
      Alert.alert('Error', getErrorMessage(error));
    }
  };

  return (
    <View>
      <TextInput value={email} onChangeText={setEmail} />
      <TextInput value={password} onChangeText={setPassword} secureTextEntry />
      <Button
        title="Login"
        onPress={handleLogin}
        disabled={loginMutation.isPending}
      />
    </View>
  );
}
```

### 2. Protected Routes

```typescript
import { useCurrentUser } from '@/services/examples';
import { useEffect } from 'react';

function ProtectedScreen() {
  const { data: user, isLoading, error } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && !user) {
      // Redirect to login
      navigation.navigate('Login');
    }
  }, [user, isLoading]);

  if (isLoading) return <LoadingSpinner />;
  if (!user) return null;

  return <View>{/* Protected content */}</View>;
}
```

### 3. Auto-Logout on Token Expiry

```typescript
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    // Listen for unauthorized events
    const handleUnauthorized = () => {
      // Clear state and navigate to login
      navigation.navigate('Login');
      Alert.alert('Session Expired', 'Please login again');
    };

    window.addEventListener('api:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('api:unauthorized', handleUnauthorized);
    };
  }, []);

  return <NavigationContainer>{/* Your routes */}</NavigationContainer>;
}
```

## Error Handling

### Global Error Handler

```typescript
import { getErrorMessage, getValidationErrors } from '@/services/utils';

function handleApiError(error: any) {
  const message = getErrorMessage(error);
  const validationErrors = getValidationErrors(error);

  if (validationErrors) {
    // Handle validation errors
    Object.keys(validationErrors).forEach((field) => {
      console.log(`${field}: ${validationErrors[field].join(', ')}`);
    });
  } else {
    // Show general error
    Alert.alert('Error', message);
  }
}
```

### Error Boundary Component

```typescript
import React from 'react';

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View>
          <Text>Something went wrong</Text>
          <Button title="Retry" onPress={() => this.setState({ hasError: false })} />
        </View>
      );
    }

    return this.props.children;
  }
}
```

## Best Practices

### 1. Use TypeScript

```typescript
import { Document, Page, Element } from '@/services/types';

function DocumentComponent({ document }: { document: Document }) {
  // TypeScript ensures type safety
}
```

### 2. Cache Management

```typescript
import { useQueryClient } from '@tanstack/react-query';

function DocumentEditor() {
  const queryClient = useQueryClient();

  const handleUpdate = async (data: any) => {
    await documentsService.update(id, data);

    // Invalidate cache to refetch
    queryClient.invalidateQueries({ queryKey: ['documents'] });

    // Or update cache directly
    queryClient.setQueryData(['document', id], (old: any) => ({
      ...old,
      ...data,
    }));
  };
}
```

### 3. Optimistic Updates

```typescript
const updateMutation = useMutation({
  mutationFn: (data) => documentsService.update(id, data),
  onMutate: async (newData) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: ['document', id] });

    // Snapshot previous value
    const previous = queryClient.getQueryData(['document', id]);

    // Optimistically update
    queryClient.setQueryData(['document', id], (old: any) => ({
      ...old,
      ...newData,
    }));

    return { previous };
  },
  onError: (err, newData, context) => {
    // Rollback on error
    queryClient.setQueryData(['document', id], context.previous);
  },
});
```

### 4. Loading States

```typescript
function DocumentList() {
  const { data, isLoading, isFetching, error } = useDocuments();

  // Initial loading
  if (isLoading) return <LoadingSpinner />;

  // Error state
  if (error) return <ErrorMessage error={error} />;

  return (
    <View>
      {/* Show subtle indicator while refetching */}
      {isFetching && <RefreshIndicator />}

      {data?.data.map((doc) => (
        <DocumentItem key={doc.id} document={doc} />
      ))}
    </View>
  );
}
```

### 5. Request Cancellation

```typescript
import { useEffect } from 'react';

function SearchDocuments() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 500);

  const { data, isLoading } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: ({ signal }) =>
      documentsService.list({
        search: debouncedQuery,
        signal, // Pass AbortSignal
      }),
    enabled: debouncedQuery.length > 2,
  });

  // Automatically cancels previous requests when query changes
}
```

### 6. File Upload with Progress

```typescript
import { useUploadProgress } from '@/services/utils';

function DocumentUpload() {
  const { progress, isUploading, startUpload, updateProgress, finishUpload } =
    useUploadProgress();

  const handleUpload = async (file: any) => {
    startUpload();

    try {
      await documentsService.upload({ file }, updateProgress);
      finishUpload();
      Alert.alert('Success', 'Document uploaded!');
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error));
    }
  };

  return (
    <View>
      {isUploading && <ProgressBar progress={progress} />}
      <Button title="Upload" onPress={() => pickAndUpload()} />
    </View>
  );
}
```

### 7. Offline Support (Optional)

```typescript
import NetInfo from '@react-native-community/netinfo';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst', // Use cached data when offline
      refetchOnReconnect: true, // Refetch when back online
    },
  },
});

// Listen for network changes
NetInfo.addEventListener((state) => {
  if (state.isConnected) {
    queryClient.invalidateQueries(); // Refetch all on reconnect
  }
});
```

## Common Patterns

### Document Upload and Navigate

```typescript
const uploadAndNavigate = async (file: any) => {
  try {
    const document = await documentsService.upload(
      { file },
      (progress) => setProgress(progress)
    );

    navigation.navigate('DocumentViewer', { documentId: document.id });
  } catch (error) {
    handleApiError(error);
  }
};
```

### Batch Operations

```typescript
const deleteMultiple = async (documentIds: string[]) => {
  try {
    await Promise.all(documentIds.map((id) => documentsService.delete(id)));

    queryClient.invalidateQueries({ queryKey: ['documents'] });
    Alert.alert('Success', 'Documents deleted');
  } catch (error) {
    handleApiError(error);
  }
};
```

### Infinite Scrolling

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';

function InfiniteDocumentList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['documents'],
    queryFn: ({ pageParam = 1 }) => documentsService.list({ page: pageParam }),
    getNextPageParam: (lastPage) => {
      const { current_page, last_page } = lastPage.meta;
      return current_page < last_page ? current_page + 1 : undefined;
    },
  });

  return (
    <FlatList
      data={data?.pages.flatMap((page) => page.data)}
      onEndReached={() => hasNextPage && fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListFooterComponent={isFetchingNextPage ? <LoadingSpinner /> : null}
    />
  );
}
```

## Troubleshooting

### Issue: Token not persisting

**Solution:** Check that expo-secure-store is properly configured:

```typescript
import * as SecureStore from 'expo-secure-store';

// Test storage
const test = async () => {
  await SecureStore.setItemAsync('test', 'value');
  const value = await SecureStore.getItemAsync('test');
  console.log('Test:', value); // Should log "value"
};
```

### Issue: Network errors in development

**Solution:** Ensure your API URL is accessible from your device/emulator:

- For iOS Simulator: Use `http://localhost:8000`
- For Android Emulator: Use `http://10.0.2.2:8000`
- For Physical Device: Use your computer's IP address

### Issue: Upload fails with large files

**Solution:** Increase timeout for uploads:

```typescript
// In api.ts, increase UPLOAD_TIMEOUT
const UPLOAD_TIMEOUT = 600000; // 10 minutes
```

## Next Steps

1. Read the [API Documentation](/home/rony/Projets/gigapdf/apps/mobile/src/services/README.md)
2. Check the [Examples](/home/rony/Projets/gigapdf/apps/mobile/src/services/examples.ts)
3. Review the [Configuration](/home/rony/Projets/gigapdf/apps/mobile/src/services/config.ts)
4. Explore the [Utilities](/home/rony/Projets/gigapdf/apps/mobile/src/services/utils.ts)

## Support

For issues or questions:
- Email: support@giga-pdf.com
- API Docs: https://giga-pdf.com/api/docs

---

**Happy Coding!** 🚀
