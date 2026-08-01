import { NestFactory } from '../server/node_modules/@nestjs/core/index.js';
import { ExpressAdapter } from '../server/node_modules/@nestjs/platform-express/index.js';
import express from 'express';
import cookieParser from 'cookie-parser';

import appModule from '../server/dist/app.module.js';
const AppModule = appModule.AppModule || (appModule.default && appModule.default.AppModule) || appModule;

let cachedServer;

async function bootstrap() {
  if (!cachedServer) {
    const expressApp = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
    
    app.enableCors({ origin: true, credentials: true });
    app.use(express.json({ limit: '15mb' }));
    app.use(cookieParser());
    
    await app.init();
    cachedServer = expressApp;
  }
  return cachedServer;
}

export default async function (req, res) {
  const server = await bootstrap();
  server(req, res);
}
