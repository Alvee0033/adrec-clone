import { Controller, Get, Res, Req, Next } from '@nestjs/common';
import { AppService } from './app.service';
import type { Response, Request, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('api/health')
  getHealth() {
    return {
      ok: true,
      blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      time: new Date().toISOString(),
    };
  }

  // Widescreen static assets / page files mapping fallback if ServeStaticModule misses it
  @Get('*path')
  catchAll(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    if (req.path.startsWith('/api')) {
      return next();
    }
    
    const PAGE_FILES = {
      '/': 'pages/site/index.html',
      '/index.html': 'pages/site/index.html',
      '/services.html': 'pages/site/services.html',
      '/verify.html': 'pages/site/verify.html',
      '/verify-document': 'pages/site/verify.html',
      '/verify-document.html': 'pages/site/verify.html',
      '/sectors.html': 'pages/site/sectors.html',
      '/market-data.html': 'pages/site/market-data.html',
      '/rules-and-regulations.html': 'pages/site/rules-and-regulations.html',
      '/media-centre.html': 'pages/site/media-centre.html',
      '/media.html': 'pages/site/media.html',
      '/directory.html': 'pages/site/directory.html',
      '/contact.html': 'pages/site/contact.html',
      '/admin': 'pages/admin/index.html',
      '/admin/': 'pages/admin/index.html',
      '/admin.html': 'pages/admin/index.html',
      '/admin/login': 'pages/admin/login.html',
      '/admin/login.html': 'pages/admin/login.html',
      '/admin-login.html': 'pages/admin/login.html',
    };

    const dist = path.join(process.cwd(), '..', 'dist');
    if (fs.existsSync(dist)) {
      const rel = PAGE_FILES[req.path as keyof typeof PAGE_FILES];
      if (rel) {
        const filePath = path.join(dist, rel);
        if (fs.existsSync(filePath)) {
          return res.sendFile(filePath);
        }
      }
    }
    
    // Also serve /assets directly from public/assets if not built
    if (req.path.startsWith('/assets')) {
      const pubPath = path.join(process.cwd(), '..', 'public', req.path);
      if (fs.existsSync(pubPath)) {
        return res.sendFile(pubPath);
      }
    }

    return next();
  }
}
