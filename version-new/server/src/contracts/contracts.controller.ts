import { Controller, Get, Post, Delete, Body, Param, UseGuards, UseInterceptors, UploadedFile, Res, BadRequestException, NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { AuthGuard } from '../auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Controller('api/contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

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
    if (ids.length === 0) {
      throw new BadRequestException('No contract IDs provided');
    }
    const deleted = await this.contractsService.bulkDelete(ids);
    return { success: true, deleted, count: deleted.length };
  }

  @UseGuards(AuthGuard)
  @Post('auto-delete')
  async autoDelete(@Body() body: any) {
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    const enabled = Boolean(body?.enabled);
    const deleteAt = body?.deleteAt ? String(body.deleteAt) : null;

    if (ids.length === 0) {
      throw new BadRequestException('No contract IDs provided');
    }
    if (enabled) {
      if (!deleteAt) {
        throw new BadRequestException('deleteAt datetime is required when enabling auto-delete');
      }
      const ts = new Date(deleteAt).getTime();
      if (Number.isNaN(ts)) {
        throw new BadRequestException('Invalid deleteAt datetime');
      }
      if (ts <= Date.now()) {
        throw new BadRequestException('Auto-delete time must be in the future');
      }
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
    const merged = await this.contractsService.saveContract(id, body);
    return { success: true, contract: merged };
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  async deleteContract(@Param('id') id: string) {
    const deleted = await this.contractsService.delete(id);
    if (!deleted) throw new NotFoundException('Contract not found');
    return { success: true, message: 'Contract deleted successfully' };
  }

  @UseGuards(AuthGuard)
  @Post(':id/upload-pdf')
  @UseInterceptors(FileInterceptor('pdf'))
  async uploadPdf(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('No PDF file uploaded');
    }
    const dataDir = path.join(process.cwd(), 'data', 'pdfs');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dest = path.join(dataDir, `${id}.pdf`);
    fs.writeFileSync(dest, file.buffer);
    
    const url = `/api/contracts/${id}/pdf`;
    await this.contractsService.updatePdfUrl(id, url);
    return { success: true, message: 'PDF uploaded successfully', url };
  }

  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const filePath = path.join(process.cwd(), 'data', 'pdfs', `${id}.pdf`);
    const fallbackPath = path.join(process.cwd(), '..', 'public', 'assets', 'templates', 'blank_template.pdf');
    
    let target = null;
    if (fs.existsSync(filePath)) {
      target = filePath;
    } else if (fs.existsSync(fallbackPath)) {
      target = fallbackPath;
    }

    if (!target) {
      const contract = await this.contractsService.findOne(id);
      if (contract?.pdfUrl && contract.pdfUrl.startsWith('http')) {
        return res.redirect(302, contract.pdfUrl);
      }
      throw new NotFoundException('Contract PDF not found');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(target);
  }
}
