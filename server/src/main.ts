import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';

// Maps clean URLs to HTML files inside dist/
// Add any URL that does NOT match its filename here
const PAGE_FILES: Record<string, string> = {
  '/': 'pages/site/index.html',
  '/index.html': 'pages/site/index.html',
  // verify-document URL maps to verify.html (name mismatch — must be explicit)
  '/verify-document': 'pages/site/verify.html',
  '/verify-document.html': 'pages/site/verify.html',
  // admin routes
  '/admin': 'pages/admin/index.html',
  '/admin/': 'pages/admin/index.html',
  '/admin/login': 'pages/admin/login.html',
  '/admin/login.html': 'pages/admin/login.html',
  '/admin-login.html': 'pages/admin/login.html',
};

// Auto-generate mappings for all HTML files in dist/pages/site/
function buildPageMap(distPath: string): Record<string, string> {
  const map = { ...PAGE_FILES };
  const sitePagesDir = path.join(distPath, 'pages', 'site');
  if (fs.existsSync(sitePagesDir)) {
    for (const file of fs.readdirSync(sitePagesDir)) {
      if (!file.endsWith('.html')) continue;
      const name = file.replace('.html', '');
      const rel = `pages/site/${file}`;
      // Register both /page.html and /page (without extension)
      map[`/${file}`] = rel;
      if (name !== 'index') map[`/${name}`] = rel;
    }
  }
  const adminPagesDir = path.join(distPath, 'pages', 'admin');
  if (fs.existsSync(adminPagesDir)) {
    for (const file of fs.readdirSync(adminPagesDir)) {
      if (!file.endsWith('.html')) continue;
      const name = file.replace('.html', '');
      const rel = `pages/admin/${file}`;
      map[`/admin/${file}`] = rel;
      if (name !== 'index') map[`/admin/${name}`] = rel;
    }
  }
  return map;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const distPath = path.join(process.cwd(), '..', 'dist');
  const pageMap = buildPageMap(distPath);

  app.enableCors({ origin: true, credentials: true });

  // Fix for UAE ISPs (Etisalat/du): they block UDP 443 (QUIC/HTTP3)
  // Setting alt-svc: clear tells browsers to stop trying HTTP/3 and use TCP only
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('alt-svc', 'clear');
    next();
  });

  // Force HTTPS
  app.use((req: any, res: any, next: any) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  // Static page serving via Express middleware — bypasses NestJS/path-to-regexp entirely
  app.use((req: any, res: any, next: any) => {
    // Always pass API requests to NestJS controllers
    if (req.path.startsWith('/api')) return next();

    // Skip if dist doesn't exist (dev mode without build)
    if (!fs.existsSync(distPath)) return next();

    // 1. Check known page mappings (exact match)
    const rel = pageMap[req.path];
    if (rel) {
      const filePath = path.join(distPath, rel);
      if (fs.existsSync(filePath)) return res.sendFile(filePath);
    }

    // 2. Try serving directly from dist (for assets, images, css, js etc.)
    const directPath = path.join(distPath, req.path);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return res.sendFile(directPath);
    }

    // 3. Try path + .html
    const withHtml = path.join(distPath, 'pages', 'site', `${path.basename(req.path)}.html`);
    if (fs.existsSync(withHtml)) return res.sendFile(withHtml);

    next();
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
