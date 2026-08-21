require('reflect-metadata');
const path = require('path');

const serverNodeModules = path.join(__dirname, '../server/node_modules');
require('module').globalPaths.unshift(serverNodeModules);

const { NestFactory } = require(path.join(serverNodeModules, '@nestjs/core'));
const { ExpressAdapter } = require(path.join(serverNodeModules, '@nestjs/platform-express'));
const express = require('express');
const cookieParser = require('cookie-parser');

process.env.VERCEL = '1';
if (!process.env.POSTGRES_URL && process.env.DB_HOST) {
  process.env.POSTGRES_URL = `postgres://${process.env.DB_USER || 'adrec_user'}:${process.env.DB_PASSWORD || 'password123'}@${process.env.DB_HOST}:${process.env.DB_PORT || '5436'}/${process.env.DB_NAME || 'adrec_db'}`;
}

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

