//! The Socket.IO session: one logical connection that outlives any number of WebSockets.
//!
//! This is `frontend/src/utils/SocketProvider.tsx`, `socketSingleton.ts` and the connection half
//! of `socket-hub/useSocketHub.ts` as one actor, with the same rules: reconnect forever with
//! backoff, take the latest token on each attempt, `subscribeAll` and `presenceOnline` on every
//! connect, presence every 30 s, refresh then `reauthenticate` after `tokenExpiring`.
//!
//! One deliberate difference: socket.io-client buffers `emit` while disconnected and flushes the
//! buffer on connect. This returns [`EmitError::NotConnected`] instead, so that the caller, who
//! knows whether a send is safe to repeat, decides.

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use semaphore_core::socketio::{self, DISCONNECT, Frame, PONG};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Instant, sleep_until, timeout};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async_tls_with_config};

pub const SUBSCRIBE_ALL: &str = "subscribeAll";
pub const PRESENCE_ONLINE: &str = "presenceOnline";
pub const REAUTHENTICATE: &str = "reauthenticate";
pub const TOKEN_EXPIRING: &str = "tokenExpiring";
pub const SESSION_TERMINATED: &str = "sessionTerminated";

/// The wait after the server ends a connection without saying why, before connecting again.
///
/// `SocketProvider.tsx` counts these and signs out at three, backing off 1 s, 2 s, 4 s, but it
/// resets the count on every connect, and every reconnect connects first, so the count never
/// passes one: it always waits 1 s and never signs out. This says that directly. A server that
/// keeps refusing the session refuses the handshake instead (AUTH_FAILED), and that path signs out.
const SERVER_DISCONNECT_DELAY: Duration = Duration::from_secs(1);
const SESSION_REFRESH_DELAYS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];

pub enum Refresh {
    Refreshed(String),
    /// The server refused the session (401 or 403): signed out.
    Rejected,
    /// Network or server error: worth retrying.
    Unavailable,
}

/// Where tokens come from. Keeping this outside the socket keeps the refresh mechanism, which is
/// a platform and auth decision, out of the transport.
#[async_trait]
pub trait TokenSource: Send + Sync {
    async fn access_token(&self) -> Option<String>;
    async fn refresh(&self) -> Refresh;
}

/// `SOCKET_PROTOCOL_SEND_ACK` in `@semaphore-chat/shared`: the handshake's `auth.protocol` that gets
/// typed send acks.
pub const SOCKET_PROTOCOL_SEND_ACK: u32 = 2;

#[derive(Clone)]
pub struct SocketConfig {
    pub base_url: String,
    pub reconnect_delay: Duration,
    pub reconnect_delay_max: Duration,
    pub randomization: f64,
    pub connect_timeout: Duration,
    pub presence_interval: Duration,
    pub reauthenticate_timeout: Duration,
    /// How long a socket that survived a suspend gets to answer before it is replaced.
    pub resume_probe_timeout: Duration,
    pub token_refresh_jitter: Duration,
}

impl SocketConfig {
    /// The values in `socketSingleton.ts` and `SocketProvider.tsx`.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            reconnect_delay: Duration::from_millis(1000),
            reconnect_delay_max: Duration::from_millis(30_000),
            randomization: 0.5,
            connect_timeout: Duration::from_secs(20),
            presence_interval: Duration::from_secs(30),
            reauthenticate_timeout: Duration::from_secs(10),
            resume_probe_timeout: Duration::from_secs(5),
            token_refresh_jitter: Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SocketEvent {
    Connected {
        sid: String,
    },
    /// `reason` uses socket.io-client's words, so transcripts line up.
    Disconnected {
        reason: String,
    },
    ConnectError {
        message: String,
    },
    Event {
        name: String,
        payload: Value,
    },
    /// After `resume()`: the socket survived the suspend and answered, so it was kept. There is
    /// no `Connected` for it, and nothing that reached this socket was lost.
    Resumed,
    Reauthenticated {
        result: Value,
    },
    /// The session can't be recovered: the app must sign in again.
    AuthLost {
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmitError {
    NotConnected,
    /// The socket dropped before the server answered. The server may still have acted on it.
    ConnectionLost,
    Timeout,
    Closed,
}

enum Command {
    Emit {
        event: String,
        payload: Value,
        ack: Option<oneshot::Sender<Result<Vec<Value>, EmitError>>>,
        sent: Option<oneshot::Sender<Result<(), EmitError>>>,
    },
    Connect,
    Disconnect,
    RestartTransport,
    Suspend,
    Resume {
        refresh: bool,
    },
    TokenRefreshed(String),
}

/// Handle to the session actor. Cheap to clone.
#[derive(Clone)]
pub struct SocketClient {
    commands: mpsc::UnboundedSender<Command>,
    idle: Arc<AtomicBool>,
}

impl SocketClient {
    /// Starts the actor, stopped. Call [`connect`](Self::connect).
    pub fn start(
        config: SocketConfig,
        tokens: Arc<dyn TokenSource>,
    ) -> (Self, mpsc::UnboundedReceiver<SocketEvent>) {
        let (commands, command_rx) = mpsc::unbounded_channel();
        let (events, event_rx) = mpsc::unbounded_channel();
        let idle = Arc::new(AtomicBool::new(false));
        let actor = Actor {
            config,
            tokens,
            commands: commands.downgrade(),
            command_rx,
            events,
            idle: idle.clone(),
            want: Want::Stopped,
            next_ack_id: 0,
            pending: HashMap::new(),
            attempts: 0,
            session_end_reason: None,
            refresh_at: None,
            last_ping: Instant::now(),
            resume_probe: None,
        };
        tokio::spawn(actor.run());
        (Self { commands, idle }, event_rx)
    }

    pub fn connect(&self) {
        let _ = self.commands.send(Command::Connect);
    }

    /// Leave for good, with a clean `41`. No reconnect until [`connect`](Self::connect).
    pub fn disconnect(&self) {
        let _ = self.commands.send(Command::Disconnect);
    }

    /// Drop the WebSocket with no goodbye and reconnect with backoff: what a network change
    /// calls for, and what the chaos rig uses to cut a connection.
    pub fn restart_transport(&self) {
        let _ = self.commands.send(Command::RestartTransport);
    }

    /// The OS is about to suspend us: leave cleanly and stop all timers.
    pub fn suspend(&self) {
        let _ = self.commands.send(Command::Suspend);
    }

    /// The OS woke us. A socket we still hold may be dead or alive, and replacing a live one
    /// would throw away whatever the kernel has buffered for it, so it is asked first: it stays
    /// on [`SocketEvent::Resumed`], and is replaced at once, with no backoff, if it doesn't
    /// answer. With no socket, this connects. `refresh` comes from core's `ResyncPlan`.
    pub fn resume(&self, refresh: bool) {
        let _ = self.commands.send(Command::Resume { refresh });
    }

    pub fn set_idle(&self, idle: bool) {
        self.idle.store(idle, Ordering::Relaxed);
    }

    /// Fire and forget. Errs if not connected right now.
    pub async fn emit(&self, event: &str, payload: Value) -> Result<(), EmitError> {
        let (sent, result) = oneshot::channel();
        self.commands
            .send(Command::Emit {
                event: event.to_owned(),
                payload,
                ack: None,
                sent: Some(sent),
            })
            .map_err(|_| EmitError::Closed)?;
        result.await.map_err(|_| EmitError::Closed)?
    }

    /// Emit and wait for the server's ack arguments.
    pub async fn emit_with_ack(
        &self,
        event: &str,
        payload: Value,
        wait: Duration,
    ) -> Result<Vec<Value>, EmitError> {
        let (ack, result) = oneshot::channel();
        self.commands
            .send(Command::Emit {
                event: event.to_owned(),
                payload,
                ack: Some(ack),
                sent: None,
            })
            .map_err(|_| EmitError::Closed)?;
        match timeout(wait, result).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(EmitError::Closed),
            Err(_) => Err(EmitError::Timeout),
        }
    }
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Want {
    Stopped,
    Connected,
    Suspended,
}

enum ConnectFailure {
    Auth,
    Other(String),
}

/// How a live connection ended, and so what happens next.
enum Ended {
    Transport(&'static str),
    Server,
    ClientLeft,
    Restart,
}

struct Actor {
    config: SocketConfig,
    tokens: Arc<dyn TokenSource>,
    // Weak, so that dropping every handle ends the actor.
    commands: mpsc::WeakUnboundedSender<Command>,
    command_rx: mpsc::UnboundedReceiver<Command>,
    events: mpsc::UnboundedSender<SocketEvent>,
    idle: Arc<AtomicBool>,
    want: Want,
    next_ack_id: u64,
    pending: HashMap<u64, oneshot::Sender<Result<Vec<Value>, EmitError>>>,
    attempts: u32,
    session_end_reason: Option<String>,
    refresh_at: Option<Instant>,
    last_ping: Instant,
    resume_probe: Option<ResumeProbe>,
}

/// An ack-requested `presenceOnline` sent to a socket that survived a suspend. TCP keeps order, so
/// by the time its ack arrives, everything buffered ahead of it has been delivered.
struct ResumeProbe {
    ack_id: u64,
    deadline: Instant,
}

impl Actor {
    async fn run(mut self) {
        loop {
            match self.want {
                Want::Stopped | Want::Suspended => {
                    let Some(command) = self.command_rx.recv().await else {
                        return;
                    };
                    self.handle_idle_command(command).await;
                }
                Want::Connected => match self.open().await {
                    Ok(ws) => self.after_connection(ws).await,
                    Err(ConnectFailure::Auth) => {
                        self.emit_event(SocketEvent::ConnectError {
                            message: "AUTH_FAILED".into(),
                        });
                        self.recover_session().await;
                    }
                    Err(ConnectFailure::Other(message)) => {
                        self.emit_event(SocketEvent::ConnectError { message });
                        let delay = self.next_backoff();
                        self.wait(delay).await;
                    }
                },
            }
        }
    }

    fn emit_event(&self, event: SocketEvent) {
        let _ = self.events.send(event);
    }

    /// While there is no socket: emits fail at once and lifecycle commands take effect.
    async fn handle_idle_command(&mut self, command: Command) {
        match command {
            Command::Emit { ack, sent, .. } => {
                if let Some(ack) = ack {
                    let _ = ack.send(Err(EmitError::NotConnected));
                }
                if let Some(sent) = sent {
                    let _ = sent.send(Err(EmitError::NotConnected));
                }
            }
            Command::Connect => {
                self.want = Want::Connected;
                self.attempts = 0;
            }
            Command::Disconnect => self.want = Want::Stopped,
            Command::Suspend => self.want = Want::Suspended,
            Command::Resume { refresh } => self.resume(refresh).await,
            Command::RestartTransport | Command::TokenRefreshed(_) => {}
        }
    }

    async fn resume(&mut self, refresh: bool) {
        if refresh {
            // A refused refresh surfaces as AUTH_FAILED on the connect that follows.
            let _ = self.tokens.refresh().await;
        }
        self.want = Want::Connected;
        self.attempts = 0;
    }

    /// Waits out a delay while still answering commands. Ends early if the plan changes.
    async fn wait(&mut self, delay: Duration) {
        let deadline = Instant::now() + delay;
        loop {
            tokio::select! {
                _ = sleep_until(deadline) => return,
                command = self.command_rx.recv() => {
                    let Some(command) = command else {
                        self.want = Want::Stopped;
                        return;
                    };
                    let was_connecting = self.want == Want::Connected;
                    let resumed = matches!(command, Command::Resume { .. });
                    self.handle_idle_command(command).await;
                    if self.want != Want::Connected || (was_connecting && resumed) {
                        return;
                    }
                }
            }
        }
    }

    /// socket.io-client's backoff: base times 2^attempts, randomized, capped.
    fn next_backoff(&mut self) -> Duration {
        let delay = backoff_delay(&self.config, self.attempts, jitter_unit());
        self.attempts += 1;
        delay
    }

    /// One attempt: WebSocket, Engine.IO open, namespace connect with the latest token.
    async fn open(&mut self) -> Result<(Ws, u64, u64, String), ConnectFailure> {
        let connect_timeout = self.config.connect_timeout;
        match timeout(connect_timeout, self.open_inner()).await {
            Ok(result) => result,
            Err(_) => Err(ConnectFailure::Other("timeout".into())),
        }
    }

    async fn open_inner(&mut self) -> Result<(Ws, u64, u64, String), ConnectFailure> {
        let other = |error: String| ConnectFailure::Other(error);
        let url = socketio::websocket_url(&self.config.base_url);
        // Nagle off, as `ws` does for socket.io-client. subscribeAll and presenceOnline are two
        // small writes in a row, so with it on, presenceOnline waits for the ack of the first,
        // which the server delays by up to 40 ms because subscribeAll gets no reply.
        let connector = crate::websocket_connector()
            .map_err(|error| other(format!("websocket error: {error}")))?;
        let (mut ws, _) = connect_async_tls_with_config(url.as_str(), None, true, Some(connector))
            .await
            .map_err(|error| other(format!("websocket error: {error}")))?;
        let open = match next_frame(&mut ws).await {
            Some(Ok(Frame::EngineOpen(open))) => open,
            other_frame => return Err(other(format!("expected engine open, got {other_frame:?}"))),
        };
        let token = self.tokens.access_token().await.unwrap_or_default();
        // `protocol` asks for typed send acks (`SendAckDto`), as the web's `socketSingleton.ts` does.
        // Without it the server acks a send with a bare id, and a refused one gets no ack at all,
        // only an `exception` event: core then waits out its 10 s ack timeout.
        let hello = socketio::encode_connect(&json!({
            "token": format!("Bearer {token}"),
            "protocol": SOCKET_PROTOCOL_SEND_ACK,
        }));
        ws.send(Message::text(hello))
            .await
            .map_err(|error| other(format!("websocket error: {error}")))?;
        loop {
            match next_frame(&mut ws).await {
                Some(Ok(Frame::Connected { sid })) => {
                    return Ok((ws, open.ping_interval_ms, open.ping_timeout_ms, sid));
                }
                Some(Ok(Frame::ConnectRefused { message })) if message == "AUTH_FAILED" => {
                    return Err(ConnectFailure::Auth);
                }
                Some(Ok(Frame::ConnectRefused { message })) => return Err(other(message)),
                Some(Ok(Frame::Ping)) => {
                    ws.send(Message::text(PONG))
                        .await
                        .map_err(|error| other(format!("websocket error: {error}")))?;
                }
                Some(Ok(Frame::Noop)) => {}
                frame => return Err(other(format!("expected connect, got {frame:?}"))),
            }
        }
    }

    async fn after_connection(
        &mut self,
        (ws, interval, ping_timeout, sid): (Ws, u64, u64, String),
    ) {
        self.attempts = 0;
        self.session_end_reason = None;
        self.emit_event(SocketEvent::Connected { sid });
        let ended = self
            .drive(ws, Duration::from_millis(interval + ping_timeout))
            .await;
        for (_, ack) in self.pending.drain() {
            let _ = ack.send(Err(EmitError::ConnectionLost));
        }
        self.refresh_at = None;
        // A socket found dead on resume is replaced at once: we just woke, nothing is failing.
        let resuming = self.resume_probe.take().is_some();
        match ended {
            Ended::Transport(reason) => {
                self.emit_event(SocketEvent::Disconnected {
                    reason: reason.into(),
                });
                if !resuming {
                    let delay = self.next_backoff();
                    self.wait(delay).await;
                }
            }
            Ended::Restart => {
                self.emit_event(SocketEvent::Disconnected {
                    reason: "transport close".into(),
                });
                if !resuming {
                    let delay = self.next_backoff();
                    self.wait(delay).await;
                }
            }
            Ended::ClientLeft => {
                self.emit_event(SocketEvent::Disconnected {
                    reason: "io client disconnect".into(),
                });
            }
            Ended::Server => {
                self.emit_event(SocketEvent::Disconnected {
                    reason: "io server disconnect".into(),
                });
                self.after_server_disconnect().await;
            }
        }
    }

    /// `SocketProvider.onDisconnect` for "io server disconnect".
    async fn after_server_disconnect(&mut self) {
        if self.session_end_reason.is_some() {
            self.recover_session().await;
            return;
        }
        self.wait(SERVER_DISCONNECT_DELAY).await;
    }

    /// `SocketProvider.recoverSession`: a fresh token is the only way back. Signs out only when
    /// the server refuses. After the retries it reconnects anyway: if the server is out of reach
    /// the connect fails and backs off, and once it answers, AUTH_FAILED brings us back here.
    async fn recover_session(&mut self) {
        for delay in SESSION_REFRESH_DELAYS
            .iter()
            .copied()
            .map(Some)
            .chain([None])
        {
            match self.tokens.refresh().await {
                Refresh::Refreshed(_) => return,
                Refresh::Rejected => {
                    let reason = self.session_end_reason.take();
                    self.emit_event(SocketEvent::AuthLost { reason });
                    self.want = Want::Stopped;
                    return;
                }
                Refresh::Unavailable => match delay {
                    Some(delay) => {
                        self.wait(delay).await;
                        if self.want != Want::Connected {
                            return;
                        }
                    }
                    None => {
                        let delay = self.next_backoff();
                        self.wait(delay).await;
                        return;
                    }
                },
            }
        }
    }

    fn on_connect_frames(&self) -> [String; 2] {
        [
            socketio::encode_event(SUBSCRIBE_ALL, &Value::Null, None),
            self.presence_frame(),
        ]
    }

    fn presence_frame(&self) -> String {
        let idle = self.idle.load(Ordering::Relaxed);
        socketio::encode_event(PRESENCE_ONLINE, &json!({ "idle": idle }), None)
    }

    async fn drive(&mut self, mut ws: Ws, liveness: Duration) -> Ended {
        for frame in self.on_connect_frames() {
            if ws.send(Message::text(frame)).await.is_err() {
                return Ended::Transport("transport error");
            }
        }
        self.last_ping = Instant::now();
        let mut presence_at = Instant::now() + self.config.presence_interval;
        loop {
            // Far enough away never to fire when nothing is scheduled.
            let refresh_at = self
                .refresh_at
                .unwrap_or_else(|| Instant::now() + Duration::from_secs(86_400));
            let probe_deadline = self.resume_probe.as_ref().map_or_else(
                || Instant::now() + Duration::from_secs(86_400),
                |probe| probe.deadline,
            );
            tokio::select! {
                // Biased, frames first: after a freeze every timer is already due, and what is
                // buffered on the socket has to be read before any of them can end the connection.
                biased;
                frame = ws.next() => {
                    let text = match frame {
                        None | Some(Err(_)) => return Ended::Transport("transport close"),
                        Some(Ok(Message::Text(text))) => text,
                        Some(Ok(Message::Close(_))) => return Ended::Transport("transport close"),
                        // WebSocket pings are answered by tungstenite; there is no binary.
                        Some(Ok(_)) => continue,
                    };
                    match socketio::parse_frame(text.as_str()) {
                        Ok(Frame::Ping) => {
                            self.last_ping = Instant::now();
                            if send_text(&mut ws, PONG.to_owned()).await.is_err() {
                                return Ended::Transport("transport error");
                            }
                        }
                        Ok(Frame::ServerDisconnect) => return Ended::Server,
                        Ok(Frame::EngineClose) => return Ended::Transport("transport close"),
                        Ok(Frame::Event { name, payload, .. }) => self.on_event(name, payload),
                        Ok(Frame::Ack { id, .. }) if self.resume_probe.as_ref().is_some_and(|probe| probe.ack_id == id) => {
                            self.resume_probe = None;
                            self.last_ping = Instant::now();
                            self.emit_event(SocketEvent::Resumed);
                        }
                        Ok(Frame::Ack { id, args }) => {
                            if let Some(ack) = self.pending.remove(&id) {
                                let _ = ack.send(Ok(args));
                            }
                        }
                        Ok(_) => {}
                        // A frame we can't read must not end a live session.
                        Err(error) => self.emit_event(SocketEvent::ConnectError { message: format!("bad frame: {error}") }),
                    }
                }
                command = self.command_rx.recv() => {
                    let Some(command) = command else {
                        self.want = Want::Stopped;
                        return Ended::ClientLeft;
                    };
                    if let Some(ended) = self.handle_live_command(&mut ws, command).await {
                        return ended;
                    }
                }
                _ = sleep_until(self.last_ping + liveness) => return Ended::Transport("ping timeout"),
                _ = sleep_until(presence_at) => {
                    presence_at = Instant::now() + self.config.presence_interval;
                    if send_text(&mut ws, self.presence_frame()).await.is_err() {
                        return Ended::Transport("transport error");
                    }
                }
                _ = sleep_until(refresh_at), if self.refresh_at.is_some() => {
                    self.refresh_at = None;
                    self.start_refresh();
                }
                _ = sleep_until(probe_deadline), if self.resume_probe.is_some() => return Ended::Restart,
            }
        }
    }

    fn on_event(&mut self, name: String, payload: Value) {
        match name.as_str() {
            TOKEN_EXPIRING if self.refresh_at.is_none() => {
                let jitter = self.config.token_refresh_jitter.as_secs_f64() * jitter_unit();
                self.refresh_at = Some(Instant::now() + Duration::from_secs_f64(jitter));
            }
            SESSION_TERMINATED => {
                self.session_end_reason = payload
                    .get("reason")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            _ => {}
        }
        self.emit_event(SocketEvent::Event { name, payload });
    }

    /// Refreshing can take seconds, and the socket must keep answering pings meanwhile.
    fn start_refresh(&self) {
        let tokens = self.tokens.clone();
        let commands = self.commands.clone();
        tokio::spawn(async move {
            // A failure is left to the expiry: the server ends the session and
            // `recover_session` refreshes again, as SocketProvider does.
            if let Refresh::Refreshed(token) = tokens.refresh().await
                && let Some(commands) = commands.upgrade()
            {
                let _ = commands.send(Command::TokenRefreshed(token));
            }
        });
    }

    async fn handle_live_command(&mut self, ws: &mut Ws, command: Command) -> Option<Ended> {
        match command {
            Command::Emit {
                event,
                payload,
                ack,
                sent,
            } => {
                let ack_id = ack.map(|ack| {
                    self.next_ack_id += 1;
                    self.pending.insert(self.next_ack_id, ack);
                    self.next_ack_id
                });
                let frame = socketio::encode_event(&event, &payload, ack_id);
                let result = send_text(ws, frame).await;
                if let Some(sent) = sent {
                    let _ = sent.send(if result.is_ok() {
                        Ok(())
                    } else {
                        Err(EmitError::ConnectionLost)
                    });
                }
                result.err().map(|_| Ended::Transport("transport error"))
            }
            Command::Connect => None,
            Command::Disconnect => {
                let _ = send_text(ws, DISCONNECT.to_owned()).await;
                let _ = ws.close(None).await;
                self.want = Want::Stopped;
                Some(Ended::ClientLeft)
            }
            Command::RestartTransport => Some(Ended::Restart),
            Command::Suspend => {
                let _ = send_text(ws, DISCONNECT.to_owned()).await;
                let _ = ws.close(None).await;
                self.want = Want::Suspended;
                Some(Ended::ClientLeft)
            }
            Command::Resume { refresh } => {
                if refresh {
                    self.start_refresh();
                }
                self.next_ack_id += 1;
                let ack_id = self.next_ack_id;
                self.resume_probe = Some(ResumeProbe {
                    ack_id,
                    deadline: Instant::now() + self.config.resume_probe_timeout,
                });
                // The ping clock didn't run usefully while we were away: the probe decides now.
                self.last_ping = Instant::now();
                let idle = self.idle.load(Ordering::Relaxed);
                let frame =
                    socketio::encode_event(PRESENCE_ONLINE, &json!({ "idle": idle }), Some(ack_id));
                send_text(ws, frame)
                    .await
                    .err()
                    .map(|_| Ended::Transport("transport error"))
            }
            Command::TokenRefreshed(token) => {
                self.next_ack_id += 1;
                let id = self.next_ack_id;
                let (ack, result) = oneshot::channel();
                self.pending.insert(id, ack);
                let frame = socketio::encode_event(
                    REAUTHENTICATE,
                    &json!({ "token": format!("Bearer {token}") }),
                    Some(id),
                );
                let events = self.events.clone();
                let wait = self.config.reauthenticate_timeout;
                tokio::spawn(async move {
                    // Neither failure is fatal: at worst the server ends the session at the old
                    // expiry and we reconnect with the fresh token.
                    let result = match timeout(wait, result).await {
                        Ok(Ok(Ok(args))) => args.into_iter().next().unwrap_or(Value::Null),
                        Ok(_) => json!({ "ok": false, "error": "connection lost" }),
                        Err(_) => json!({ "ok": false, "error": "timeout" }),
                    };
                    let _ = events.send(SocketEvent::Reauthenticated { result });
                });
                send_text(ws, frame)
                    .await
                    .err()
                    .map(|_| Ended::Transport("transport error"))
            }
        }
    }
}

const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

async fn send_text(ws: &mut Ws, text: String) -> Result<(), ()> {
    match timeout(WRITE_TIMEOUT, ws.send(Message::text(text))).await {
        Ok(Ok(())) => Ok(()),
        _ => Err(()),
    }
}

async fn next_frame(ws: &mut Ws) -> Option<Result<Frame, socketio::FrameError>> {
    loop {
        match ws.next().await? {
            Ok(Message::Text(text)) => return Some(socketio::parse_frame(text.as_str())),
            Ok(Message::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

/// The `attempts`th reconnect delay for a `jitter` in [0, 1): base times 2^attempts, spread by
/// `randomization` either way, capped at the maximum.
fn backoff_delay(config: &SocketConfig, attempts: u32, jitter: f64) -> Duration {
    let exponential = config.reconnect_delay.as_secs_f64() * 2f64.powi(attempts.min(20) as i32);
    let spread = (2.0 * jitter - 1.0) * config.randomization;
    let delay = exponential * (1.0 + spread);
    Duration::from_secs_f64(delay.min(config.reconnect_delay_max.as_secs_f64()))
}

/// Uniform in [0, 1). Backoff jitter needs spread, not quality, and this avoids a rand dependency.
fn jitter_unit() -> f64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos())
        .unwrap_or(0);
    let mixed = nanos.wrapping_mul(2_654_435_761);
    f64::from(mixed) / (f64::from(u32::MAX) + 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A connect packet's auth, whatever order serde_json keeps keys in: `preserve_order` is on when
    /// the whole workspace builds and off for this crate alone.
    fn handshake(packet: &str) -> Value {
        let body = packet.strip_prefix("40").expect("a connect packet");
        serde_json::from_str(body).expect("its auth is JSON")
    }
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    struct FixedToken(std::sync::Mutex<String>);

    #[async_trait]
    impl TokenSource for FixedToken {
        async fn access_token(&self) -> Option<String> {
            Some(self.0.lock().unwrap().clone())
        }
        async fn refresh(&self) -> Refresh {
            *self.0.lock().unwrap() = "fresh".into();
            Refresh::Refreshed("fresh".into())
        }
    }

    type ServerWs = WebSocketStream<TcpStream>;

    /// The gateway's side of a handshake. Returns the auth packet the client sent.
    async fn accept(listener: &TcpListener, ping_interval_ms: u64) -> (ServerWs, String) {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let open = format!(
            r#"0{{"sid":"e1","upgrades":[],"pingInterval":{ping_interval_ms},"pingTimeout":200,"maxPayload":1000000}}"#
        );
        ws.send(Message::text(open)).await.unwrap();
        let Some(Ok(Message::Text(auth))) = ws.next().await else {
            panic!("no auth packet");
        };
        ws.send(Message::text(r#"40{"sid":"s1"}"#)).await.unwrap();
        (ws, auth.to_string())
    }

    async fn next_text(ws: &mut ServerWs) -> String {
        loop {
            let frame = timeout(Duration::from_secs(5), ws.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            if let Message::Text(text) = frame {
                return text.to_string();
            }
        }
    }

    async fn client_for(
        listener: &TcpListener,
        presence: Duration,
    ) -> (SocketClient, mpsc::UnboundedReceiver<SocketEvent>) {
        let mut config = SocketConfig::new(format!("http://{}", listener.local_addr().unwrap()));
        config.reconnect_delay = Duration::from_millis(1);
        config.presence_interval = presence;
        config.token_refresh_jitter = Duration::ZERO;
        let tokens = Arc::new(FixedToken(std::sync::Mutex::new("first".into())));
        let (client, events) = SocketClient::start(config, tokens);
        client.connect();
        (client, events)
    }

    #[tokio::test]
    async fn sends_what_the_web_client_sends_on_connect_and_repeats_presence() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (_client, _events) = client_for(&listener, Duration::from_millis(30)).await;
        let (mut ws, auth) = accept(&listener, 25_000).await;

        assert_eq!(
            handshake(&auth),
            json!({ "token": "Bearer first", "protocol": 2 })
        );
        assert_eq!(next_text(&mut ws).await, r#"42["subscribeAll"]"#);
        for _ in 0..3 {
            assert_eq!(
                next_text(&mut ws).await,
                r#"42["presenceOnline",{"idle":false}]"#
            );
        }
    }

    #[tokio::test]
    async fn answers_pings() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (_client, _events) = client_for(&listener, Duration::from_secs(3600)).await;
        let (mut ws, _) = accept(&listener, 25_000).await;
        next_text(&mut ws).await;
        next_text(&mut ws).await;

        ws.send(Message::text("2")).await.unwrap();

        assert_eq!(next_text(&mut ws).await, "3");
    }

    #[tokio::test]
    async fn a_silent_server_ends_the_connection_and_the_client_reconnects() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (_client, mut events) = client_for(&listener, Duration::from_secs(3600)).await;
        // pingInterval + pingTimeout = 250 ms with no ping sent.
        let (_ws, _) = accept(&listener, 50).await;

        let (_second, _) = accept(&listener, 25_000).await;

        let mut seen = Vec::new();
        while seen.len() < 3 {
            seen.push(events.recv().await.unwrap());
        }
        assert_eq!(
            seen[1],
            SocketEvent::Disconnected {
                reason: "ping timeout".into()
            }
        );
        assert!(matches!(seen[2], SocketEvent::Connected { .. }));
    }

    #[tokio::test]
    async fn a_pending_ack_fails_when_the_connection_drops() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (client, _events) = client_for(&listener, Duration::from_secs(3600)).await;
        let (mut ws, _) = accept(&listener, 25_000).await;
        next_text(&mut ws).await;
        next_text(&mut ws).await;

        let call = tokio::spawn({
            let client = client.clone();
            async move {
                client
                    .emit_with_ack("sendMessage", json!({}), Duration::from_secs(5))
                    .await
            }
        });
        assert_eq!(next_text(&mut ws).await, r#"421["sendMessage",{}]"#);
        drop(ws);

        assert_eq!(call.await.unwrap(), Err(EmitError::ConnectionLost));
    }

    #[tokio::test]
    async fn emit_while_stopped_errs_instead_of_buffering() {
        let config = SocketConfig::new("http://127.0.0.1:9");
        let tokens = Arc::new(FixedToken(std::sync::Mutex::new("t".into())));
        let (client, _events) = SocketClient::start(config, tokens);
        assert_eq!(
            client.emit("x", Value::Null).await,
            Err(EmitError::NotConnected)
        );
    }

    #[tokio::test]
    async fn token_expiring_leads_to_refresh_and_reauthenticate_with_the_new_token() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (_client, mut events) = client_for(&listener, Duration::from_secs(3600)).await;
        let (mut ws, _) = accept(&listener, 25_000).await;
        next_text(&mut ws).await;
        next_text(&mut ws).await;

        ws.send(Message::text(r#"42["tokenExpiring",{"expiresAt":1}]"#))
            .await
            .unwrap();

        assert_eq!(
            next_text(&mut ws).await,
            r#"421["reauthenticate",{"token":"Bearer fresh"}]"#
        );
        ws.send(Message::text(r#"431[{"ok":true}]"#)).await.unwrap();
        loop {
            if let SocketEvent::Reauthenticated { result } = events.recv().await.unwrap() {
                assert_eq!(result, json!({"ok":true}));
                return;
            }
        }
    }

    #[tokio::test]
    async fn server_ending_the_session_refreshes_before_reconnecting() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (_client, _events) = client_for(&listener, Duration::from_secs(3600)).await;
        let (mut ws, _) = accept(&listener, 25_000).await;
        next_text(&mut ws).await;
        next_text(&mut ws).await;

        ws.send(Message::text(
            r#"42["sessionTerminated",{"reason":"TOKEN_EXPIRED"}]"#,
        ))
        .await
        .unwrap();
        ws.send(Message::text("41")).await.unwrap();

        let (_second, auth) = accept(&listener, 25_000).await;
        assert_eq!(
            handshake(&auth),
            json!({ "token": "Bearer fresh", "protocol": 2 })
        );
    }

    #[tokio::test]
    async fn resume_keeps_a_socket_that_answers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (client, mut events) = client_for(&listener, Duration::from_secs(3600)).await;
        let (mut ws, _) = accept(&listener, 25_000).await;
        next_text(&mut ws).await;
        next_text(&mut ws).await;
        assert!(matches!(
            events.recv().await,
            Some(SocketEvent::Connected { .. })
        ));

        client.resume(false);

        assert_eq!(
            next_text(&mut ws).await,
            r#"421["presenceOnline",{"idle":false}]"#
        );
        ws.send(Message::text(r#"42["buffered",1]"#)).await.unwrap();
        ws.send(Message::text(r#"431["ACK"]"#)).await.unwrap();
        assert_eq!(
            events.recv().await,
            Some(SocketEvent::Event {
                name: "buffered".into(),
                payload: json!(1)
            })
        );
        assert_eq!(events.recv().await, Some(SocketEvent::Resumed));
        // Still the same connection.
        ws.send(Message::text(r#"42["after",2]"#)).await.unwrap();
        assert_eq!(
            events.recv().await,
            Some(SocketEvent::Event {
                name: "after".into(),
                payload: json!(2)
            })
        );
    }

    #[tokio::test]
    async fn resume_replaces_a_socket_that_does_not_answer_without_backoff() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut config = SocketConfig::new(format!("http://{}", listener.local_addr().unwrap()));
        // Long enough that a backoff would fail the timeout below.
        config.reconnect_delay = Duration::from_secs(60);
        config.resume_probe_timeout = Duration::from_millis(50);
        let tokens = Arc::new(FixedToken(std::sync::Mutex::new("first".into())));
        let (client, mut events) = SocketClient::start(config, tokens);
        client.connect();
        let (mut ws, _) = accept(&listener, 25_000).await;
        next_text(&mut ws).await;
        next_text(&mut ws).await;

        client.resume(false);

        // The old socket stays open and silent. A new connection arrives anyway.
        let (_second, _) = timeout(Duration::from_secs(5), accept(&listener, 25_000))
            .await
            .unwrap();
        let mut seen = Vec::new();
        while seen.len() < 3 {
            seen.push(events.recv().await.unwrap());
        }
        assert!(matches!(seen[1], SocketEvent::Disconnected { .. }));
        assert!(matches!(seen[2], SocketEvent::Connected { .. }));
    }

    #[tokio::test]
    async fn resume_with_no_socket_connects() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (client, _events) = client_for(&listener, Duration::from_secs(3600)).await;
        let (mut ws, _) = accept(&listener, 25_000).await;
        next_text(&mut ws).await;
        next_text(&mut ws).await;

        client.suspend();
        assert_eq!(next_text(&mut ws).await, "41");
        client.resume(false);

        let (_second, auth) = timeout(Duration::from_secs(5), accept(&listener, 25_000))
            .await
            .unwrap();
        assert_eq!(
            handshake(&auth),
            json!({ "token": "Bearer first", "protocol": 2 })
        );
    }

    #[test]
    fn backoff_doubles_from_the_base_and_stops_at_the_cap() {
        let mut config = SocketConfig::new("http://x");
        config.randomization = 0.0;
        let delays: Vec<u64> = (0..8)
            .map(|attempts| backoff_delay(&config, attempts, 0.5).as_millis() as u64)
            .collect();
        assert_eq!(
            delays,
            [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]
        );
        // However many attempts: the exponent stops growing, and nothing overflows.
        assert_eq!(
            backoff_delay(&config, u32::MAX, 0.5),
            Duration::from_secs(30)
        );
    }

    #[test]
    fn backoff_jitter_spreads_by_the_randomization_either_way() {
        let config = SocketConfig::new("http://x");
        // Randomization 0.5: from half to one and a half times the step.
        assert_eq!(backoff_delay(&config, 1, 0.0), Duration::from_millis(1_000));
        assert_eq!(backoff_delay(&config, 1, 0.5), Duration::from_millis(2_000));
        assert_eq!(backoff_delay(&config, 1, 0.999_999).as_millis(), 2_999);
        // Spread never lifts a delay past the cap.
        assert_eq!(
            backoff_delay(&config, 5, 0.999_999),
            Duration::from_secs(30)
        );
    }

    #[test]
    fn backoff_with_a_zero_base_is_zero() {
        let mut config = SocketConfig::new("http://x");
        config.reconnect_delay = Duration::ZERO;
        for attempts in [0, 1, 30] {
            assert_eq!(backoff_delay(&config, attempts, 0.9), Duration::ZERO);
        }
    }

    #[test]
    fn jitter_stays_in_range() {
        for _ in 0..1000 {
            assert!((0.0..1.0).contains(&jitter_unit()));
        }
    }
}
