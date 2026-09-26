import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ConfigService } from '@nestjs/config';
import { INestApplicationContext, Logger } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private configService: ConfigService;
  private readonly redisLogger = new Logger(RedisIoAdapter.name);

  constructor(app: INestApplicationContext) {
    super(app);
    this.configService = app.get(ConfigService);
  }

  async connectToRedis(): Promise<void> {
    const redisHost =
      this.configService.get<string>('REDIS_HOST') || 'localhost';
    const redisPort = this.configService.get<string>('REDIS_PORT') || '6379';
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.redisLogger.log(
      `Connecting to Redis for Socket.IO adapter: ${redisHost}:${redisPort}`,
    );

    // Build Redis URL with optional password
    const redisUrl = redisPassword
      ? `redis://:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`
      : `redis://${redisHost}:${redisPort}`;

    // node-redis 6 gives every command a 5 s timeout by default, counted from
    // when it is queued. The adapter publishes fire-and-forget (it never
    // awaits or catches pubClient.publish), so during a Redis outage longer
    // than that each queued publish rejects unhandled and Node exits. Without
    // the timeout they wait in the offline queue and go out on reconnect, as
    // they did with node-redis 5. duplicate() copies this to the sub client.
    const pubClient = createClient({
      url: redisUrl,
      commandOptions: { timeout: undefined },
    });
    const subClient = pubClient.duplicate();

    // Add error handlers
    pubClient.on('error', (err) => {
      this.redisLogger.error('Redis pub client error:', err);
    });
    subClient.on('error', (err) => {
      this.redisLogger.error('Redis sub client error:', err);
    });

    pubClient.on('connect', () => {
      this.redisLogger.log('Redis pub client connected');
    });
    subClient.on('connect', () => {
      this.redisLogger.log('Redis sub client connected');
    });

    await Promise.all([pubClient.connect(), subClient.connect()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.redisLogger.log(
      'Redis Socket.IO adapter configured successfully for multi-pod coordination',
    );
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    // Only once connectToRedis() has built the adapter; until then the
    // server keeps Socket.IO's default in-memory adapter.
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
