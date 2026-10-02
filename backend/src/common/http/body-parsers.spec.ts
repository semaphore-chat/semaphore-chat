import {
  Body,
  Controller,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import * as request from 'supertest';
import {
  configureBodyParsers,
  LIVEKIT_WEBHOOK_CONTENT_TYPE,
} from './body-parsers';

@Controller()
class EchoController {
  @Post('echo')
  echo(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): { body: unknown; rawBody: string | null } {
    return { body, rawBody: req.rawBody?.toString('utf-8') ?? null };
  }
}

describe('configureBodyParsers', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    // As in main.ts
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureBodyParsers(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("parses LiveKit's application/webhook+json bodies and keeps their raw bytes", async () => {
    // protojson-style output, whose whitespace JSON.stringify wouldn't reproduce
    const raw = '{"event":  "participant_joined", "room": {"name":"r1"}}';

    const res = await request(app.getHttpServer())
      .post('/echo')
      .set('Content-Type', LIVEKIT_WEBHOOK_CONTENT_TYPE)
      .send(raw)
      .expect(201);

    expect(res.body).toEqual({
      body: { event: 'participant_joined', room: { name: 'r1' } },
      rawBody: raw,
    });
  });

  it('still parses application/json, with its raw bytes', async () => {
    const raw = '{"a": 1}';

    const res = await request(app.getHttpServer())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(201);

    expect(res.body).toEqual({ body: { a: 1 }, rawBody: raw });
  });
});
