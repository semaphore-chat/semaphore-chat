// T8 reference: the real socket.io-client, configured as frontend/src/utils/socketSingleton.ts,
// behaving as useSocketHub.ts and SocketProvider.tsx do, behind the same control port as rig-sio.
// RIG ONLY. Runs in the backend's image, whose hoisted node_modules has the socket.io-client version the
// backend's e2e tests use (NODE_PATH), never on the host.
const net = require('net');
const readline = require('readline');
const { io } = require('socket.io-client');

const port = Number(process.env.CONTROL_PORT || 9000);
const now = () => Date.now();

const server = net.createServer((conn) => {
  const out = (line) => conn.write(JSON.stringify(line) + '\n');
  out({ k: 'ready', client: 'ref', version: (() => { try { return require("socket.io-client/package.json").version; } catch { return "unknown"; } })() });
  let socket = null;
  let connId = 0;
  let token = '';
  let cookie = '';
  let url = '';
  let jitterMs = 30000;
  let refreshTimer = null;
  let sessionEnd = null;

  async function refresh() {
    try {
      const res = await fetch(`${url}/api/auth/refresh`, { method: 'POST', headers: { Cookie: cookie } });
      if (res.status === 401 || res.status === 403) {
        out({ k: 'refresh', t: now(), result: 'rejected' });
        return null;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      token = body.accessToken;
      const next = (res.headers.getSetCookie() || []).find((c) => c.startsWith('refresh_token='));
      if (next) cookie = next.split(';')[0];
      out({ k: 'refresh', t: now(), result: 'refreshed' });
      return token;
    } catch {
      out({ k: 'refresh', t: now(), result: 'unavailable' });
      return null;
    }
  }

  function start(command) {
    url = command.url;
    token = command.token;
    cookie = command.cookie || '';
    jitterMs = command.refreshJitterMs ?? 30000;
    socket = io(url, {
      transports: ['websocket'],
      auth: (cb) => cb({ token: `Bearer ${token}` }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: command.reconnectDelayMs ?? 1000,
      reconnectionDelayMax: command.reconnectDelayMaxMs ?? 30000,
      randomizationFactor: 0.5,
      autoConnect: false,
    });
    socket.on('connect', () => {
      connId += 1;
      sessionEnd = null;
      out({ k: 'connected', t: now(), conn: connId, sid: socket.id });
      socket.emit('subscribeAll');
      socket.emit('presenceOnline', { idle: false });
    });
    socket.on('disconnect', async (reason) => {
      out({ k: 'disconnected', t: now(), conn: connId, reason });
      if (reason === 'io server disconnect') {
        if (await refresh()) socket.connect();
        else out({ k: 'auth_lost', t: now(), reason: sessionEnd });
      }
    });
    socket.on('connect_error', async (err) => {
      out({ k: 'connect_error', t: now(), msg: err.message });
      if (err.message === 'AUTH_FAILED') {
        if (await refresh()) socket.connect();
        else out({ k: 'auth_lost', t: now(), reason: sessionEnd });
      }
    });
    socket.onAny((event, ...args) => {
      out({ k: 'ev', t: now(), conn: connId, e: event, p: args.length === 1 ? args[0] : args.length ? args : null });
      if (event === 'sessionTerminated') sessionEnd = args[0]?.reason ?? null;
      if (event === 'tokenExpiring' && !refreshTimer) {
        refreshTimer = setTimeout(async () => {
          refreshTimer = null;
          const fresh = await refresh();
          if (fresh && socket.connected) {
            socket.timeout(10000).emitWithAck('reauthenticate', { token: `Bearer ${fresh}` })
              .then((result) => out({ k: 'reauthenticated', t: now(), result }))
              .catch((e) => out({ k: 'reauthenticated', t: now(), result: { ok: false, error: e.message } }));
          }
        }, Math.random() * jitterMs);
      }
    });
    setInterval(() => {
      if (socket.connected) socket.emit('presenceOnline', { idle: false });
    }, 30000);
    socket.connect();
  }

  const lines = readline.createInterface({ input: conn });
  lines.on('line', (raw) => {
    const command = JSON.parse(raw);
    switch (command.cmd) {
      case 'start':
        start(command);
        break;
      case 'kill':
        // The same as a dropped connection: no goodbye, socket.io-client reconnects by itself.
        socket.io.engine.transport.ws._socket.destroy();
        break;
      case 'close':
        socket.disconnect();
        break;
      case 'open':
        socket.connect();
        break;
      case 'emit':
        if (command.ack) {
          socket.timeout(5000).emitWithAck(command.event, command.payload)
            .then((result) => out({ k: 'ack', t: now(), id: command.id, ok: true, args: [result] }))
            .catch((e) => out({ k: 'ack', t: now(), id: command.id, ok: false, error: e.message }));
        } else {
          socket.emit(command.event, command.payload);
          out({ k: 'sent', t: now(), id: command.id, ok: true });
        }
        break;
      default:
        out({ k: 'rig_error', msg: `unsupported command ${command.cmd}` });
    }
  });
  conn.on('close', () => process.exit(0));
});
server.listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
