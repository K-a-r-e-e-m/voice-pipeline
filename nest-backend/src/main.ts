import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';

async function bootstrap() {
  const logger = new Logger('NestBootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend clients
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Serve static testing frontend from the frontend directory
  const frontendPath = join(__dirname, '../../frontend');
  app.use(express.static(frontendPath));

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`=======================================================`);
  logger.log(`🚀 Voice Pipeline NestJS Gateway listening on port ${port}`);
  logger.log(`👉 API Health Endpoint: http://localhost:${port}/pipeline/health`);
  logger.log(`👉 Testing Web UI:       http://localhost:${port}/`);
  logger.log(`=======================================================`);
}

bootstrap();
