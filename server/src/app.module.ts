import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { ContractsModule } from './contracts/contracts.module';
import { OcrModule } from './ocr/ocr.module';
import { Contract } from './contracts/contract.entity';
import { Admin } from './admin/admin.entity';
import * as fs from 'fs';

const distPath = join(process.cwd(), '..', 'dist');

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      ...(process.env.POSTGRES_URL
        ? {
            url: process.env.POSTGRES_URL,
            ssl: process.env.DB_SSL === 'true' || process.env.POSTGRES_URL.includes('sslmode=require')
              ? { rejectUnauthorized: false }
              : false,
          }
        : {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5433', 10),
            username: process.env.DB_USER || 'farm_ai_user',
            password: process.env.DB_PASSWORD || 'password123',
            database: process.env.DB_NAME || 'adrec_db',
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
          }),
      entities: [Contract, Admin],
      synchronize: true, // Auto-create tables in dev, might want migrations for prod
    }),
    AdminModule,
    AuthModule,
    ContractsModule,
    OcrModule,
    // Conditionally serve static files if dist exists and not on Vercel (Vercel CDN handles static pages)
    ...(!process.env.VERCEL && fs.existsSync(distPath) ? [
      ServeStaticModule.forRoot({
        rootPath: distPath,
        renderPath: '/',
        serveRoot: '/',
      }),
    ] : []),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
