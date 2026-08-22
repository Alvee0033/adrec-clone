import {
  Controller, Get, Post, Delete, Body, Param,
  UseGuards, UseInterceptors, UploadedFile,
  Res, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { StorageService } from '../storage/storage.service';
import { AuthGuard } from '../auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

interface ChunkUploadSession {
  totalChunks: number;
  chunks: Map<number, Buffer>;
  updatedAt: number;
}

const activeChunkUploads = new Map<string, ChunkUploadSession>();

// Cleanup stale chunk sessions older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, sess] of activeChunkUploads.entries()) {
    if (sess.updatedAt < cutoff) {
      activeChunkUploads.delete(id);
    }
  }
}, 60 * 1000);

@Controller('api/contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly storageService: StorageService,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  async getContracts() {
    await this.contractsService.processAutoDeletes();
    return this.contractsService.findAll();
  }

  @UseGuards(AuthGuard)
  @Post('bulk-delete')
  async bulkDelete(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    if (ids.length === 0) throw new BadRequestException('No contract IDs provided');
    const deleted = await this.contractsService.bulkDelete(ids);
    return { success: true, deleted, count: deleted.length };
  }

  @UseGuards(AuthGuard)
  @Post('auto-delete')
  async autoDelete(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    const enabled = Boolean(body?.enabled);
    const deleteAt = body?.deleteAt ? String(body.deleteAt) : null;

    if (ids.length === 0) throw new BadRequestException('No contract IDs provided');
    if (enabled) {
      if (!deleteAt) throw new BadRequestException('deleteAt datetime is required when enabling auto-delete');
      const ts = new Date(deleteAt).getTime();
      if (Number.isNaN(ts)) throw new BadRequestException('Invalid deleteAt datetime');
      if (ts <= Date.now()) throw new BadRequestException('Auto-delete time must be in the future');
    }

    const updated = await this.contractsService.autoDeleteSetup(ids, enabled, deleteAt ?? undefined);
    await this.contractsService.processAutoDeletes();
    return { success: true, updated, count: updated.length, enabled };
  }

  @Get(':id')
  async getContract(@Param('id') id: string) {
    await this.contractsService.processAutoDeletes();
    const contract = await this.contractsService.findOne(id);
    if (contract) return contract;
    throw new NotFoundException('Contract not found');
  }

  @UseGuards(AuthGuard)
  @Post(':id')
  async updateContract(@Param('id') id: string, @Body() body: any) {
    try {
      const merged = await this.contractsService.saveContract(id, body);
      return { success: true, contract: merged };
    } catch (err) {
      console.error('ERROR SAVING CONTRACT:', err);
      throw err;
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  async deleteContract(@Param('id') id: string) {
    try {
      // Delete PDF from MinIO
      await this.storageService.deletePdf(id);
      // Try local file cleanup too (VPS fallback)
      const pdfPath = path.join(process.cwd(), 'data', 'pdfs', `${id}.pdf`);
      if (fs.existsSync(pdfPath)) { try { fs.unlinkSync(pdfPath); } catch {} }

      const deleted = await this.contractsService.delete(id);
      if (!deleted) throw new NotFoundException('Contract not found');
      return { success: true, message: 'Contract deleted successfully' };
    } catch (err) {
      console.error(`ERROR DELETING CONTRACT ${id}:`, err);
      throw err;
    }
  }

  @UseGuards(AuthGuard)
  @Post(':id/upload-pdf')
  @UseInterceptors(FileInterceptor('pdf'))
  async uploadPdf(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: any
  ) {
    let buffer: Buffer | null = null;
    if (file?.buffer) {
      buffer = file.buffer;
    } else if (body?.data) {
      buffer = Buffer.from(body.data, 'base64');
    }

    if (!buffer) throw new BadRequestException('No PDF file uploaded');

    // Upload to Coolify MinIO (S3-compatible)
    const publicUrl = await this.storageService.uploadPdf(id, buffer);
    const apiUrl = `/api/contracts/${id}/pdf`;
    await this.contractsService.updatePdfUrl(id, apiUrl);

    console.log(`PDF for ${id} uploaded to MinIO: ${publicUrl}`);
    return { success: true, message: 'PDF uploaded to MinIO storage', url: apiUrl };
  }

  @UseGuards(AuthGuard)
  @Post(':id/upload-pdf-chunk')
  async uploadPdfChunk(
    @Param('id') id: string,
    @Body() body: { chunkIndex: number; totalChunks: number; data: string }
  ) {
    const { chunkIndex, totalChunks, data } = body;
    if (chunkIndex === undefined || !totalChunks || !data) {
      throw new BadRequestException('Invalid chunk payload');
    }

    let session = activeChunkUploads.get(id);
    if (!session || session.totalChunks !== totalChunks) {
      session = { totalChunks, chunks: new Map(), updatedAt: Date.now() };
      activeChunkUploads.set(id, session);
    }

    const chunkBuffer = Buffer.from(data, 'base64');
    session.chunks.set(chunkIndex, chunkBuffer);
    session.updatedAt = Date.now();

    if (session.chunks.size === totalChunks) {
      const orderedChunks: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const c = session.chunks.get(i);
        if (!c) throw new BadRequestException(`Missing chunk ${i}`);
        orderedChunks.push(c);
      }
      activeChunkUploads.delete(id);
      const fullBuffer = Buffer.concat(orderedChunks);

      const publicUrl = await this.storageService.uploadPdf(id, fullBuffer);
      const apiUrl = `/api/contracts/${id}/pdf`;
      await this.contractsService.updatePdfUrl(id, apiUrl);

      console.log(`Chunked PDF for ${id} assembled (${fullBuffer.length} bytes) and saved to MinIO`);
      return { success: true, complete: true, message: 'PDF uploaded to MinIO storage', url: apiUrl };
    }

    return {
      success: true,
      complete: false,
      received: session.chunks.size,
      total: totalChunks,
    };
  }

  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    // 1. Try MinIO (primary storage)
    const minioBuffer = await this.storageService.downloadPdf(id);
    if (minioBuffer && minioBuffer.length > 0) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(minioBuffer);
      return;
    }

    // 2. Fallback: PostgreSQL bytea (migration path for old data)
    const dbBuffer = await this.contractsService.getPdfData(id);
    if (dbBuffer && dbBuffer.length > 0) {
      this.storageService.uploadPdf(id, dbBuffer).catch(() => {});
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.send(dbBuffer);
      return;
    }

    // 3. Fallback: local filesystem (VPS/dev)
    const filePath = path.join(process.cwd(), 'data', 'pdfs', `${id}.pdf`);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.sendFile(filePath);
      return;
    }

    throw new NotFoundException('Contract PDF not found');
  }
}
