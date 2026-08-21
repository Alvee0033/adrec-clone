const { NestFactory } = require('@nestjs/core');
const { ExpressAdapter } = require('@nestjs/platform-express');
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

process.env.VERCEL = '1';

const appModule = require(path.join(__dirname, '../server/dist/app.module.js'));
const AppModule = appModule.AppModule || appModule;

let cachedServer;

async function bootstrap() {
  if (!cachedServer) {
    const expressApp = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
    });
    
    app.enableCors({ origin: true, credentials: true });
    app.use(express.json({ limit: '15mb' }));
    app.use(cookieParser());
    
    await app.init();
    cachedServer = expressApp;
  }
  return cachedServer;
}

module.exports = async function (req, res) {
  try {
    const server = await bootstrap();
    return server(req, res);
  } catch (err) {
    console.error('Serverless Execution Error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message, stack: err.stack }));
  }
};

