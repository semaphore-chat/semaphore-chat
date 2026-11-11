//! W4: keeps the system from idle-sleeping during a call ([`KeepAwake`]), never the display, as
//! Electron's `prevent-app-suspension`.
//!
//! - **Linux:** a logind inhibitor, `what = "idle"`, `mode = "block"`, held as the file descriptor
//!   logind hands back; closing it releases the inhibitor. `idle`, not `sleep`: a suspend the user
//!   asks for, or a closed lid, still happens. The limit: it only holds off an idle suspend that
//!   goes through logind's idle handling (`IdleAction=`, and desktops that honour logind's idle
//!   inhibitors). A desktop that suspends on idle by itself without asking logind isn't stopped.
//! - **Windows:** `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`. The state belongs
//!   to the thread that set it, so it is set, kept and cleared on one thread.
//! - **Anything else:** unavailable.
//!
//! **Threads.** Both run on a thread of this module's own, which owns the hold: [`KeepAwake::set`]
//! hands it the change and waits (bounded) for the answer. So zbus's `block_on` (async-io; see
//! `scripts/check-zbus-tokio.sh`) never runs on the caller's thread, which may be a Tokio worker
//! ("Cannot start a runtime from within a runtime").

use semaphore_core::platform::{CoreError, KeepAwake};
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

/// How long `set` waits for the system to answer. logind answers in milliseconds; a hung bus
/// mustn't hang the caller.
const ANSWER_WITHIN: Duration = Duration::from_secs(5);

/// Takes the hold on the platform. Called on the keep-awake thread only; the returned value is the
/// hold, and dropping it (on that thread too) lets the system sleep again.
pub trait Inhibit: Send + 'static {
    fn acquire(&mut self) -> Result<Box<dyn Send>, String>;
}

enum Command {
    Set(bool, mpsc::Sender<Result<(), String>>),
}

struct Worker {
    commands: mpsc::Sender<Command>,
    thread: JoinHandle<()>,
}

/// The platform's [`KeepAwake`]. Cheap until first used: the thread starts on the first `set`.
pub struct DesktopKeepAwake {
    inhibitor: Mutex<Option<Box<dyn Inhibit>>>,
    worker: Mutex<Option<Worker>>,
}

impl std::fmt::Debug for DesktopKeepAwake {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DesktopKeepAwake").finish_non_exhaustive()
    }
}

impl Default for DesktopKeepAwake {
    fn default() -> Self {
        Self::new()
    }
}

impl DesktopKeepAwake {
    /// logind on Linux, the execution state on Windows; elsewhere every `set(true)` fails.
    pub fn new() -> Self {
        Self::with_inhibitor_opt(platform::inhibitor())
    }

    /// With another way of holding the system awake: tests use a fake.
    pub fn with_inhibitor(inhibitor: impl Inhibit) -> Self {
        Self::with_inhibitor_opt(Some(Box::new(inhibitor)))
    }

    fn with_inhibitor_opt(inhibitor: Option<Box<dyn Inhibit>>) -> Self {
        Self {
            inhibitor: Mutex::new(inhibitor),
            worker: Mutex::new(None),
        }
    }

    fn commands(&self) -> Result<mpsc::Sender<Command>, CoreError> {
        let mut worker = self.worker.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(worker) = worker.as_ref() {
            return Ok(worker.commands.clone());
        }
        let Some(inhibitor) = self
            .inhibitor
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        else {
            return Err(CoreError::Unavailable {
                what: "keeping the system awake".into(),
            });
        };
        let (commands, receiver) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("semaphore-keep-awake".into())
            .spawn(move || run(inhibitor, receiver))
            .map_err(|error| CoreError::Failed {
                message: format!("couldn't start the keep-awake thread: {error}"),
            })?;
        *worker = Some(Worker {
            commands: commands.clone(),
            thread,
        });
        Ok(commands)
    }
}

/// The keep-awake thread: owns the hold until told otherwise, or until the owner goes.
fn run(mut inhibitor: Box<dyn Inhibit>, commands: mpsc::Receiver<Command>) {
    let mut hold: Option<Box<dyn Send>> = None;
    while let Ok(Command::Set(on, answer)) = commands.recv() {
        let result = match (on, hold.is_some()) {
            (true, true) | (false, false) => Ok(()),
            (true, false) => inhibitor.acquire().map(|taken| hold = Some(taken)),
            (false, true) => {
                hold = None;
                Ok(())
            }
        };
        let _ = answer.send(result);
    }
    drop(hold);
}

impl KeepAwake for DesktopKeepAwake {
    fn set(&self, on: bool) -> Result<(), CoreError> {
        let commands = match self.commands() {
            Ok(commands) => commands,
            // Nothing is held, so there is nothing to let go of.
            Err(_) if !on => return Ok(()),
            Err(error) => return Err(error),
        };
        let (answer, answered) = mpsc::channel();
        let gone = || CoreError::Failed {
            message: "the keep-awake thread stopped".into(),
        };
        commands
            .send(Command::Set(on, answer))
            .map_err(|_| gone())?;
        match answered.recv_timeout(ANSWER_WITHIN) {
            Ok(result) => result.map_err(|message| CoreError::Failed { message }),
            Err(mpsc::RecvTimeoutError::Timeout) => Err(CoreError::Failed {
                message: "the system didn't answer in time".into(),
            }),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(gone()),
        }
    }
}

impl Drop for DesktopKeepAwake {
    /// Lets the system sleep again before returning: the thread drops its hold and ends.
    fn drop(&mut self) {
        let worker = self
            .worker
            .get_mut()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        if let Some(Worker { commands, thread }) = worker {
            drop(commands);
            let _ = thread.join();
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::Inhibit;

    pub fn inhibitor() -> Option<Box<dyn Inhibit>> {
        Some(Box::new(Logind))
    }

    struct Logind;

    impl Inhibit for Logind {
        fn acquire(&mut self) -> Result<Box<dyn Send>, String> {
            zbus::block_on(inhibit_idle())
                .map(|fd| Box::new(fd) as Box<dyn Send>)
                .map_err(|error| format!("logind refused to hold off sleep: {error}"))
        }
    }

    /// The descriptor is ours once received; the bus connection can go.
    async fn inhibit_idle() -> zbus::Result<zbus::zvariant::OwnedFd> {
        let connection = zbus::Connection::system().await?;
        let reply = connection
            .call_method(
                Some("org.freedesktop.login1"),
                "/org/freedesktop/login1",
                Some("org.freedesktop.login1.Manager"),
                "Inhibit",
                &("idle", "Semaphore", "In a call", "block"),
            )
            .await?;
        reply.body().deserialize::<zbus::zvariant::OwnedFd>()
    }
}

#[cfg(windows)]
mod platform {
    use super::Inhibit;
    use windows_sys::Win32::System::Power::{
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
    };

    pub fn inhibitor() -> Option<Box<dyn Inhibit>> {
        Some(Box::new(ExecutionState))
    }

    struct ExecutionState;

    /// Clears the state, on the thread that set it: the keep-awake thread drops it.
    struct Release;

    impl Drop for Release {
        fn drop(&mut self) {
            // SAFETY: no pointers; it only changes this thread's execution state.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        }
    }

    impl Inhibit for ExecutionState {
        fn acquire(&mut self) -> Result<Box<dyn Send>, String> {
            // SAFETY: as above.
            let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
            if previous == 0 {
                return Err("Windows refused to hold off sleep".into());
            }
            Ok(Box::new(Release))
        }
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    pub fn inhibitor() -> Option<Box<dyn super::Inhibit>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A hold that counts its release.
    struct CountingHold(Arc<AtomicUsize>);

    impl Drop for CountingHold {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Never touches the session: counts what it was asked for.
    #[derive(Clone, Default)]
    struct Fake {
        acquired: Arc<AtomicUsize>,
        released: Arc<AtomicUsize>,
        refuse: bool,
        thread: Arc<Mutex<Vec<String>>>,
    }

    impl Inhibit for Fake {
        fn acquire(&mut self) -> Result<Box<dyn Send>, String> {
            self.thread
                .lock()
                .unwrap()
                .push(std::thread::current().name().unwrap_or_default().to_owned());
            if self.refuse {
                return Err("no logind here".into());
            }
            self.acquired.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(CountingHold(self.released.clone())))
        }
    }

    #[test]
    fn on_holds_once_and_off_releases() {
        let fake = Fake::default();
        let keep = DesktopKeepAwake::with_inhibitor(fake.clone());
        keep.set(true).unwrap();
        keep.set(true).unwrap();
        assert_eq!(fake.acquired.load(Ordering::SeqCst), 1);
        assert_eq!(fake.released.load(Ordering::SeqCst), 0);
        keep.set(false).unwrap();
        keep.set(false).unwrap();
        assert_eq!(fake.released.load(Ordering::SeqCst), 1);
        keep.set(true).unwrap();
        assert_eq!(fake.acquired.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn the_hold_is_taken_on_its_own_thread() {
        let fake = Fake::default();
        let keep = DesktopKeepAwake::with_inhibitor(fake.clone());
        keep.set(true).unwrap();
        assert_eq!(*fake.thread.lock().unwrap(), vec!["semaphore-keep-awake"]);
    }

    #[test]
    fn a_refusal_says_why_and_holds_nothing() {
        let fake = Fake {
            refuse: true,
            ..Fake::default()
        };
        let keep = DesktopKeepAwake::with_inhibitor(fake.clone());
        let error = keep.set(true).unwrap_err();
        assert_eq!(
            error,
            CoreError::Failed {
                message: "no logind here".into()
            }
        );
        keep.set(false).unwrap();
        assert_eq!(fake.released.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn dropping_it_releases_the_hold() {
        let fake = Fake::default();
        let keep = DesktopKeepAwake::with_inhibitor(fake.clone());
        keep.set(true).unwrap();
        drop(keep);
        assert_eq!(fake.released.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn off_before_any_on_starts_nothing() {
        let keep = DesktopKeepAwake::with_inhibitor_opt(None);
        keep.set(false).unwrap();
        assert!(matches!(keep.set(true), Err(CoreError::Unavailable { .. })));
    }

    #[test]
    fn it_works_from_inside_a_tokio_runtime() {
        let fake = Fake::default();
        let keep = Arc::new(DesktopKeepAwake::with_inhibitor(fake.clone()));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let inside = keep.clone();
        runtime.block_on(async move { inside.set(true) }).unwrap();
        assert_eq!(fake.acquired.load(Ordering::SeqCst), 1);
    }
}
