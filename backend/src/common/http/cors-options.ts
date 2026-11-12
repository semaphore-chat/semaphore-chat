import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * The REST API's CORS policy, from CORS_ORIGIN (comma-separated). allowedHeaders
 * stays unset, so a preflight's requested headers (X-Device-Id, X-Client-Type)
 * are reflected to the origins allowed here. exposedHeaders lists the response
 * headers script may read, beyond the CORS-safe ones: the message-search
 * cursor.
 */
export function buildCorsOptions(
  corsOrigin: string | undefined = process.env.CORS_ORIGIN,
): CorsOptions {
  return {
    origin: corsOrigin
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) || ['http://localhost:5173'],
    credentials: true,
    exposedHeaders: ['X-Continuation-Token'],
  };
}
