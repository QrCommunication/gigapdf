/**
 * S3 client configuration — provider-agnostic.
 *
 * Mirrors the Python backend (app/storage_backends): STORAGE_PROVIDER selects a
 * preset (idrive, scaleway, aws, minio, s3) and the S3_* variables carry the
 * credentials, bucket, endpoint and region.
 */

import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';

export type StorageProvider = 'idrive' | 'scaleway' | 'aws' | 'minio' | 's3';

interface ProviderPreset {
  label: string;
  /** `{region}` is substituted. Undefined = no default endpoint. */
  endpointTemplate?: string;
  defaultRegion: string;
  endpointRequired: boolean;
  forcePathStyle: boolean;
  /** Only compute CRC checksums when required (third-party S3 compatibility). */
  relaxedChecksums: boolean;
}

export const STORAGE_PROVIDER_PRESETS: Record<StorageProvider, ProviderPreset> = {
  idrive: {
    label: 'iDrive e2',
    defaultRegion: 'us-east-1',
    endpointRequired: true,
    forcePathStyle: true,
    relaxedChecksums: true,
  },
  scaleway: {
    label: 'Scaleway Object Storage',
    endpointTemplate: 'https://s3.{region}.scw.cloud',
    defaultRegion: 'fr-par',
    endpointRequired: false,
    forcePathStyle: true,
    relaxedChecksums: true,
  },
  aws: {
    label: 'Amazon S3',
    defaultRegion: 'us-east-1',
    endpointRequired: false,
    forcePathStyle: false,
    relaxedChecksums: false,
  },
  minio: {
    label: 'MinIO',
    defaultRegion: 'us-east-1',
    endpointRequired: true,
    forcePathStyle: true,
    relaxedChecksums: true,
  },
  s3: {
    label: 'S3-compatible',
    defaultRegion: 'us-east-1',
    endpointRequired: true,
    forcePathStyle: true,
    relaxedChecksums: true,
  },
};

/**
 * S3 configuration interface
 */
export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  /** Undefined lets the SDK resolve the AWS endpoint. */
  endpoint?: string;
  region: string;
  bucket: string;
  provider?: StorageProvider;
  forcePathStyle?: boolean;
}

function isStorageProvider(value: string): value is StorageProvider {
  return value in STORAGE_PROVIDER_PRESETS;
}

/**
 * Get S3 configuration from environment variables
 */
export function getS3ConfigFromEnv(): S3Config {
  const providerName = (process.env.STORAGE_PROVIDER || 'idrive').toLowerCase();
  if (!isStorageProvider(providerName)) {
    throw new Error(
      `Unsupported STORAGE_PROVIDER "${providerName}" (expected one of: ${Object.keys(
        STORAGE_PROVIDER_PRESETS
      ).join(', ')})`
    );
  }
  const preset = STORAGE_PROVIDER_PRESETS[providerName];

  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_REGION || preset.defaultRegion;
  const endpoint =
    process.env.S3_ENDPOINT ||
    (preset.endpointTemplate ? preset.endpointTemplate.replace('{region}', region) : undefined);

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'Missing required S3 environment variables: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME'
    );
  }
  if (preset.endpointRequired && !endpoint) {
    throw new Error(`S3_ENDPOINT is required for storage provider "${providerName}" (${preset.label})`);
  }

  const addressing = process.env.S3_ADDRESSING_STYLE;
  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    bucket,
    provider: providerName,
    forcePathStyle: addressing ? addressing === 'path' : preset.forcePathStyle,
  };
}

/**
 * Create a configured S3 client instance
 */
export function createS3Client(config: S3Config): S3Client {
  const preset = STORAGE_PROVIDER_PRESETS[config.provider ?? 's3'];
  const clientConfig: S3ClientConfig = {
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? preset.forcePathStyle,
  };
  if (preset.relaxedChecksums) {
    clientConfig.requestChecksumCalculation = 'WHEN_REQUIRED';
    clientConfig.responseChecksumValidation = 'WHEN_REQUIRED';
  }

  return new S3Client(clientConfig);
}

/**
 * Singleton S3 client instance
 */
let s3ClientInstance: S3Client | null = null;

/**
 * Get or create the singleton S3 client instance
 */
export function getS3Client(config?: S3Config): S3Client {
  if (!s3ClientInstance) {
    const s3Config = config || getS3ConfigFromEnv();
    s3ClientInstance = createS3Client(s3Config);
  }
  return s3ClientInstance;
}

/**
 * Reset the S3 client instance (useful for testing)
 */
export function resetS3Client(): void {
  if (s3ClientInstance) {
    s3ClientInstance.destroy();
    s3ClientInstance = null;
  }
}

/**
 * Non-signed object URL (informational — use presigned URLs for access).
 */
export function buildObjectUrl(config: S3Config, key: string): string {
  if (config.endpoint) {
    return `${config.endpoint.replace(/\/+$/, '')}/${config.bucket}/${key}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
}
