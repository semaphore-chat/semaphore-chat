import * as express from 'express';
import type { Request } from 'express';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { pinClientAddress } from './pin-client-address';

/**
 * Send a request that the client abandons before the server answers, and
 * resolve with the `req.ip` the handler reads once the connection has
 * closed (like a token refresh whose page was reloaded meanwhile).
 */
async function ipReadAfterClientLeft(
  app: express.Express,
  headers: Record<string, string> = {},
): Promise<string | undefined> {
  let resolveIp!: (ip: string | undefined) => void;
  const ipAfterClose = new Promise<string | undefined>((resolve) => {
    resolveIp = resolve;
  });
  let abortClient!: () => void;
  const requestArrived = new Promise<void>((resolve) => {
    app.post('/refresh', (req: Request) => {
      req.socket.once('close', () => resolveIp(req.ip));
      resolve();
      abortClient();
    });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const clientRequest = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/refresh',
      headers,
    });
    clientRequest.on('error', () => {});
    abortClient = () => clientRequest.destroy();
    clientRequest.end();
    await requestArrived;
    return await ipAfterClose;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('pinClientAddress', () => {
  it('keeps the client address for a request whose client went away', async () => {
    const app = express();
    app.use(pinClientAddress);

    expect(await ipReadAfterClientLeft(app)).toBe('127.0.0.1');
  });

  it('keeps the forwarded address behind a trusted proxy', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(pinClientAddress);

    expect(
      await ipReadAfterClientLeft(app, { 'X-Forwarded-For': '203.0.113.7' }),
    ).toBe('203.0.113.7');
  });

  it('is needed: without it the address is gone once the client left', async () => {
    const app = express();

    expect(await ipReadAfterClientLeft(app)).toBeUndefined();
  });
});
