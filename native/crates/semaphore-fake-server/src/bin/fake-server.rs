//! `fake-server --scenario <name> [--port N]`
//!
//! Serves one scenario until killed, and exposes the control API at
//! `POST /__control/<name>` for scripts.

use semaphore_fake_server::{FakeServer, ScenarioSource, load_named};

fn usage() -> ! {
    eprintln!("usage: fake-server --scenario <name> [--port N]");
    std::process::exit(2);
}

#[tokio::main]
async fn main() {
    let mut scenario = None;
    let mut port = 0u16;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--scenario" => scenario = args.next(),
            "--port" => {
                let Some(value) = args.next() else { usage() };
                port = value.parse().unwrap_or_else(|_| usage());
            }
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
    match FakeServer::start_on(source, port).await {
        Ok(server) => {
            println!("fake-server {scenario} listening on {}", server.base_url());
            std::future::pending::<()>().await;
        }
        Err(error) => {
            eprintln!("fake-server: {error}");
            std::process::exit(1);
        }
    }
}
