const { NestFactory } = require('../server/node_modules/@nestjs/core/index.js');
const { ExpressAdapter } = require('../server/node_modules/@nestjs/platform-express/index.js');
const express = require('express');
const cookieParser = require('cookie-parser');

const appModule = require('../server/dist/app.module.js');
const AppModule = appModule.AppModule || appModule;

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

module.exports = async function (req, res) {
  const server = await bootstrap();
  server(req, res);
};
