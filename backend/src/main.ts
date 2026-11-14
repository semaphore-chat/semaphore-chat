import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ClassSerializerInterceptor, ConsoleLogger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { TimingInterceptor } from './timing/timing.interceptor';
import { RedisIoAdapter } from './adapters/redis-io.adapter';
import { AppValidationPipe } from './common/pipes/app-validation.pipe';
import { createOpenApiDocument } from './common/openapi/create-document';
import { configureBodyParsers } from './common/http/body-parsers';
import { pinClientAddress } from './common/http/pin-client-address';
import { buildCorsOptions } from './common/http/cors-options';
import {
  validateSecrets,
  warnCookieSecureWithoutTrustProxy,
} from './config/secret-checks';

/**
 * Parse the TRUST_PROXY env var into the type Express expects.
 * Express distinguishes between:
 *   - number (hop count): trust the nth proxy from the client
 *   - boolean true: trust all proxies (not recommended)
 *   - string: treated as a subnet/address (e.g. "loopback", "10.0.0.0/8")
 */
function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) return asNumber;

  return value; // subnet or address, e.g. "loopback"
}

async function bootstrap() {
  validateSecrets();
  warnCookieSecureWithoutTrustProxy();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({
      prefix: 'SemaphoreChat',
      timestamp: true,
      json: true,
    }),
    bufferLogs: true,
    // req.rawBody: LiveKit webhook signatures cover the exact bytes received
    rawBody: true,
  });
  // Trust proxy so req.ip resolves the real client IP behind a reverse proxy.
  // https://expressjs.com/en/guide/behind-proxies.html
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  }
  // First: req.ip as the request arrived, even if its client goes away
  app.use(pinClientAddress);
  configureBodyParsers(app);

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  app.useWebSocketAdapter(redisIoAdapter);

  app.useGlobalInterceptors(new TimingInterceptor());
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP can break frontend asset loading; configure per-deployment
      crossOriginEmbedderPolicy: false, // Can break embedded media
    }),
  );
  app.enableCors(buildCorsOptions());
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const enableSwagger =
    process.env.ENABLE_SWAGGER === 'true' ||
    (process.env.ENABLE_SWAGGER === undefined &&
      process.env.NODE_ENV !== 'production');
  if (enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Semaphore Chat API')
      .setDescription('Semaphore Chat Application API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('refresh_token', { type: 'apiKey' }, 'refresh_token')
      .build();
    const document = createOpenApiDocument(app, swaggerConfig);
    SwaggerModule.setup('api-docs', app, document);
  }

  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
