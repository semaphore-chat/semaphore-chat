import { NestFactory } from '@nestjs/core';
import { DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createOpenApiDocument } from './common/openapi/create-document';
import { buildSocketEventIndex } from './websocket/socket-event-schemas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

async function generate() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Semaphore Chat API')
    .setDescription('Semaphore Chat Application API')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('refresh_token', { type: 'apiKey' }, 'refresh_token')
    .build();

  const document = createOpenApiDocument(app, config);

  // __dirname is dist/src/ when compiled, so go up two levels to project root
  writeFileSync(
    resolve(__dirname, '..', '..', 'openapi.json'),
    JSON.stringify(document, null, 2),
  );
  writeFileSync(
    resolve(__dirname, '..', '..', 'socket-events.json'),
    `${JSON.stringify(buildSocketEventIndex(), null, 2)}\n`,
  );
  console.log('OpenAPI spec written to openapi.json and socket-events.json');

  await app.close();
}

void generate();
