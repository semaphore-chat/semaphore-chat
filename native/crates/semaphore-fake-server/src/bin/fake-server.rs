//! `fake-server --scenario <name> [--port N] [--bind IP] [--livekit-url U --livekit-key K --livekit-secret S]`
//!
//! With a LiveKit given, voice tokens are real ones for it; otherwise placeholders.
//!
//! Serves one scenario until killed, and exposes the control API at
//! `POST /__control/<name>` for scripts.

use semaphore_fake_server::livekit::LiveKit;
use semaphore_fake_server::{FakeServer, ScenarioSource, load_named};

fn usage() -> ! {
    eprintln!(
        "usage: fake-server --scenario <name> [--port N] [--bind IP] [--livekit-url U --livekit-key K --livekit-secret S]"
    );
    std::process::exit(2);
}

#[tokio::main]
async fn main() {
    let mut scenario = None;
    let mut port = 0u16;
    let mut bind = std::net::Ipv4Addr::LOCALHOST;
    let (mut livekit_url, mut livekit_key, mut livekit_secret) = (None, None, None);
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--scenario" => scenario = args.next(),
            "--port" => {
                let Some(value) = args.next() else { usage() };
                port = value.parse().unwrap_or_else(|_| usage());
            }
            "--bind" => {
                let Some(value) = args.next() else { usage() };
                bind = value.parse().unwrap_or_else(|_| usage());
            }
            "--livekit-url" => livekit_url = args.next(),
            "--livekit-key" => livekit_key = args.next(),
            "--livekit-secret" => livekit_secret = args.next(),
            "--help" | "-h" => usage(),
            other => {
                eprintln!("unknown argument {other}");
                usage();
            }
        }
    }
    let Some(scenario) = scenario else {
        usage();
    };
    let source = match load_named(&scenario) {
        Ok(json) => ScenarioSource::Json(json),
        Err(error) => {
            eprintln!("fake-server: {error}");
            std::process::exit(1);
        }
    };
    match FakeServer::start_at(source, bind, port).await {
        Ok(server) => {
            match (livekit_url, livekit_key, livekit_secret) {
                (Some(url), Some(key), Some(secret)) => {
                    println!("fake-server minting tokens for {url}");
                    server.set_livekit(LiveKit { url, key, secret });
                }
                (None, None, None) => {}
                _ => usage(),
            }
            println!(
                "fake-server {scenario} listening on {} (bound to {bind})",
                server.base_url()
            );
            std::future::pending::<()>().await;
        }
        Err(error) => {
            eprintln!("fake-server: {error}");
            std::process::exit(1);
        }
    }
}
