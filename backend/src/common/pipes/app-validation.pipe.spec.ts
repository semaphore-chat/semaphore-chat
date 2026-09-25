import {
  Body,
  Controller,
  INestApplication,
  Post,
  UseFilters,
  ValidationPipe,
} from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/internal';
import { PipesConsumer } from '@nestjs/core/internal';
import { Test } from '@nestjs/testing';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WsException,
} from '@nestjs/websockets';
import { WsParamtype } from '@nestjs/websockets/enums/ws-paramtype.enum';
import { Exclude, Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import type { Socket } from 'socket.io';
import { io, Socket as ClientSocket } from 'socket.io-client';
import * as request from 'supertest';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import {
  AppValidationPipe,
  ValidationFailedException,
} from './app-validation.pipe';

class InnerDto {
  @IsString()
  name: string;
}

class TestDto {
  @IsString()
  channelId: string;

  @IsArray()
  spans: string[];

  @IsOptional()
  @IsString()
  optionalField?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InnerDto)
  inner?: InnerDto;

  @Exclude()
  serverOnly: string;
}

const VALID = { channelId: 'c1', spans: ['hello'] };
const INVALID = { channelId: 42, spans: 'nope', inner: { name: 7 } };

// What main's gateways did before Nest 12: a class-level
// `@UsePipes(wsValidationPipe)` that threw `new WsException(errors)`.
const preNest12WsPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  validationError: { target: false, value: false },
  exceptionFactory: (errors) => new WsException(errors),
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('AppValidationPipe', () => {
  const pipe = new AppValidationPipe();
  const consumer = new PipesConsumer();

  // PipesConsumer maps the numeric param type to a string before any pipe
  // sees it, so this is what a pipe gets for @Body() and @MessageBody().
  const httpBody = { type: RouteParamtypes.BODY, metatype: TestDto, data: '' };
  const wsPayload = {
    type: WsParamtype.PAYLOAD,
    metatype: TestDto,
    data: undefined,
  };

  describe('through PipesConsumer', () => {
    it.each([
      ['an HTTP @Body()', httpBody],
      ['a WebSocket @MessageBody()', wsPayload],
    ])('validates %s', async (_label, metadata) => {
      await expect(
        consumer.apply(INVALID, metadata as never, [pipe]),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('transforms and whitelists, stripping @Exclude() fields', async () => {
      const result = await consumer.apply(
        {
          ...VALID,
          optionalField: 'kept',
          unknownField: 'x',
          serverOnly: 'x',
        },
        wsPayload as never,
        [pipe],
      );

      expect(result).toBeInstanceOf(TestDto);
      expect(result).toEqual({ ...VALID, optionalField: 'kept' });
    });

    it('leaves @ConnectedSocket() alone (it arrives as a custom param)', async () => {
      const socket = { id: 'socket' };

      const result = await consumer.apply(
        socket,
        {
          type: WsParamtype.SOCKET,
          metatype: Object,
          data: undefined,
        } as never,
        [pipe],
      );

      expect(result).toBe(socket);
    });

    it('carries the same errors the pre-Nest 12 gateway pipe threw, and the stock HTTP messages', async () => {
      const error = (await rejectionOf(
        consumer.apply(INVALID, wsPayload as never, [pipe]),
      )) as ValidationFailedException;
      const before = (await rejectionOf(
        consumer.apply(INVALID, wsPayload as never, [preNest12WsPipe]),
      )) as WsException;
      const stock = (await rejectionOf(
        consumer.apply(INVALID, httpBody as never, [
          new ValidationPipe({ transform: true, whitelist: true }),
        ]),
      )) as ValidationFailedException;

      expect(error.validationErrors).toEqual(before.getError());
      for (const err of error.validationErrors) {
        expect(err).not.toHaveProperty('target');
        expect(err).not.toHaveProperty('value');
      }
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toEqual(stock.getResponse());
    });
  });

  describe('as the global pipe of a running app', () => {
    @Controller('echo')
    class EchoController {
      @Post()
      echo(@Body() body: TestDto) {
        return { isDto: body instanceof TestDto, body };
      }
    }

    @UseFilters(WsLoggingExceptionFilter)
    @WebSocketGateway({ transports: ['websocket'] })
    class EchoGateway {
      @SubscribeMessage('echo')
      echo(@MessageBody() payload: TestDto, @ConnectedSocket() client: Socket) {
        return { isDto: payload instanceof TestDto, payload, id: client.id };
      }
    }

    let app: INestApplication;
    let client: ClientSocket;
    let transformSpy: jest.SpyInstance;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [EchoController],
        providers: [EchoGateway],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      app.useGlobalPipes(new AppValidationPipe());
      await app.listen(0, '127.0.0.1');

      const { port } = app.getHttpServer().address() as { port: number };
      client = io(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      });
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });
    });

    afterAll(async () => {
      client?.disconnect();
      await app?.close();
    });

    beforeEach(() => {
      transformSpy = jest.spyOn(AppValidationPipe.prototype, 'transform');
    });

    afterEach(() => {
      transformSpy.mockRestore();
    });

    const nextException = () =>
      new Promise<unknown>((resolve) => client.once('exception', resolve));

    it('validates a gateway payload once and passes the DTO to the handler', async () => {
      const reply = (await client.emitWithAck('echo', {
        ...VALID,
        unknownField: 'x',
      })) as { isDto: boolean; payload: unknown; id: string };

      expect(reply).toEqual({ isDto: true, payload: VALID, id: client.id });
      const bodyCalls = transformSpy.mock.calls.filter(
        ([, metadata]) => (metadata as { type: string }).type === 'body',
      );
      expect(bodyCalls).toHaveLength(1);
    });

    it('sends WebSocket clients the validation errors, as before Nest 12, not "Internal server error"', async () => {
      const expected = (
        (await rejectionOf(
          consumer.apply(INVALID, wsPayload as never, [preNest12WsPipe]),
        )) as WsException
      ).getError();

      const exception = nextException();
      client.emit('echo', INVALID);

      expect(await exception).toEqual(expected);
    });

    it('answers invalid HTTP bodies with the stock ValidationPipe 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/echo')
        .send(INVALID)
        .expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: expect.arrayContaining([
          'channelId must be a string',
          'spans must be an array',
          'inner.name must be a string',
        ]),
      });
    });

    it('transforms and whitelists valid HTTP bodies', async () => {
      const res = await request(app.getHttpServer())
        .post('/echo')
        .send({ ...VALID, unknownField: 'x' })
        .expect(201);

      expect(res.body).toEqual({ isDto: true, body: VALID });
    });
  });
});
