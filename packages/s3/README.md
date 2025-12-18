# @giga-pdf/s3

S3-compatible storage operations for Scaleway Object Storage.

## Features

- **File Upload**: Single and multipart upload with progress tracking
- **File Download**: Direct downloads and presigned URL generation
- **File Management**: List, search, and delete files
- **React Hooks**: Upload and presigned URL hooks with progress tracking
- **Type Safety**: Full TypeScript support with strict mode
- **Scaleway Compatible**: Optimized for Scaleway Object Storage

## Installation

```bash
pnpm install @giga-pdf/s3
```

## Configuration

Set the following environment variables:

```bash
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=your_bucket_name
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
```

## Usage

### Upload Files

```typescript
import { upload } from '@giga-pdf/s3';

// Simple upload
const result = await upload({
  file: myFile,
  key: 'documents/myfile.pdf',
  contentType: 'application/pdf',
});

// Upload with progress tracking
const result = await upload({
  file: myFile,
  key: 'documents/myfile.pdf',
  onProgress: (progress) => {
    console.log(`Upload progress: ${progress.percentage}%`);
  },
});

// Multipart upload (automatic for files > 100MB)
const result = await upload({
  file: largeFile,
  key: 'documents/largefile.pdf',
  onProgress: (progress) => {
    console.log(`Uploaded ${progress.loaded} / ${progress.total} bytes`);
  },
});
```

### Download Files

```typescript
import { downloadFile, getPresignedDownloadUrl } from '@giga-pdf/s3';

// Direct download
const result = await downloadFile({
  key: 'documents/myfile.pdf',
});

// Generate presigned URL
const urlResult = await getPresignedDownloadUrl({
  key: 'documents/myfile.pdf',
  expiresIn: 3600, // 1 hour
});
console.log(urlResult.url); // Use this URL for direct browser download
```

### List Files

```typescript
import { listFiles, listAllFiles, searchFiles } from '@giga-pdf/s3';

// List files in a folder
const result = await listFiles({
  prefix: 'documents/',
  delimiter: '/',
});

console.log(result.objects); // Files
console.log(result.folders); // Subfolders

// List all files recursively
const allFiles = await listAllFiles({
  prefix: 'documents/',
  onProgress: (count) => console.log(`Found ${count} files`),
});

// Search files by pattern
const pdfFiles = await searchFiles('\\.pdf$', 'documents/');
```

### Delete Files

```typescript
import { deleteFile, deleteFiles, deleteByPrefix } from '@giga-pdf/s3';

// Delete single file
await deleteFile({ key: 'documents/myfile.pdf' });

// Delete multiple files
const result = await deleteFiles({
  keys: ['file1.pdf', 'file2.pdf', 'file3.pdf'],
});

// Delete all files in a folder
const result = await deleteByPrefix('documents/old/');
```

### React Hooks

#### Upload Hook

```typescript
import { useUpload } from '@giga-pdf/s3';

function UploadComponent() {
  const {
    uploadFile,
    progress,
    isUploading,
    isSuccess,
    error,
    result,
  } = useUpload({
    onSuccess: (result) => {
      console.log('Uploaded:', result.url);
    },
    onError: (error) => {
      console.error('Upload failed:', error);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file, `uploads/${file.name}`);
    }
  };

  return (
    <div>
      <input type="file" onChange={handleFileChange} />
      {isUploading && <p>Uploading: {progress}%</p>}
      {isSuccess && <p>Upload complete: {result?.url}</p>}
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

#### Presigned URL Hook

```typescript
import { useDownloadUrl, usePresignedUrl } from '@giga-pdf/s3';

function DownloadComponent({ fileKey }: { fileKey: string }) {
  const { url, isLoading, isExpired } = useDownloadUrl(fileKey, {
    expiresIn: 3600,
    autoRefresh: true, // Auto-refresh before expiration
  });

  if (isLoading) return <p>Generating download link...</p>;
  if (isExpired) return <p>Link expired</p>;

  return (
    <a href={url || '#'} download>
      Download File
    </a>
  );
}
```

## API Reference

### Operations

#### upload(options)

Upload a file to S3 (automatically chooses single or multipart).

**Options:**
- `file: File | Buffer` - File to upload
- `key: string` - S3 object key
- `contentType?: string` - Content type override
- `allowedTypes?: string[]` - Allowed MIME types
- `maxSize?: number` - Maximum file size in bytes
- `metadata?: Record<string, string>` - File metadata
- `onProgress?: (progress) => void` - Progress callback

**Returns:** `Promise<UploadResult>`

#### downloadFile(options)

Download a file from S3.

**Options:**
- `key: string` - S3 object key
- `responseContentType?: string` - Content type override
- `responseContentDisposition?: string` - Content disposition override
- `versionId?: string` - Version ID

**Returns:** `Promise<DownloadResult>`

#### getPresignedDownloadUrl(options)

Generate a presigned URL for downloading.

**Options:**
- `key: string` - S3 object key
- `expiresIn?: number` - Expiration time in seconds (default: 3600)

**Returns:** `Promise<PresignedUrlResult>`

#### listFiles(options)

List files in S3 bucket.

**Options:**
- `prefix?: string` - Prefix to filter objects
- `delimiter?: string` - Delimiter for folder-like listing
- `maxKeys?: number` - Maximum number of objects to return

**Returns:** `Promise<ListResult>`

#### deleteFile(options)

Delete a single file from S3.

**Options:**
- `key: string` - S3 object key

**Returns:** `Promise<DeleteResult>`

### Hooks

#### useUpload(options)

Hook for uploading files with progress tracking.

**Options:**
- All upload options
- `autoUpload?: boolean` - Auto-start upload on file selection
- `usePresignedUrl?: boolean` - Use presigned URL for upload
- `generateKey?: (file) => string` - Generate key from file
- `onSuccess?: (result) => void` - Success callback
- `onError?: (error) => void` - Error callback

**Returns:**
- `uploadFile: (file, key?) => Promise<void>`
- `progress: number` - Upload progress (0-100)
- `isUploading: boolean`
- `isSuccess: boolean`
- `error: Error | null`
- `result: UploadResult | null`
- `cancel: () => void`
- `reset: () => void`

#### usePresignedUrl(options)

Hook for generating presigned URLs.

**Options:**
- `autoGenerate?: boolean` - Auto-generate URL on mount
- `autoRefresh?: boolean` - Auto-refresh URL before expiration
- `refreshBuffer?: number` - Refresh buffer time in seconds
- `onSuccess?: (result) => void` - Success callback
- `onError?: (error) => void` - Error callback

**Returns:**
- `generateDownloadUrl: (options) => Promise<void>`
- `generateUploadUrl: (options) => Promise<void>`
- `url: string | null`
- `isExpired: boolean`
- `isLoading: boolean`
- `refresh: () => Promise<void>`

### Utilities

#### File Type Utilities

```typescript
import {
  getMimeTypeFromExtension,
  isValidFileType,
  isPdfFile,
  isImageFile,
} from '@giga-pdf/s3';

const mimeType = getMimeTypeFromExtension('document.pdf');
const isValid = isValidFileType('document.pdf', ['application/pdf']);
const isPdf = isPdfFile('document.pdf');
const isImage = isImageFile('photo.jpg');
```

#### File Size Utilities

```typescript
import {
  formatFileSize,
  parseFileSize,
  requiresMultipartUpload,
  calculateOptimalPartSize,
} from '@giga-pdf/s3';

const formatted = formatFileSize(1024 * 1024); // "1 MB"
const bytes = parseFileSize('5 MB'); // 5242880
const needsMultipart = requiresMultipartUpload(200 * 1024 * 1024); // true
const partSize = calculateOptimalPartSize(500 * 1024 * 1024);
```

## Error Handling

All operations throw errors that can be caught and handled:

```typescript
import { upload } from '@giga-pdf/s3';

try {
  const result = await upload({
    file: myFile,
    key: 'documents/myfile.pdf',
  });
} catch (error) {
  if (error.message.includes('Invalid file type')) {
    // Handle invalid file type
  } else if (error.message.includes('Invalid file size')) {
    // Handle invalid file size
  } else {
    // Handle other errors
  }
}
```

## License

MIT
