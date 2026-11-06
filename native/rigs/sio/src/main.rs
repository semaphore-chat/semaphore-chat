//! T8 client process. Listens on CONTROL_PORT for one orchestrator connection and speaks line
//! JSON: commands in, a timestamped transcript out. `ref-client.js` is the same thing around the
//! real socket.io-client, so `run.py` drives both the same way.
//!
//! RIG ONLY: `HttpTokens` refreshes by replaying the login's refresh cookie. It sets no special
//! User-Agent, and never reaches a real client: the real refresh path is the auth agent's.

use async_trait::async_trait;
use semaphore_core::Core;
use semaphore_core::cache::QueryKey;
use semaphore_core::platform::{Clock, CoreEvent, EventSink};
use semaphore_net::socket::{
    EmitError, Refresh, SocketClient, SocketConfig, SocketEvent, TokenSource,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

struct HttpTokens {
    base_url: String,
    state: Mutex<(String, String)>,
    out: mpsc::UnboundedSender<Value>,
}

#[async_trait]
impl TokenSource for HttpTokens {
    async fn access_token(&self) -> Option<String> {
        Some(self.state.lock().unwrap().0.clone())
    }

    async fn refresh(&self) -> Refresh {
        let cookie = self.state.lock().unwrap().1.clone();
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/api/auth/refresh", self.base_url))
            .header("Cookie", cookie)
            .send()
            .await;
        let outcome = match response {
            Ok(response) if response.status().is_success() => {
                let set_cookie = response
                    .headers()
                    .get_all("set-cookie")
                    .iter()
                    .filter_map(|value| value.to_str().ok())
                    .find(|value| value.starts_with("refresh_token="))
                    .and_then(|value| value.split(';').next())
                    .map(str::to_owned);
                let body: Value = response.json().await.unwrap_or(Value::Null);
                match body.get("accessToken").and_then(Value::as_str) {
                    Some(token) => {
                        let mut state = self.state.lock().unwrap();
                        state.0 = token.to_owned();
                        if let Some(cookie) = set_cookie {
                            state.1 = cookie;
                        }
                        Refresh::Refreshed(token.to_owned())
                    }
                    None => Refresh::Unavailable,
                }
            }
            Ok(response) if matches!(response.status().as_u16(), 401 | 403) => Refresh::Rejected,
            _ => Refresh::Unavailable,
        };
        let name = match &outcome {
            Refresh::Refreshed(_) => "refreshed",
            Refresh::Rejected => "rejected",
            Refresh::Unavailable => "unavailable",
        };
        let _ = self
            .out
            .send(json!({"k":"refresh","t":now_ms(),"result":name}));
        outcome
    }
}

struct WallClock;
impl Clock for WallClock {
    fn now_ms(&self) -> u64 {
        now_ms()
    }
}

struct Sink(mpsc::UnboundedSender<Value>);
impl EventSink for Sink {
    fn on_event(&self, event: CoreEvent) {
        if let CoreEvent::ConnectionChanged { state } = event {
            let _ = self
                .0
                .send(json!({"k":"core_state","t":now_ms(),"state":format!("{state:?}")}));
        }
    }
}

struct Session {
    client: SocketClient,
    core: Arc<Core>,
}

fn duration_ms(command: &Value, key: &str, default: u64) -> Duration {
    Duration::from_millis(command.get(key).and_then(Value::as_u64).unwrap_or(default))
}

fn start_session(command: &Value, out: &mpsc::UnboundedSender<Value>) -> Session {
    let text = |key: &str| {
        command
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let mut config = SocketConfig::new(text("url"));
    config.reconnect_delay = duration_ms(command, "reconnectDelayMs", 1000);
    config.reconnect_delay_max = duration_ms(command, "reconnectDelayMaxMs", 30_000);
    config.token_refresh_jitter = duration_ms(command, "refreshJitterMs", 30_000);
    let tokens = Arc::new(HttpTokens {
        base_url: text("url"),
        state: Mutex::new((text("token"), text("cookie"))),
        out: out.clone(),
    });
    let (client, mut events) = SocketClient::start(config, tokens);
    let core = Arc::new(Core::new(Arc::new(WallClock), Arc::new(Sink(out.clone()))));
    if let Some(expiry) = command.get("tokenExpiresAtMs").and_then(Value::as_u64) {
        core.set_token_expiry(expiry);
    }
    core.cache_set(QueryKey::new(&["messages", "channel"]), "[]".into());
    let forward = out.clone();
    let core_events = core.clone();
    tokio::spawn(async move {
        let mut conn = 0u64;
        while let Some(event) = events.recv().await {
            let t = now_ms();
            let line = match event {
                SocketEvent::Connected { sid } => {
                    conn += 1;
                    core_events.socket_connected();
                    json!({"k":"connected","t":t,"conn":conn,"sid":sid})
                }
                SocketEvent::Disconnected { reason } => {
                    core_events.socket_disconnected();
                    json!({"k":"disconnected","t":t,"conn":conn,"reason":reason})
                }
                SocketEvent::ConnectError { message } => {
                    json!({"k":"connect_error","t":t,"msg":message})
                }
                SocketEvent::Event { name, payload } => {
                    json!({"k":"ev","t":t,"conn":conn,"e":name,"p":payload})
                }
                SocketEvent::Resumed => {
                    core_events.socket_connected();
                    json!({"k":"resumed","t":t,"conn":conn})
                }
                SocketEvent::Reauthenticated { result } => {
                    json!({"k":"reauthenticated","t":t,"result":result})
                }
                SocketEvent::AuthLost { reason } => json!({"k":"auth_lost","t":t,"reason":reason}),
            };
            let _ = forward.send(line);
        }
    });
    client.connect();
    Session { client, core }
}

fn emit_error_name(error: &EmitError) -> &'static str {
    match error {
        EmitError::NotConnected => "not connected",
        EmitError::ConnectionLost => "connection lost",
        EmitError::Timeout => "timeout",
        EmitError::Closed => "closed",
    }
}

fn handle(session: &mut Option<Session>, command: Value, out: &mpsc::UnboundedSender<Value>) {
    let name = command
        .get("cmd")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if name == "start" {
        *session = Some(start_session(&command, out));
        return;
    }
    let Some(active) = session else { return };
    match name {
        "kill" => active.client.restart_transport(),
        "close" => active.client.disconnect(),
        "open" => active.client.connect(),
        "suspend" => {
            active.core.suspend();
            active.client.suspend();
        }
        // Also what a frozen process does when it thaws: core was never told about the freeze,
        // so it is suspended first, and the plan is what any wake-up gets.
        "resume" => {
            active.core.suspend();
            let plan = active.core.resume();
            let stale: Vec<String> = plan
                .stale_queries
                .iter()
                .map(|key| format!("{key:?}"))
                .collect();
            let _ = out.send(json!({
                "k":"resync_plan","t":now_ms(),"reconnect":plan.reconnect_socket,
                "refresh":plan.refresh_token,"stale":stale,
            }));
            active.client.resume(plan.refresh_token);
        }
        "emit" => {
            let client = active.client.clone();
            let out = out.clone();
            let id = command.get("id").cloned().unwrap_or(Value::Null);
            let event = command
                .get("event")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let payload = command.get("payload").cloned().unwrap_or(Value::Null);
            let wants_ack = command.get("ack").and_then(Value::as_bool).unwrap_or(false);
            tokio::spawn(async move {
                let line = if wants_ack {
                    match client
                        .emit_with_ack(&event, payload, Duration::from_secs(5))
                        .await
                    {
                        Ok(args) => json!({"k":"ack","t":now_ms(),"id":id,"ok":true,"args":args}),
                        Err(error) => {
                            json!({"k":"ack","t":now_ms(),"id":id,"ok":false,"error":emit_error_name(&error)})
                        }
                    }
                } else {
                    match client.emit(&event, payload).await {
                        Ok(()) => json!({"k":"sent","t":now_ms(),"id":id,"ok":true}),
                        Err(error) => {
                            json!({"k":"sent","t":now_ms(),"id":id,"ok":false,"error":emit_error_name(&error)})
                        }
                    }
                };
                let _ = out.send(line);
            });
        }
        other => {
            let _ = out.send(json!({"k":"rig_error","msg":format!("unknown command {other}")}));
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("CONTROL_PORT").unwrap_or_else(|_| "9000".into());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    println!("listening on {port}");
    let (stream, _) = listener.accept().await?;
    let (reader, mut writer) = stream.into_split();
    let (out, mut out_rx) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            let mut bytes = line.to_string().into_bytes();
            bytes.push(b'\n');
            if writer.write_all(&bytes).await.is_err() {
                return;
            }
        }
    });
    let _ = out.send(json!({"k":"ready","client":"rust"}));
    let mut lines = BufReader::new(reader).lines();
    let mut session = None;
    while let Some(line) = lines.next_line().await? {
        match serde_json::from_str::<Value>(&line) {
            Ok(command) => handle(&mut session, command, &out),
            Err(error) => {
                let _ = out.send(json!({"k":"rig_error","msg":error.to_string()}));
            }
        }
    }
    Ok(())
}
