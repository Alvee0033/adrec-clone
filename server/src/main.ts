import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_FILES: Record<string, string> = {
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: true, credentials: true });

  // Force HTTPS
  app.use((req: any, res: any, next: any) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  // Static page serving via Express middleware (bypasses NestJS/path-to-regexp)
  app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/api')) return next();
    const distPath = path.join(process.cwd(), '..', 'dist');
    if (!fs.existsSync(distPath)) return next();

    // Serve known page mappings
    const rel = PAGE_FILES[req.path];
    if (rel) {
      const filePath = path.join(distPath, rel);
      if (fs.existsSync(filePath)) return res.sendFile(filePath);
    }

    // Serve /assets directly
    if (req.path.startsWith('/assets')) {
      const pubPath = path.join(process.cwd(), '..', 'public', req.path);
      if (fs.existsSync(pubPath)) return res.sendFile(pubPath);
    }

    next();
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
