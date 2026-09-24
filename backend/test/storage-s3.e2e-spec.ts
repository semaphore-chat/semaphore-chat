/**
 * Integration test for the S3 storage provider against a REAL MinIO
 * instance.
 *
 * Requires MinIO running and reachable. Two ways to get that:
 *
 *   1. Local dev: the dev Docker Compose stack ships a `minio` service
 *      behind an opt-in profile. E2e runs must target a dedicated
 *      test-named database (resetDatabase() refuses anything else, with
 *      no override — see test/helpers/e2e-app.ts):
 *        docker compose --profile s3 up -d minio minio-init
 *        docker compose exec postgres createdb -U semaphore semaphore_e2e_local_test
 *        docker compose run --rm \
 *          -e DATABASE_URL=postgresql://semaphore:semaphore@postgres:5432/semaphore_e2e_local_test \
 *          backend sh -c 'pnpm run prisma:migrate && pnpm run test:e2e -- storage-s3'
 *      S3_ENDPOINT defaults to the compose-network hostname (http://minio:9000).
 *      From a worktree, a per-ticket stack brings its own MinIO and sets
 *      S3_TEST_ENDPOINT=http://<ticket>-minio:9000:
 *        scripts/test-stack.sh <ticket> run sh -c 'pnpm run prisma:migrate && pnpm run test:e2e -- storage-s3'
 *
 *   2. CI: .github/workflows/backend-tests.yml's e2e job runs a `minio`
 *      service container reachable at http://localhost:9000 (GitHub Actions
 *      service containers are only reachable via localhost:<port> from a
 *      non-containerized job, never by hostname) — set via S3_TEST_ENDPOINT.
 *
 * If MinIO isn't reachable at the resolved endpoint (checked synchronously,
 * before any test is registered — see `isMinioReachable` below), the whole
 * suite is `describe.skip`-ped so Jest reports it as SKIPPED rather than
 * silently passing or hard-failing every backend PR's CI.
 *
 * This spec overrides STORAGE_TYPE and the S3_* vars in `process.env` for
 * its own AppModule instance only, restoring the previous values in
 * `afterAll` — the e2e suite runs with `maxWorkers: 1` (see
 * test/jest-e2e.json), so test FILES execute sequentially in one process
 * and a leaked env var here would otherwise bleed into specs that assume
 * the default LOCAL behavior.
 *
 * S3_ENDPOINT/S3_BUCKET can be overridden via S3_TEST_ENDPOINT /
 * S3_TEST_BUCKET if your MinIO isn't reachable at the Compose defaults.
 */
import * as request from 'supertest';
import { execFileSync } from 'child_process';
import {
  S3Client,
  CreateBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  registerUser,
  loginUser,
  CapturingLogger,
  E2eApp,
} from './helpers/e2e-app';

const S3_ENDPOINT = process.env.S3_TEST_ENDPOINT ?? 'http://minio:9000';
const S3_BUCKET = process.env.S3_TEST_BUCKET ?? 'semaphore-dev';

const PREVIOUS_ENV: Record<string, string | undefined> = {};
const S3_ENV: Record<string, string> = {
  STORAGE_TYPE: 'S3',
  S3_BUCKET,
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE: 'true',
};

/**
 * Synchronous TCP reachability probe for MinIO, run at module-load time —
 * i.e. before any `describe`/`it` is registered, so the whole suite can be
 * conditionally routed to `describe.skip` (Jest then reports it as
 * genuinely SKIPPED, not a silently-green no-op).
 *
 * A raw TCP connect via a `node -e` child process is used instead of:
 *   - `curl` — not guaranteed present in the backend's Docker image.
 *   - an async check in `beforeAll` — by then `describe()` has already run
 *     and registered real (non-skippable) tests; Jest offers no supported
 *     way to `describe.skip` conditionally *after* collection.
 * `execFileSync` blocks the parent (this file's module evaluation) until
 * the child process exits, giving us a synchronous yes/no.
 */
function isMinioReachable(endpoint: string, timeoutMs = 2000): boolean {
  let host: string;
  let port: number;
  try {
    const url = new URL(endpoint);
    host = url.hostname;
    port = Number(url.port || (url.protocol === 'https:' ? '443' : '80'));
  } catch {
    return false;
  }

  const probe = `
    const net = require('net');
    const socket = net.createConnection({ host: ${JSON.stringify(host)}, port: ${port} });
    const fail = () => { try { socket.destroy(); } catch (e) {} process.exit(1); };
    socket.setTimeout(${timeoutMs});
    socket.once('connect', () => { socket.end(); process.exit(0); });
    socket.once('timeout', fail);
    socket.once('error', fail);
  `;

  try {
    execFileSync(process.execPath, ['-e', probe], {
      timeout: timeoutMs + 1000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const minioAvailable = isMinioReachable(S3_ENDPOINT);
const describeS3 = minioAvailable ? describe : describe.skip;

if (!minioAvailable) {
  console.warn(
    `[storage-s3.e2e-spec] MinIO not reachable at ${S3_ENDPOINT} — SKIPPING ` +
      'the S3/MinIO e2e suite. Start it locally via ' +
      '`docker compose --profile s3 up -d minio minio-init`, or point at a ' +
      'running instance via the S3_TEST_ENDPOINT env var.',
  );
}

// 1x1 transparent PNG — small, valid magic bytes (passes the image
// content-sniffing check in ResourceTypeFileValidator).
const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// Tiny (2s, 64x64, ~1.6KB) real H.264 MP4 generated via:
//   ffmpeg -f lavfi -i "color=c=red:s=64x64:d=2:r=5" -c:v libx264 \
//     -pix_fmt yuv420p -preset ultrafast -crf 30 -movflags +faststart tiny.mp4
// Videos aren't magic-byte-sniffed by ResourceTypeFileValidator (only
// image/* is), but thumbnail generation runs *real* ffmpeg against these
// bytes (`ffmpeg -ss 1 -vframes 1 ...`), so it must be a genuinely decodable
// video at least 1s long, not a placeholder blob.
const MP4_FIXTURE = Buffer.from(
  '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',
  'base64',
);

describeS3('Storage (S3/MinIO) e2e', () => {
  let app: E2eApp;
  let s3Client: S3Client;
  // Nest's built-in Logger is silenced app-wide by createE2eApp()'s default
  // `logger: false` — which means ThumbnailService's `this.logger.warn(...)`
  // on a caught ffmpeg failure (see file/thumbnail.service.ts) normally
  // vanishes without a trace, so a failure of the video-thumbnail test below
  // shows only "hasThumbnail expected true, got false" with no clue why
  // generation didn't happen. Capture app logs instead so the real error
  // (e.g. ffmpeg missing/failing on the CI runner) prints on failure.
  const capturingLogger = new CapturingLogger();

  beforeAll(async () => {
    for (const key of Object.keys(S3_ENV)) {
      PREVIOUS_ENV[key] = process.env[key];
    }
    Object.assign(process.env, S3_ENV);

    s3Client = new S3Client({
      region: S3_ENV.S3_REGION,
      endpoint: S3_ENV.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: S3_ENV.S3_ACCESS_KEY_ID,
        secretAccessKey: S3_ENV.S3_SECRET_ACCESS_KEY,
      },
    });

    // Create the bucket ourselves via the SDK rather than depending on the
    // compose-only `minio-init` sidecar — CI's bare `minio` service has no
    // equivalent, and this is harmless to also run locally (MinIO returns
    // BucketAlreadyOwnedByYou, ignored below).
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
    } catch (error) {
      const name = (error as { name?: string } | undefined)?.name;
      if (
        name !== 'BucketAlreadyOwnedByYou' &&
        name !== 'BucketAlreadyExists'
      ) {
        throw error;
      }
    }

    app = await createE2eApp({ logger: capturingLogger });
    await resetDatabase(app);
    await seedInstanceInvite(app);
  });

  afterAll(async () => {
    await app.close();
    s3Client.destroy();
    for (const [key, value] of Object.entries(PREVIOUS_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('generates and serves a thumbnail for a video message attachment through S3 storage', async () => {
    capturingLogger.clear();
    try {
      await runVideoThumbnailTest();
    } catch (error) {
      // Surface whatever the backend actually logged (e.g. a caught ffmpeg
      // spawn/decode failure from ThumbnailService) alongside the assertion
      // failure — without this, a `hasThumbnail` mismatch gives no clue
      // whether generation threw, timed out, or never ran.

      console.error(
        `[storage-s3.e2e-spec] backend logs captured during failing test:\n${capturingLogger.dump()}`,
      );
      throw error;
    }
  });

  async function runVideoThumbnailTest(): Promise<void> {
    const username = 'e2e-s3-video-user';
    const password = 'Password123!';

    // First user registered in this file's (freshly-reset) DB → OWNER,
    // which bypasses RBAC — avoids depending on default non-owner role
    // grants for CREATE_COMMUNITY/CREATE_CHANNEL/CREATE_MESSAGE, which
    // aren't this suite's concern.
    await registerUser(app, { username, password });
    const { accessToken } = await loginUser(app, username, password);

    const communityRes = await request(app.getHttpServer())
      .post('/api/community')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'S3 e2e community' })
      .expect(201);
    const communityId = (communityRes.body as { id: string }).id;

    const channelRes = await request(app.getHttpServer())
      .post('/api/channels')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 's3-e2e-channel',
        communityId,
        type: 'TEXT',
        isPrivate: false,
      })
      .expect(201);
    const channelId = (channelRes.body as { id: string }).id;

    // Real message-attachment flow (mirrors useMessageFileUpload.ts): the
    // message is created first (empty attachments) so a real messageId
    // exists, then the file is uploaded with `resourceId: messageId` — the
    // MessageAttachmentStrategy access-control check depends on
    // File.fileMessageId pointing at a real, readable message.
    const messageRes = await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        channelId,
        spans: [
          {
            type: 'PLAINTEXT',
            text: 'video attachment coming up',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
      })
      .expect(201);
    const messageId = (messageRes.body as { id: string }).id;

    const uploadRes = await request(app.getHttpServer())
      .post('/api/file-upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('resourceType', 'MESSAGE_ATTACHMENT')
      .field('resourceId', messageId)
      .attach('file', MP4_FIXTURE, {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      })
      .expect(201);

    const uploadBody = uploadRes.body as { id: string; storageType: string };
    const fileId = uploadBody.id;
    expect(fileId).toBeDefined();
    expect(uploadBody.storageType).toBe('S3');

    // Thumbnail generation runs synchronously inside the upload request
    // (FileUploadService.uploadFile awaits it before responding), so by now
    // the DB row and the bucket object should both reflect it.
    const metadataRes = await request(app.getHttpServer())
      .get(`/api/file/${fileId}/metadata`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect((metadataRes.body as { hasThumbnail: boolean }).hasThumbnail).toBe(
      true,
    );

    // Confirm the thumbnail object actually landed in the bucket (not just
    // that the DB row claims one exists) — thumbnail.service.ts's S3 path
    // uploads to the fixed key `thumbnails/<fileId>.jpg`.
    const thumbnailHead: { ContentLength?: number } = await s3Client.send(
      new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: `thumbnails/${fileId}.jpg`,
      }),
    );
    expect(thumbnailHead.ContentLength).toEqual(expect.any(Number));

    // Serve path: thumbnail bytes stream back from MinIO through the backend.
    const thumbRes = await request(app.getHttpServer())
      .get(`/api/file/${fileId}/thumbnail`)
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(thumbRes.headers['content-type']).toBe('image/jpeg');
    const bytes = thumbRes.body as Buffer;
    expect(bytes.length).toBeGreaterThan(0);
    // Real JPEG SOI marker — proves ffmpeg actually produced a decodable
    // image, not just that some bytes made it through the pipe.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  }

  it('round-trips an image upload through S3 storage: upload -> serve (full + ranged) -> soft delete -> 404', async () => {
    const username = 'e2e-s3-user';
    const password = 'Password123!';

    const user = await registerUser(app, { username, password });
    const { accessToken } = await loginUser(app, username, password);

    const uploadRes = await request(app.getHttpServer())
      .post('/api/file-upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('resourceType', 'USER_AVATAR')
      .field('resourceId', user.id)
      .attach('file', PNG_FIXTURE, {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(201);

    const uploadBody = uploadRes.body as { id: string; storageType: string };
    const fileId = uploadBody.id;
    expect(fileId).toBeDefined();
    // Per-record resolution depends on this being persisted correctly.
    expect(uploadBody.storageType).toBe('S3');
    // storagePath (the S3 key) is excluded from the response DTO — only
    // storageType is asserted here; the real key is verified indirectly
    // by the serve requests below succeeding against the real bucket.

    // Serve path: full object, streamed back from MinIO through the backend.
    const getRes = await request(app.getHttpServer())
      .get(`/api/file/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(getRes.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(getRes.body as Buffer, PNG_FIXTURE)).toBe(0);

    // Ranged read: S3 GetObject Range param must be honored end-to-end.
    const rangeRes = await request(app.getHttpServer())
      .get(`/api/file/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Range', 'bytes=0-9')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(206);

    expect(rangeRes.headers['content-range']).toBe(
      `bytes 0-9/${PNG_FIXTURE.length}`,
    );
    expect((rangeRes.body as Buffer).length).toBe(10);
    expect(
      Buffer.compare(rangeRes.body as Buffer, PNG_FIXTURE.subarray(0, 10)),
    ).toBe(0);

    // Delete path: soft-delete via the API (physical S3 object cleanup runs
    // on FileService's cron — covered by file.service.spec.ts unit tests).
    await request(app.getHttpServer())
      .delete(`/api/file-upload/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // Post-delete: fetching a soft-deleted file must 404, not 500.
    // file.service.ts's findOne now maps the Prisma P2025 raised by
    // findUniqueOrThrow's `deletedAt: null` filter to NotFoundException
    // (see file.service.spec.ts for the unit-level regression test).
    await request(app.getHttpServer())
      .get(`/api/file/${fileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});
