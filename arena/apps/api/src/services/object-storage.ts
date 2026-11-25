/**
 * Linode Object Storage (S3-compatible) service.
 *
 * Uses AWS SDK v3. Credentials are strictly backend-only.
 * Never expose S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY to any client.
 *
 * Object naming: recordings/{examId}/{attemptId}/{sessionId}/segment-{seq:04d}.{ext}
 */
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  uploadUrlExpiresSeconds: number;
  playbackUrlExpiresSeconds: number;
}

export function loadObjectStorageConfig(): ObjectStorageConfig | null {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    uploadUrlExpiresSeconds: Number(process.env.S3_UPLOAD_URL_EXPIRES_SECONDS ?? 300),
    playbackUrlExpiresSeconds: Number(process.env.S3_PLAYBACK_URL_EXPIRES_SECONDS ?? 300),
  };
}

export class ObjectStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  readonly uploadUrlExpiresSeconds: number;
  readonly playbackUrlExpiresSeconds: number;

  constructor(config: ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.uploadUrlExpiresSeconds = config.uploadUrlExpiresSeconds;
    this.playbackUrlExpiresSeconds = config.playbackUrlExpiresSeconds;

    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
  }

  /**
   * Build the canonical object key for a recording segment.
   * No PII in the path; IDs only.
   */
  static buildSegmentKey(
    examId: number,
    attemptId: string,
    sessionId: string,
    sequenceNumber: number,
    ext: 'webm' | 'mp4' | 'ogg' = 'webm',
  ): string {
    const seq = String(sequenceNumber).padStart(4, '0');
    return `recordings/${examId}/${attemptId}/${sessionId}/segment-${seq}.${ext}`;
  }

  /**
   * Generate a presigned PUT URL for direct browser-to-storage upload.
   * Content-Type is enforced server-side.
   */
  async presignedUploadUrl(
    objectKey: string,
    mimeType: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds ?? this.uploadUrlExpiresSeconds,
    });
  }

  /**
   * Generate a presigned GET URL for authorized staff playback.
   */
  async presignedPlaybackUrl(
    objectKey: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds ?? this.playbackUrlExpiresSeconds,
    });
  }

  /**
   * Check if an object exists (used to validate uploads).
   * Returns size in bytes or null if not found.
   */
  async headObject(objectKey: string): Promise<{ contentLength: number } | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }));
      return { contentLength: response.ContentLength ?? 0 };
    } catch (error) {
      const name = (error as { name?: string }).name ?? '';
      if (name === 'NotFound' || name === 'NoSuchKey') return null;
      throw error;
    }
  }

  /**
   * Delete an object (used by retention cleanup).
   */
  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    }));
  }

  /**
   * Validate that a MIME type is acceptable for recording uploads.
   */
  static isAcceptableMimeType(mimeType: string): boolean {
    const allowed = [
      'video/webm',
      'video/webm;codecs=vp8',
      'video/webm;codecs=vp9',
      'video/webm;codecs=h264',
      'video/webm;codecs=av1',
      'video/mp4',
      'video/mp4;codecs=h264',
      'video/ogg',
    ];
    const normalized = mimeType.toLowerCase().replace(/\s/g, '');
    return allowed.some((m) => normalized === m || normalized.startsWith(m.split(';')[0]!));
  }
}

// Singleton — created once at server startup if config is available.
let _instance: ObjectStorageService | null = null;

export function getObjectStorage(): ObjectStorageService | null {
  if (_instance) return _instance;
  const config = loadObjectStorageConfig();
  if (!config) return null;
  _instance = new ObjectStorageService(config);
  return _instance;
}
