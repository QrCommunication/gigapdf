/**
 * Example usage of @giga-pdf/s3
 *
 * This file demonstrates how to use the S3 package for various operations.
 */

import {
  // Operations
  upload,
  uploadFileMultipart,
  downloadFile,
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  deleteFile,
  deleteFiles,
  listFiles,
  listAllFiles,
  searchFiles,
  // Hooks (React)
  useUpload,
  usePresignedUrl,
  useDownloadUrl,
  // Utils
  formatFileSize,
  getMimeTypeFromExtension,
  validateFileType,
  // Client
  getS3Client,
  getS3ConfigFromEnv,
} from '@giga-pdf/s3';

// ============================================
// 1. UPLOAD OPERATIONS
// ============================================

/**
 * Upload a file (auto-detects single vs multipart)
 */
async function uploadExample(file: File) {
  try {
    const result = await upload({
      file,
      key: `documents/${file.name}`,
      contentType: file.type,
      metadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
      onProgress: (progress) => {
        console.log(`Upload progress: ${progress.percentage}%`);
        console.log(`${progress.loaded} / ${progress.total} bytes`);
      },
    });

    console.log('Upload successful:', result);
    console.log('File URL:', result.url);
  } catch (error) {
    console.error('Upload failed:', error);
  }
}

/**
 * Upload a large file with multipart upload
 */
async function uploadLargeFile(file: File) {
  const result = await uploadFileMultipart({
    file,
    key: `large-files/${file.name}`,
    partSize: 10 * 1024 * 1024, // 10 MB parts
    onProgress: (progress) => {
      console.log(`Part ${progress.currentPart}/${progress.totalParts}`);
      console.log(`Progress: ${progress.percentage}%`);
    },
  });

  console.log('Multipart upload complete:', result);
}

/**
 * Upload with file type validation
 */
async function uploadPdfOnly(file: File) {
  const result = await upload({
    file,
    key: `pdfs/${file.name}`,
    allowedTypes: ['application/pdf'], // Only allow PDFs
    maxSize: 50 * 1024 * 1024, // Max 50 MB
  });

  console.log('PDF uploaded:', result);
}

// ============================================
// 2. DOWNLOAD OPERATIONS
// ============================================

/**
 * Download a file directly
 */
async function downloadExample() {
  const result = await downloadFile({
    key: 'documents/myfile.pdf',
  });

  console.log('Downloaded:', result.contentType, result.contentLength);
  console.log('File content:', result.body);
}

/**
 * Generate presigned download URL
 */
async function getDownloadUrl() {
  const result = await getPresignedDownloadUrl({
    key: 'documents/myfile.pdf',
    expiresIn: 3600, // 1 hour
    responseContentDisposition: 'attachment; filename="myfile.pdf"',
  });

  console.log('Download URL:', result.url);
  console.log('Expires at:', result.expiresAt);

  // Use the URL for direct browser download
  window.location.href = result.url;
}

/**
 * Generate presigned upload URL (client-side upload)
 */
async function getUploadUrl() {
  const result = await getPresignedUploadUrl({
    key: 'uploads/newfile.pdf',
    contentType: 'application/pdf',
    expiresIn: 1800, // 30 minutes
  });

  console.log('Upload URL:', result.url);

  // Use this URL with XHR or fetch to upload directly from browser
  const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });

  await fetch(result.url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/pdf',
    },
    body: file,
  });
}

// ============================================
// 3. LIST OPERATIONS
// ============================================

/**
 * List files in a folder
 */
async function listFilesExample() {
  const result = await listFiles({
    prefix: 'documents/',
    delimiter: '/', // Folder-like listing
    maxKeys: 100,
  });

  console.log(`Found ${result.objects.length} files`);
  result.objects.forEach((obj) => {
    console.log(`- ${obj.key} (${formatFileSize(obj.size)})`);
  });

  console.log(`Found ${result.folders.length} folders`);
  result.folders.forEach((folder) => {
    console.log(`- ${folder.name}/`);
  });

  if (result.isTruncated) {
    console.log('More results available, use nextContinuationToken for pagination');
  }
}

/**
 * List all files recursively
 */
async function listAllFilesExample() {
  const files = await listAllFiles({
    prefix: 'documents/',
    maxTotal: 10000,
    onProgress: (count) => {
      console.log(`Found ${count} files so far...`);
    },
  });

  console.log(`Total files: ${files.length}`);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`Total size: ${formatFileSize(totalSize)}`);
}

/**
 * Search files by pattern
 */
async function searchFilesExample() {
  // Find all PDF files
  const pdfFiles = await searchFiles('\\.pdf$', 'documents/');
  console.log(`Found ${pdfFiles.length} PDF files`);

  // Find files containing "invoice"
  const invoices = await searchFiles('invoice', 'documents/');
  console.log(`Found ${invoices.length} invoices`);
}

// ============================================
// 4. DELETE OPERATIONS
// ============================================

/**
 * Delete a single file
 */
async function deleteFileExample() {
  const result = await deleteFile({
    key: 'documents/old-file.pdf',
  });

  console.log('Delete successful:', result.success);
}

/**
 * Delete multiple files
 */
async function deleteMultipleFiles() {
  const result = await deleteFiles({
    keys: [
      'documents/file1.pdf',
      'documents/file2.pdf',
      'documents/file3.pdf',
    ],
    continueOnError: true,
  });

  console.log(`Deleted: ${result.successCount}/${result.total} files`);

  if (result.errors.length > 0) {
    console.log('Errors:', result.errors);
  }
}

// ============================================
// 5. REACT HOOKS
// ============================================

/**
 * Upload component with progress tracking
 */
function UploadComponent() {
  const {
    uploadFile,
    progress,
    isUploading,
    isSuccess,
    isError,
    error,
    result,
    cancel,
    reset,
  } = useUpload({
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxSize: 100 * 1024 * 1024, // 100 MB
    onSuccess: (result) => {
      console.log('Upload successful:', result.url);
    },
    onError: (error) => {
      console.error('Upload failed:', error.message);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Auto-generate key with timestamp
      const key = `uploads/${Date.now()}-${file.name}`;
      uploadFile(file, key);
    }
  };

  return (
    <div>
      <input
        type="file"
        onChange={handleFileChange}
        disabled={isUploading}
        accept=".pdf,.jpg,.jpeg,.png"
      />

      {isUploading && (
        <div>
          <p>Uploading: {progress}%</p>
          <progress value={progress} max={100} />
          <button onClick={cancel}>Cancel</button>
        </div>
      )}

      {isSuccess && result && (
        <div>
          <p>Upload complete!</p>
          <p>File URL: {result.url}</p>
          <button onClick={reset}>Upload another file</button>
        </div>
      )}

      {isError && error && (
        <div>
          <p>Error: {error.message}</p>
          <button onClick={reset}>Try again</button>
        </div>
      )}
    </div>
  );
}

/**
 * Download link component with presigned URL
 */
function DownloadComponent({ fileKey }: { fileKey: string }) {
  const { url, isLoading, isExpired, refresh } = useDownloadUrl(fileKey, {
    expiresIn: 3600,
    autoRefresh: true, // Auto-refresh before expiration
    refreshBuffer: 300, // Refresh 5 minutes before expiration
  });

  if (isLoading) {
    return <p>Generating download link...</p>;
  }

  if (isExpired) {
    return (
      <div>
        <p>Download link expired</p>
        <button onClick={refresh}>Generate new link</button>
      </div>
    );
  }

  return (
    <a href={url || '#'} download>
      Download File
    </a>
  );
}

/**
 * Manual presigned URL generation
 */
function ManualPresignedUrlComponent() {
  const {
    generateDownloadUrl,
    generateUploadUrl,
    url,
    isLoading,
    expiresAt,
  } = usePresignedUrl({
    onSuccess: (result) => {
      console.log('URL generated:', result.url);
    },
  });

  return (
    <div>
      <button
        onClick={() =>
          generateDownloadUrl({
            key: 'documents/myfile.pdf',
            expiresIn: 3600,
          })
        }
        disabled={isLoading}
      >
        Generate Download URL
      </button>

      <button
        onClick={() =>
          generateUploadUrl({
            key: 'uploads/newfile.pdf',
            contentType: 'application/pdf',
            expiresIn: 1800,
          })
        }
        disabled={isLoading}
      >
        Generate Upload URL
      </button>

      {url && (
        <div>
          <p>URL: {url}</p>
          <p>Expires: {expiresAt?.toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// 6. UTILITIES
// ============================================

/**
 * File validation utilities
 */
function validateFile(filename: string) {
  const mimeType = getMimeTypeFromExtension(filename);
  console.log(`MIME type: ${mimeType}`);

  try {
    validateFileType(filename, ['application/pdf', 'image/jpeg']);
    console.log('File type is valid');
  } catch (error) {
    console.error('Invalid file type:', error);
  }
}

/**
 * File size utilities
 */
function fileSizeExamples() {
  console.log(formatFileSize(1024)); // "1 KB"
  console.log(formatFileSize(1024 * 1024)); // "1 MB"
  console.log(formatFileSize(1024 * 1024 * 1024)); // "1 GB"
}

/**
 * S3 client configuration
 */
function configureS3() {
  // Get config from environment
  const config = getS3ConfigFromEnv();
  console.log('S3 Config:', {
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
  });

  // Get S3 client instance
  const client = getS3Client();
  console.log('S3 Client:', client);
}

// Export all examples
export {
  // Upload
  uploadExample,
  uploadLargeFile,
  uploadPdfOnly,
  // Download
  downloadExample,
  getDownloadUrl,
  getUploadUrl,
  // List
  listFilesExample,
  listAllFilesExample,
  searchFilesExample,
  // Delete
  deleteFileExample,
  deleteMultipleFiles,
  // Components
  UploadComponent,
  DownloadComponent,
  ManualPresignedUrlComponent,
  // Utils
  validateFile,
  fileSizeExamples,
  configureS3,
};
