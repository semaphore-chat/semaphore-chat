import * as request from 'supertest';
import { brotliCompressSync, gzipSync } from 'zlib';
import { createE2eApp, resetDatabase, E2eApp } from './helpers/e2e-app';

/**
 * Node2Shell (CVE-2026-111497) is an out-of-bounds write in Node's Brotli
 * decoder. Request bodies must never reach a decompressor: the body parsers
 * run with `inflate: false` (src/common/http/body-parsers.ts), so a
 * compressed body is rejected with 415 before its bytes are decoded.
 *
 * `/api/auth/login` is a public JSON endpoint that needs no seed data, which
 * makes the uncompressed control case a 401 from the auth guard instead of a
 * 415 from the parser.
 */
describe('Compressed request bodies (e2e)', () => {
  let app: E2eApp;

  const credentials = {
    username: 'e2e-compressed-body',
    password: 'Password123!',
  };
  const json = JSON.stringify(credentials);

  const cases: Array<['br' | 'gzip', (input: Buffer) => Buffer]> = [
    ['br', brotliCompressSync],
    ['gzip', gzipSync],
  ];

  beforeAll(async () => {
    app = await createE2eApp();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(cases)(
    'rejects a %s-compressed JSON login body with 415',
    async (encoding, compress) => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', encoding)
        .send(compress(Buffer.from(json)))
        .expect(415);
    },
  );

  // The urlencoded parser is registered separately (replacing Nest's default),
  // so prove it rejects compressed bodies too.
  it.each(cases)(
    'rejects a %s-compressed urlencoded login body with 415',
    async (encoding, compress) => {
      const form = new URLSearchParams(credentials).toString();
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Content-Encoding', encoding)
        .send(compress(Buffer.from(form)))
        .expect(415);
    },
  );

  it('reaches the login controller for an uncompressed body', async () => {
    // The guard's 401 means parsing succeeded and the request reached auth;
    // a 415 here would mean the parser rejected an identity-encoded body.
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ ...credentials, password: 'WrongPassword123!' })
      .expect(401);
  });
});
