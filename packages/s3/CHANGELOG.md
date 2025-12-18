# Changelog

All notable changes to the @giga-pdf/s3 package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-18

### Added

#### Client Configuration
- S3 client configuration for Scaleway Object Storage
- Environment variable support for S3 credentials and settings
- Singleton client instance management

#### Upload Operations
- Single file upload with progress tracking
- Multipart upload for large files (>100MB)
- Automatic upload method selection based on file size
- File type validation
- File size validation
- Progress callbacks
- Custom metadata support
- Cache control and content disposition headers

#### Download Operations
- Direct file download from S3
- Presigned URL generation for downloads
- Presigned URL generation for uploads
- URL expiration management
- Response header customization

#### List Operations
- List files in bucket with prefix filtering
- Folder-like listing with delimiter support
- Recursive listing with pagination
- File search by pattern
- Folder size calculation
- File count operations
- Latest file retrieval
- File existence checking

#### Delete Operations
- Single file deletion
- Batch file deletion (up to 1000 files per request)
- Delete by prefix (folder deletion)
- Safe deletion with existence check
- Error handling for partial failures

#### React Hooks
- `useUpload` - Upload hook with progress tracking
  - XHR-based upload for browser progress tracking
  - Presigned URL support for client-side uploads
  - Auto-upload option
  - Success/error callbacks
  - Cancel and reset functionality

- `usePresignedUrl` - Presigned URL hook
  - Download URL generation
  - Upload URL generation
  - Auto-refresh before expiration
  - Expiration tracking

- `useDownloadUrl` - Simplified download URL hook
  - Auto-generation on mount
  - Auto-refresh support

- `useUploadUrl` - Simplified upload URL hook

#### Utilities
- MIME type detection from file extensions
- File type validation (PDF, images, documents)
- File size formatting (human-readable)
- File size parsing
- Multipart upload threshold detection
- Optimal part size calculation
- Upload progress calculation

#### Documentation
- Comprehensive README with examples
- TypeScript type definitions
- JSDoc comments throughout
- Usage examples file
- Environment variable documentation

#### Development
- TypeScript strict mode
- tsup build configuration
- ESM output format
- Source maps
- Type definitions generation

### Technical Details
- Built with @aws-sdk/client-s3 ^3.709.0
- Built with @aws-sdk/s3-request-presigner ^3.709.0
- Configured for Scaleway Object Storage
- Default endpoint: https://s3.fr-par.scw.cloud
- Default region: fr-par
- Full TypeScript support with strict mode
- React 18+ peer dependency for hooks

### Features
- Multipart upload threshold: 100 MB
- Minimum part size: 5 MB
- Maximum file size: 5 GB
- Default presigned URL expiration: 1 hour
- Automatic upload method selection
- Progress tracking for all upload operations
- Comprehensive error handling
- File validation before upload
