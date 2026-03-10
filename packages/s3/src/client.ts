/**
 * S3 Client configuration for Scaleway Object Storage.
 *
 * Provides a configured S3 client instance for interacting with
 * Scaleway's S3-compatible object storage service.
 */

import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';

/**
 * S3 configuration interface
 */
export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  bucket: string;
}

/**
 * Get S3 configuration from environment variables
 */
export function getS3ConfigFromEnv(): S3Config {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET_NAME;
  const endpoint = process.env.S3_ENDPOINT || 'https://s3.fr-par.scw.cloud';
  const region = process.env.S3_REGION || 'fr-par';

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'Missing required S3 environment variables: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME'
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    bucket,
  };
}

/**
 * Create a configured S3 client instance
 */
export function createS3Client(config: S3Config): S3Client {
  const clientConfig: S3ClientConfig = {
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true, // Required for Scaleway
  };

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
