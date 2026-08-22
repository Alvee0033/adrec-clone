import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor() {
    this.endpoint = process.env.MINIO_ENDPOINT || 'http://163.227.239.97:9000';
    this.bucket = process.env.MINIO_BUCKET || 'adrec-pdfs';

    this.s3 = new S3Client({
      endpoint: this.endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || 'allibasadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY || 'Allibas@Minio2026',
      },
      forcePathStyle: true,
    });
  }

  async uploadPdf(contractId: string, buffer: Buffer): Promise<string> {
    const key = `contracts/${contractId}.pdf`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
    });
    await this.s3.send(command);
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  async uploadChunkPart(contractId: string, chunkIndex: number, buffer: Buffer): Promise<void> {
    const key = `contracts/chunks/${contractId}.part_${chunkIndex}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    });
    await this.s3.send(command);
  }

  async assembleChunks(contractId: string, totalChunks: number): Promise<string> {
    const fetchPart = async (i: number): Promise<Buffer> => {
      const key = `contracts/chunks/${contractId}.part_${i}`;
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.s3.send(command);
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    };

    const parts = await Promise.all(
      Array.from({ length: totalChunks }, (_, i) => fetchPart(i))
    );

    const fullBuffer = Buffer.concat(parts);
    const finalUrl = await this.uploadPdf(contractId, fullBuffer);

    // Clean up temporary chunk parts in background
    for (let i = 0; i < totalChunks; i++) {
      const key = `contracts/chunks/${contractId}.part_${i}`;
      this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => {});
    }

    return finalUrl;
  }

  async downloadPdf(contractId: string): Promise<Buffer | null> {
    const key = `contracts/${contractId}.pdf`;
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.s3.send(command);
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      this.logger.error(`MinIO download error for ${contractId}:`, err?.message);
      return null;
    }
  }

  async deletePdf(contractId: string): Promise<void> {
    const key = `contracts/${contractId}.pdf`;
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err: any) {
      this.logger.warn(`MinIO delete error for ${contractId}:`, err?.message);
    }
  }

  getPublicUrl(contractId: string): string {
    return `${this.endpoint}/${this.bucket}/contracts/${contractId}.pdf`;
  }
}
