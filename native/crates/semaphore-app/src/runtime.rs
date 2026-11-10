//! Where async work runs. GPUI's main thread owns every entity and never awaits the network; core's
//! commands, `Core::drive`, the socket and reqwest all run on one Tokio runtime, because reqwest and
//! `SocketRealtime` need a Tokio reactor and GPUI has none. Results come back to the main thread
//! through a channel a GPUI task waits on, so no frame ever blocks on them.

use gpui_kit::*;
use std::future::Future;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// A counter that moves whenever something arrives for the main thread: a core event or a finished
/// command. The headless rig waits on it instead of guessing how long the network takes.
#[derive(Default)]
pub struct Activity {
    count: Mutex<u64>,
    changed: Condvar,
}

impl Activity {
    pub fn bump(&self) {
        let mut count = self.count.lock().unwrap_or_else(|p| p.into_inner());
        *count += 1;
        self.changed.notify_all();
    }

    pub fn current(&self) -> u64 {
        *self.count.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Waits until the counter passes `seen`, or `limit` runs out. Returns the counter.
    pub fn wait_past(&self, seen: u64, limit: Duration) -> u64 {
        let count = self.count.lock().unwrap_or_else(|p| p.into_inner());
        let (count, _) = self
            .changed
            .wait_timeout_while(count, limit, |count| *count <= seen)
            .unwrap_or_else(|p| p.into_inner());
        *count
    }
}

/// Runs futures on the net runtime and brings their results back to an entity on the main thread.
#[derive(Clone)]
pub struct Exec {
    handle: tokio::runtime::Handle,
    activity: Arc<Activity>,
}

impl Exec {
    pub fn new(handle: tokio::runtime::Handle, activity: Arc<Activity>) -> Self {
        Self { handle, activity }
    }

    pub fn handle(&self) -> &tokio::runtime::Handle {
        &self.handle
    }

    /// Runs `work` and forgets it. For commands whose result arrives as core events.
    pub fn fire(&self, work: impl Future<Output = ()> + Send + 'static) {
        let activity = self.activity.clone();
        self.handle.spawn(async move {
            work.await;
            activity.bump();
        });
    }

    /// Runs `work`, then calls `done` on the entity with its result, on the main thread with the
    /// window. Dropped quietly if the entity or window has gone by then.
    pub fn run<T: 'static, R: Send + 'static>(
        &self,
        window: &Window,
        cx: &mut Context<T>,
        work: impl Future<Output = R> + Send + 'static,
        done: impl FnOnce(&mut T, R, &mut Window, &mut Context<T>) + 'static,
    ) {
        let (sender, receiver) = async_channel::bounded(1);
        let activity = self.activity.clone();
        self.handle.spawn(async move {
            let result = work.await;
            let _ = sender.send(result).await;
            activity.bump();
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(result) = receiver.recv().await {
                this.update_in(cx, |this, window, cx| done(this, result, window, cx))
                    .ok();
            }
        })
        .detach();
    }
}

/// The net runtime: two workers is plenty for one user's REST calls and one socket.
pub fn net_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("semaphore-net")
        .enable_all()
        .build()
        .expect("the net runtime starts")
}
