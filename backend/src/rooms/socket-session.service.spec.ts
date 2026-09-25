import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { Socket } from 'socket.io';
import { ServerEvents } from '@semaphore-chat/shared';
import {
  SocketSessionService,
  TOKEN_EXPIRY_WARNING_SECONDS,
} from './socket-session.service';
import {
  WsAuthError,
  WsAuthResult,
  WsAuthService,
} from '@/auth/ws-auth.service';
import { UserFactory } from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';

describe('SocketSessionService', () => {
  let service: SocketSessionService;
  let wsAuthService: Mocked<WsAuthService>;

  const T0 = new Date('2026-01-01T00:00:00Z').getTime();
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const user = UserFactory.build();

  const authResult = (
    overrides: Partial<WsAuthResult['claims']> = {},
  ): WsAuthResult => ({
    user: new UserEntity(user),
    claims: {
      sub: user.id,
      jti: 'jti-1',
      sid: 'sid-1',
      exp: nowSeconds() + 3600,
      ...overrides,
    },
  });

  function createSocket() {
    const listeners = new Map<string, () => void>();
    const socket = {
      id: 'socket-1',
      data: {} as Record<string, unknown>,
      handshake: {} as Record<string, unknown>,
      connected: true,
      disconnected: false,
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(() => {
        socket.connected = false;
        socket.disconnected = true;
        listeners.get('disconnect')?.();
      }),
      once: jest.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
    };
    return socket;
  }
  const asSocket = (socket: ReturnType<typeof createSocket>) =>
    socket as unknown as Socket;

  beforeEach(async () => {
    jest.useFakeTimers({ now: T0 });
    const { unit, unitRef } =
      await TestBed.solitary(SocketSessionService).compile();
    service = unit;
    wsAuthService = unitRef.get(WsAuthService);
    wsAuthService.sessionEndReason.mockResolvedValue(null);
  });

  /** A promise and its resolve function. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('attach', () => {
    it('attaches the user and joins the user, session and token rooms', () => {
      const socket = createSocket();
      const auth = authResult();

      service.attach(asSocket(socket), auth);

      expect(socket.handshake.user).toBe(auth.user);
      expect(socket.join).toHaveBeenCalledWith([
        `user:${user.id}`,
        'session:sid-1',
        'token:jti-1',
      ]);
      expect(socket.data.auth).toEqual({
        userId: user.id,
        jti: 'jti-1',
        sid: 'sid-1',
        exp: auth.claims.exp,
      });
    });

    it('skips the session room for a token without a session id', () => {
      const socket = createSocket();

      service.attach(asSocket(socket), authResult({ sid: undefined }));

      expect(socket.join).toHaveBeenCalledWith([
        `user:${user.id}`,
        'token:jti-1',
      ]);
    });

    it('warns before the token expires, then ends the session when it does', () => {
      const socket = createSocket();
      const auth = authResult({ exp: nowSeconds() + 600 });
      service.attach(asSocket(socket), auth);

      jest.advanceTimersByTime((600 - TOKEN_EXPIRY_WARNING_SECONDS) * 1000);
      expect(socket.emit).toHaveBeenCalledWith(ServerEvents.TOKEN_EXPIRING, {
        expiresAt: new Date(auth.claims.exp * 1000).toISOString(),
      });
      expect(socket.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(TOKEN_EXPIRY_WARNING_SECONDS * 1000);
      expect(socket.emit).toHaveBeenLastCalledWith(
        ServerEvents.SESSION_TERMINATED,
        { reason: 'TOKEN_EXPIRED' },
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('warns within a second when the token is about to expire', () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult({ exp: nowSeconds() + 30 }));

      jest.advanceTimersByTime(999);
      expect(socket.emit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      expect(socket.emit).toHaveBeenCalledWith(
        ServerEvents.TOKEN_EXPIRING,
        expect.any(Object),
      );
    });

    it('stops the timers when the socket disconnects', () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult({ exp: nowSeconds() + 600 }));

      socket.connected = false;
      socket.disconnected = true;
      socket.once.mock.calls[0][1](); // 'disconnect'
      jest.advanceTimersByTime(601_000);

      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('re-arms instead of disconnecting when a clamped timer fires early', () => {
      const socket = createSocket();
      // Longer than setTimeout's maximum delay (~24.8 days)
      const exp = nowSeconds() + 30 * 24 * 3600;
      service.attach(asSocket(socket), authResult({ exp }));

      jest.advanceTimersByTime(2_147_483_647);
      expect(socket.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(exp * 1000 - Date.now());
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('confirmBinding', () => {
    it('keeps a socket whose session still stands', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult({ iat: 1000 }));

      await expect(service.confirmBinding(asSocket(socket))).resolves.toBe(
        true,
      );

      expect(wsAuthService.sessionEndReason).toHaveBeenCalledWith({
        sub: user.id,
        jti: 'jti-1',
        sid: 'sid-1',
        iat: 1000,
      });
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('ends the session of a socket revoked before it joined its rooms', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult({ exp: nowSeconds() + 600 }));
      wsAuthService.sessionEndReason.mockResolvedValue('LOGGED_OUT');

      await expect(service.confirmBinding(asSocket(socket))).resolves.toBe(
        false,
      );

      expect(socket.emit).toHaveBeenCalledWith(
        ServerEvents.SESSION_TERMINATED,
        { reason: 'LOGGED_OUT' },
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      // No expiry timer left behind
      socket.emit.mockClear();
      jest.advanceTimersByTime(601_000);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it('fails closed when the check itself fails', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult());
      wsAuthService.sessionEndReason.mockRejectedValue(new Error('redis down'));

      await expect(service.confirmBinding(asSocket(socket))).resolves.toBe(
        false,
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a socket without a binding', async () => {
      const socket = createSocket();

      await expect(service.confirmBinding(asSocket(socket))).resolves.toBe(
        false,
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(wsAuthService.sessionEndReason).not.toHaveBeenCalled();
    });

    it('leaves a socket alone that re-authenticated meanwhile', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult());
      const check = deferred<'SESSION_REVOKED'>();
      wsAuthService.sessionEndReason.mockReturnValueOnce(check.promise);

      const confirming = service.confirmBinding(asSocket(socket));
      // A newer token is bound (and checked on its own) in the meantime
      socket.data.auth = { userId: user.id, jti: 'jti-2', exp: 0 };
      check.resolve('SESSION_REVOKED');

      await expect(confirming).resolves.toBe(false);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('reauthenticate', () => {
    it('swaps in the new token: rooms, user, expiry', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult({ exp: nowSeconds() + 60 }));
      const fresh = authResult({
        jti: 'jti-2',
        sid: 'sid-2',
        exp: nowSeconds() + 3600,
      });
      wsAuthService.authenticate.mockResolvedValue(fresh);

      const result = await service.reauthenticate(asSocket(socket), 'fresh');

      expect(wsAuthService.authenticate).toHaveBeenCalledWith('fresh');
      expect(result).toEqual({
        ok: true,
        expiresAt: new Date(fresh.claims.exp * 1000).toISOString(),
      });
      expect(socket.leave).toHaveBeenCalledWith('token:jti-1');
      expect(socket.leave).toHaveBeenCalledWith('session:sid-1');
      expect(socket.join).toHaveBeenLastCalledWith([
        `user:${user.id}`,
        'session:sid-2',
        'token:jti-2',
      ]);
      expect(socket.handshake.user).toBe(fresh.user);

      // The old expiry no longer applies
      jest.advanceTimersByTime(61_000);
      expect(socket.disconnect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(3600_000);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('keeps the session room when the session is the same', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult());
      wsAuthService.authenticate.mockResolvedValue(
        authResult({ jti: 'jti-2' }),
      );

      await service.reauthenticate(asSocket(socket), 'fresh');

      expect(socket.leave).toHaveBeenCalledTimes(1);
      expect(socket.leave).toHaveBeenCalledWith('token:jti-1');
    });

    it('rejects a token that fails authentication and keeps the old expiry', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult({ exp: nowSeconds() + 60 }));
      wsAuthService.authenticate.mockRejectedValue(
        new WsAuthError('TOKEN_REVOKED'),
      );

      await expect(
        service.reauthenticate(asSocket(socket), 'revoked'),
      ).resolves.toEqual({ ok: false, error: 'AUTH_FAILED' });

      jest.advanceTimersByTime(60_000);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it("rejects another user's token", async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult());
      wsAuthService.authenticate.mockResolvedValue(
        authResult({ sub: 'someone-else' }),
      );

      await expect(
        service.reauthenticate(asSocket(socket), 'other'),
      ).resolves.toEqual({ ok: false, error: 'AUTH_FAILED' });
      expect((socket.data.auth as { userId: string }).userId).toBe(user.id);
      expect(socket.leave).not.toHaveBeenCalled();
    });

    it('ends the session when the new token is revoked while it is swapped in', async () => {
      // The revocation landed after the token's check but before the socket
      // joined the new session's rooms: its disconnect missed the socket
      const socket = createSocket();
      service.attach(asSocket(socket), authResult());
      wsAuthService.authenticate.mockResolvedValue(
        authResult({ jti: 'jti-2', sid: 'sid-2' }),
      );
      wsAuthService.sessionEndReason.mockResolvedValue('SESSION_REVOKED');

      await expect(
        service.reauthenticate(asSocket(socket), 'fresh'),
      ).resolves.toEqual({ ok: false, error: 'AUTH_FAILED' });

      // Checked again only once the socket was in the new rooms
      expect(socket.join).toHaveBeenLastCalledWith([
        `user:${user.id}`,
        'session:sid-2',
        'token:jti-2',
      ]);
      expect(socket.join.mock.invocationCallOrder.at(-1)).toBeLessThan(
        wsAuthService.sessionEndReason.mock.invocationCallOrder[0],
      );
      expect(wsAuthService.sessionEndReason).toHaveBeenCalledWith(
        expect.objectContaining({ jti: 'jti-2', sid: 'sid-2' }),
      );
      expect(socket.emit).toHaveBeenCalledWith(
        ServerEvents.SESSION_TERMINATED,
        { reason: 'SESSION_REVOKED' },
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('leaves the rooms of a token swapped in by a concurrent REAUTHENTICATE', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult());
      const first = deferred<WsAuthResult>();
      const second = deferred<WsAuthResult>();
      wsAuthService.authenticate
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      // Both start while the socket holds jti-1
      const reauth1 = service.reauthenticate(asSocket(socket), 'token-2');
      const reauth2 = service.reauthenticate(asSocket(socket), 'token-3');
      first.resolve(authResult({ jti: 'jti-2', sid: 'sid-2' }));
      await reauth1;
      second.resolve(authResult({ jti: 'jti-3', sid: 'sid-3' }));
      await reauth2;

      // The second swap leaves the first one's rooms, not jti-1's again
      expect(socket.leave).toHaveBeenCalledWith('token:jti-2');
      expect(socket.leave).toHaveBeenCalledWith('session:sid-2');
      expect(socket.data.auth).toMatchObject({ jti: 'jti-3', sid: 'sid-3' });
    });

    it('rejects when the socket disconnected while the token was checked', async () => {
      const socket = createSocket();
      service.attach(asSocket(socket), authResult());
      wsAuthService.authenticate.mockImplementation(() => {
        socket.disconnect();
        return Promise.resolve(authResult({ jti: 'jti-2' }));
      });

      await expect(
        service.reauthenticate(asSocket(socket), 'fresh'),
      ).resolves.toEqual({ ok: false, error: 'AUTH_FAILED' });
      expect(socket.join).toHaveBeenCalledTimes(1);
    });
  });
});
