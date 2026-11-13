//! One running app per user: a second launch hands its links (and its activation token, so the
//! first may take focus on Wayland) to the first, then exits. Electron's `requestSingleInstanceLock`.
//!
//! - **Linux:** a lock file held with `flock` for the primary's lifetime (the kernel drops it when
//!   the process dies, so it's never stale), and a Unix socket beside it, in a 0700 directory under
//!   `$XDG_RUNTIME_DIR`. A connection from another user is refused.
//! - **Windows:** a named mutex in the session's namespace, and a named pipe that refuses remote
//!   clients. The second launch lets the first take the foreground before it sends.
//!
//! The message is one line of JSON, at most [`MAX_MESSAGE`] bytes, answered with `ok`. Whatever
//! arrives is still untrusted: links are only prefix-checked here and parsed by the app.
//!
//! **Handing over to an updated build** (Linux): [`PrimaryInstance::serve`] returns a
//! [`ServingInstance`] the app keeps; [`ServingInstance::release`] stops the listener, removes the
//! socket and unlocks, in that order, and returns once all three are done. The new build is started
//! with `--after-update` *before* the old one shuts down, and calls [`acquire_after_update`]: it
//! waits on the lock itself (never forwarding to the app that is about to go away), so it becomes
//! the primary the moment the old one releases, whatever the timing. If it can't be started at
//! all, the old app simply keeps running.

use crate::links;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// What a second launch hands over.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Forward {
    #[serde(default)]
    pub urls: Vec<String>,
    /// Wayland's `XDG_ACTIVATION_TOKEN` (or X11's `DESKTOP_STARTUP_ID`), which lets the primary
    /// take focus for the launch.
    #[serde(default)]
    pub activation_token: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Message {
    v: u32,
    #[serde(flatten)]
    forward: Forward,
}

const VERSION: u32 = 1;
/// Longer is garbage.
pub const MAX_MESSAGE: usize = 32 * 1024;
const MAX_TOKEN: usize = 512;
/// How long a second launch keeps trying to reach a primary that holds the lock but hasn't
/// listened yet, and how long either side waits on the other once connected.
const PATIENCE: Duration = Duration::from_secs(3);

impl Forward {
    /// This launch's links and activation token, from its arguments and environment.
    pub fn from_launch<S: AsRef<str>>(args: &[S]) -> Self {
        let activation_token = std::env::var("XDG_ACTIVATION_TOKEN")
            .ok()
            .or_else(|| std::env::var("DESKTOP_STARTUP_ID").ok())
            .filter(|token| !token.is_empty());
        Self {
            urls: links::from_args(args),
            activation_token,
        }
    }

    /// Drops what no honest launch sends: links that aren't candidates, a token that isn't a short
    /// printable string.
    fn sanitized(self) -> Self {
        Self {
            urls: links::from_args(&self.urls),
            activation_token: self.activation_token.filter(|token| {
                !token.is_empty()
                    && token.len() <= MAX_TOKEN
                    && token.bytes().all(|byte| byte.is_ascii_graphic())
            }),
        }
    }
}

/// Reads one message line; `None` for anything malformed, oversized or from another version.
fn read_message(stream: impl Read) -> Option<Forward> {
    let mut line = Vec::new();
    BufReader::new(stream.take(MAX_MESSAGE as u64 + 1))
        .read_until(b'\n', &mut line)
        .ok()?;
    if line.len() > MAX_MESSAGE || line.last() != Some(&b'\n') {
        return None;
    }
    let message: Message = serde_json::from_slice(&line).ok()?;
    (message.v == VERSION).then(|| message.forward.sanitized())
}

fn encode(forward: &Forward) -> Vec<u8> {
    let mut line = serde_json::to_vec(&Message {
        v: VERSION,
        forward: forward.clone(),
    })
    .expect("a Forward serializes");
    line.push(b'\n');
    line
}

/// Sends `forward` and waits for the primary's `ok`.
fn exchange(mut stream: impl Read + Write, forward: &Forward) -> io::Result<()> {
    stream.write_all(&encode(forward))?;
    stream.flush()?;
    let mut reply = [0u8; 3];
    stream.read_exact(&mut reply)?;
    if &reply == b"ok\n" {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "the running app didn't answer ok",
        ))
    }
}

/// Serves one connection: read, answer, hand over. Malformed input is dropped with a log.
fn serve_one(mut stream: impl Read + Write, on_forward: &(dyn Fn(Forward) + Send + Sync)) {
    let Some(forward) = read_message(&mut stream) else {
        log::warn!("single instance: dropped a malformed message from a second launch");
        return;
    };
    let _ = stream.write_all(b"ok\n");
    let _ = stream.flush();
    on_forward(forward);
}

/// Whether this process is the one that runs.
pub enum Instance {
    /// Keep it for the app's lifetime and [`PrimaryInstance::serve`] it.
    Primary(PrimaryInstance),
    /// Another instance has the links now; exit.
    Forwarded,
}

/// The directory for the lock and socket: `$XDG_RUNTIME_DIR/semaphore` (only this user's, and
/// cleared at logout), else under the data directory. Unused on Windows except as a name.
pub fn default_dir(data_dir: &Path) -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .map_or_else(|| data_dir.join("run"), |dir| dir.join("semaphore"))
}

/// Becomes the primary, or forwards `forward` to the one there is.
pub fn acquire(dir: &Path, forward: &Forward) -> io::Result<Instance> {
    platform::acquire(dir, forward)
}

pub use platform::{PrimaryInstance, ServingInstance};

/// For the process an update starts (`--after-update`): waits up to `patience` for the lock the
/// previous app holds until it has shut down, then becomes the primary. Never forwards: the app
/// holding the lock now is the one going away. `ErrorKind::TimedOut` when it never let go.
#[cfg(unix)]
pub fn acquire_after_update(dir: &Path, patience: Duration) -> io::Result<PrimaryInstance> {
    platform::acquire_after_update(dir, patience)
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::fs::{File, OpenOptions, TryLockError};
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    pub struct PrimaryInstance {
        listener: UnixListener,
        socket: PathBuf,
        _lock: File,
    }

    fn socket_path(dir: &Path) -> PathBuf {
        dir.join("instance.sock")
    }

    /// The private directory and the lock file in it, not yet locked.
    fn open_lock(dir: &Path) -> io::Result<File> {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
        // An existing directory may have been made with a looser mode.
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(dir.join("instance.lock"))
    }

    /// With `lock` held: listen.
    fn become_primary(dir: &Path, lock: File) -> io::Result<PrimaryInstance> {
        let socket = socket_path(dir);
        // Holding the lock means any socket file is a dead (or departed) primary's.
        match std::fs::remove_file(&socket) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
        let listener = UnixListener::bind(&socket)?;
        std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
        Ok(PrimaryInstance {
            listener,
            socket,
            _lock: lock,
        })
    }

    pub fn acquire_after_update(dir: &Path, patience: Duration) -> io::Result<PrimaryInstance> {
        let lock = open_lock(dir)?;
        // `flock` has no timeout, so a thread blocks on it and this one waits for its answer. The
        // clone shares the open file description, so the lock it takes is `lock`'s.
        let waiting = lock.try_clone()?;
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("instance-handover".into())
            .spawn(move || {
                let _ = sender.send(waiting.lock());
            })?;
        match receiver.recv_timeout(patience) {
            Ok(Ok(())) => become_primary(dir, lock),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "the previous app still holds the single-instance lock",
            )),
        }
    }

    pub fn acquire(dir: &Path, forward: &Forward) -> io::Result<Instance> {
        let lock = open_lock(dir)?;
        let socket = socket_path(dir);
        match lock.try_lock() {
            Ok(()) => Ok(Instance::Primary(become_primary(dir, lock)?)),
            Err(TryLockError::WouldBlock) => {
                // The primary may hold the lock a moment before it listens.
                let deadline = Instant::now() + PATIENCE;
                let stream = loop {
                    match UnixStream::connect(&socket) {
                        Ok(stream) => break stream,
                        Err(error) if Instant::now() >= deadline => return Err(error),
                        Err(_) => std::thread::sleep(Duration::from_millis(20)),
                    }
                };
                stream.set_read_timeout(Some(PATIENCE))?;
                stream.set_write_timeout(Some(PATIENCE))?;
                exchange(stream, forward)?;
                Ok(Instance::Forwarded)
            }
            Err(TryLockError::Error(error)) => Err(error),
        }
    }

    #[cfg(target_os = "linux")]
    fn same_user(stream: &UnixStream) -> bool {
        use std::os::fd::AsRawFd;
        let mut cred = libc::ucred {
            pid: 0,
            uid: u32::MAX,
            gid: 0,
        };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: `cred` and `len` describe a `ucred`-sized buffer.
        let status = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut cred as *mut libc::ucred).cast(),
                &mut len,
            )
        };
        // SAFETY: no arguments.
        status == 0 && cred.uid == unsafe { libc::getuid() }
    }

    #[cfg(not(target_os = "linux"))]
    fn same_user(_: &UnixStream) -> bool {
        // The directory is the user's own (0700).
        true
    }

    impl PrimaryInstance {
        /// Answers second launches on a thread of its own until the returned [`ServingInstance`]
        /// is released or dropped: keep it for the app's lifetime. `on_forward` runs on that
        /// thread and mustn't block.
        pub fn serve(
            self,
            on_forward: impl Fn(Forward) + Send + Sync + 'static,
        ) -> ServingInstance {
            let stop = Arc::new(AtomicBool::new(false));
            // The thread accepts on a second descriptor of the same socket; this one stays here
            // to shut it down.
            let thread = match self.listener.try_clone() {
                Ok(listener) => {
                    let stopping = stop.clone();
                    std::thread::Builder::new()
                        .name("single-instance".into())
                        .spawn(move || {
                            for stream in listener.incoming() {
                                if stopping.load(Ordering::Acquire) {
                                    return;
                                }
                                let Ok(stream) = stream else { continue };
                                if !same_user(&stream) {
                                    log::warn!(
                                        "single instance: refused a connection from another user"
                                    );
                                    continue;
                                }
                                let _ = stream.set_read_timeout(Some(PATIENCE));
                                let _ = stream.set_write_timeout(Some(PATIENCE));
                                serve_one(stream, &on_forward);
                            }
                        })
                }
                Err(error) => Err(error),
            };
            let thread = match thread {
                Ok(thread) => Some(thread),
                Err(error) => {
                    log::warn!("single instance: cannot start its listener: {error}");
                    None
                }
            };
            ServingInstance {
                primary: Some(self),
                stop,
                thread,
            }
        }
    }

    /// A primary that is answering. Holds the lock until [`ServingInstance::release`] or drop.
    #[must_use = "dropping it releases the single-instance lock"]
    pub struct ServingInstance {
        primary: Option<PrimaryInstance>,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl ServingInstance {
        /// Stops answering, removes the socket, then unlocks; returns when all three are done.
        /// From here on a launch (the updated build waiting with `--after-update`) becomes the
        /// primary.
        pub fn release(mut self) {
            self.release_now();
        }

        fn release_now(&mut self) {
            let Some(primary) = self.primary.take() else {
                return;
            };
            self.stop.store(true, Ordering::Release);
            if let Some(thread) = self.thread.take() {
                // Wake the thread's `accept`: Linux fails it on a shut-down listener; elsewhere a
                // connection of our own does it. The thread sees `stop` and returns.
                #[cfg(target_os = "linux")]
                {
                    use std::os::fd::AsRawFd as _;
                    // SAFETY: the listening socket `primary` owns, open until it drops below.
                    unsafe { libc::shutdown(primary.listener.as_raw_fd(), libc::SHUT_RDWR) };
                }
                let _ = UnixStream::connect(&primary.socket);
                let _ = thread.join();
            }
            // Removes the socket, then closes the lock file, which drops the `flock`.
            drop(primary);
        }
    }

    impl Drop for ServingInstance {
        fn drop(&mut self) {
            self.release_now();
        }
    }

    impl Drop for PrimaryInstance {
        fn drop(&mut self) {
            // The lock file closes after this, as a field: the socket is gone before anyone else
            // can take the lock and bind it.
            let _ = std::fs::remove_file(&self.socket);
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_ALREADY_EXISTS, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, GENERIC_READ,
        GENERIC_WRITE, GetLastError, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
    };
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeServerProcessId, PIPE_READMODE_BYTE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
        WaitNamedPipeW,
    };
    use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows_sys::Win32::System::Threading::{CreateMutexW, GetCurrentProcessId};
    use windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

    pub struct PrimaryInstance {
        mutex: HANDLE,
        first_pipe: Option<OwnedHandle>,
        pipe_name: Vec<u16>,
    }

    // SAFETY: the handles are kernel objects, usable from any thread.
    unsafe impl Send for PrimaryInstance {}

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    /// Names unique to `dir` and this logon session, so tests in temp dirs don't meet the app.
    fn names(dir: &Path) -> (String, String) {
        // FNV-1a: a stable name, not a secret.
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in dir.to_string_lossy().to_lowercase().bytes() {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
        }
        let mut session = 0u32;
        // SAFETY: an out pointer to a u32.
        unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session) };
        (
            format!(r"Local\{}.instance.{hash:016x}", links::APP_ID),
            format!(r"\\.\pipe\{}.instance.{session}.{hash:016x}", links::APP_ID),
        )
    }

    fn create_pipe(name: &[u16], first: bool) -> io::Result<OwnedHandle> {
        let flags = PIPE_ACCESS_DUPLEX
            | if first {
                FILE_FLAG_FIRST_PIPE_INSTANCE
            } else {
                0
            };
        // SAFETY: a NUL-terminated name; default security (this user, SYSTEM, admins).
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                flags,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                4096,
                4096,
                0,
                std::ptr::null(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a handle we own.
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }

    pub fn acquire(dir: &Path, forward: &Forward) -> io::Result<Instance> {
        let (mutex_name, pipe_name) = names(dir);
        let mutex_w = wide(&mutex_name);
        let pipe_w = wide(&pipe_name);
        // SAFETY: a NUL-terminated name.
        let mutex = unsafe { CreateMutexW(std::ptr::null(), 0, mutex_w.as_ptr()) };
        if mutex.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: no arguments; read straight after the call that set it.
        if unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
            // `FIRST_PIPE_INSTANCE` fails if anyone else made the pipe first: squatting.
            let first_pipe = match create_pipe(&pipe_w, true) {
                Ok(pipe) => pipe,
                Err(error) => {
                    // SAFETY: created above.
                    unsafe { CloseHandle(mutex) };
                    return Err(error);
                }
            };
            return Ok(Instance::Primary(PrimaryInstance {
                mutex,
                first_pipe: Some(first_pipe),
                pipe_name: pipe_w,
            }));
        }
        // SAFETY: ours; the primary keeps its own handle.
        unsafe { CloseHandle(mutex) };
        let deadline = Instant::now() + PATIENCE;
        let file = loop {
            // SAFETY: a NUL-terminated name.
            let handle = unsafe {
                CreateFileW(
                    pipe_w.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    0,
                    std::ptr::null_mut(),
                )
            };
            if handle != INVALID_HANDLE_VALUE {
                // SAFETY: a handle we own.
                break std::fs::File::from(unsafe { OwnedHandle::from_raw_handle(handle) });
            }
            let error = io::Error::last_os_error();
            if Instant::now() >= deadline {
                return Err(error);
            }
            if error.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) {
                // SAFETY: a NUL-terminated name.
                unsafe { WaitNamedPipeW(pipe_w.as_ptr(), 200) };
            } else {
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        let mut server = 0u32;
        use std::os::windows::io::AsRawHandle;
        // SAFETY: a pipe handle and an out pointer.
        if unsafe { GetNamedPipeServerProcessId(file.as_raw_handle() as HANDLE, &mut server) } != 0
        {
            // SAFETY: plain call. Lets the primary bring its window to the front.
            unsafe { AllowSetForegroundWindow(server) };
        }
        exchange(file, forward)?;
        Ok(Instance::Forwarded)
    }

    impl PrimaryInstance {
        /// Answers second launches on a thread of its own; the mutex is held until the returned
        /// [`ServingInstance`] is released or dropped. (The pipe thread lives for the process:
        /// Windows never hands over to an updated build.)
        pub fn serve(
            mut self,
            on_forward: impl Fn(Forward) + Send + Sync + 'static,
        ) -> ServingInstance {
            let serving = ServingInstance {
                mutex: std::mem::replace(&mut self.mutex, std::ptr::null_mut()),
            };
            let on_forward = std::sync::Arc::new(on_forward);
            let spawned = std::thread::Builder::new()
                .name("single-instance".into())
                .spawn(move || {
                    let mut next = self.first_pipe.take();
                    loop {
                        let pipe = match next.take() {
                            Some(pipe) => pipe,
                            None => match create_pipe(&self.pipe_name, false) {
                                Ok(pipe) => pipe,
                                Err(error) => {
                                    log::warn!("single instance: pipe failed: {error}");
                                    return;
                                }
                            },
                        };
                        use std::os::windows::io::AsRawHandle;
                        // SAFETY: a pipe handle we own; blocks until a client connects.
                        let connected = unsafe {
                            ConnectNamedPipe(pipe.as_raw_handle() as HANDLE, std::ptr::null_mut())
                        } != 0
                            || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
                        if !connected {
                            continue;
                        }
                        // One connection at a time can't stall the next: each is served apart.
                        let on_forward = on_forward.clone();
                        let _ = std::thread::Builder::new()
                            .name("single-instance-client".into())
                            .spawn(move || serve_one(std::fs::File::from(pipe), &*on_forward));
                    }
                });
            if let Err(error) = spawned {
                log::warn!("single instance: cannot start its listener: {error}");
            }
            serving
        }
    }

    impl Drop for PrimaryInstance {
        fn drop(&mut self) {
            if !self.mutex.is_null() {
                // SAFETY: created in `acquire`, not yet handed to a `ServingInstance`.
                unsafe { CloseHandle(self.mutex) };
            }
        }
    }

    /// A primary that is answering. Holds the mutex until released or dropped.
    #[must_use = "dropping it releases the single-instance mutex"]
    pub struct ServingInstance {
        mutex: HANDLE,
    }

    // SAFETY: a kernel object handle, usable from any thread.
    unsafe impl Send for ServingInstance {}

    impl ServingInstance {
        /// Closes the mutex.
        pub fn release(self) {}
    }

    impl Drop for ServingInstance {
        fn drop(&mut self) {
            if !self.mutex.is_null() {
                // SAFETY: created in `acquire`; closed only here.
                unsafe { CloseHandle(self.mutex) };
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("semaphore-instance-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn forward(urls: &[&str], token: Option<&str>) -> Forward {
        Forward {
            urls: urls.iter().map(|url| (*url).to_owned()).collect(),
            activation_token: token.map(str::to_owned),
        }
    }

    fn primary(dir: &Path) -> PrimaryInstance {
        let Instance::Primary(primary) = acquire(dir, &Forward::default()).unwrap() else {
            panic!("expected to be the primary");
        };
        primary
    }

    #[test]
    fn a_second_launch_forwards_its_links_and_token_to_the_first() {
        let dir = temp_dir("forward");
        let (sender, receiver) = mpsc::channel();
        let _serving = primary(&dir).serve(move |forward| sender.send(forward).unwrap());

        let sent = forward(&["semaphore://direct-messages"], Some("token-123"));
        assert!(matches!(acquire(&dir, &sent).unwrap(), Instance::Forwarded));
        assert_eq!(receiver.recv_timeout(PATIENCE).unwrap(), sent);

        // A plain relaunch forwards nothing but still reaches it (the app shows its window).
        assert!(matches!(
            acquire(&dir, &Forward::default()).unwrap(),
            Instance::Forwarded
        ));
        assert_eq!(receiver.recv_timeout(PATIENCE).unwrap(), Forward::default());
    }

    #[test]
    fn a_dead_primarys_socket_is_replaced() {
        let dir = temp_dir("stale");
        std::fs::create_dir_all(&dir).unwrap();
        // A socket file nobody listens on, as a crash leaves it.
        drop(std::os::unix::net::UnixListener::bind(dir.join("instance.sock")).unwrap());
        assert!(dir.join("instance.sock").exists());
        drop(primary(&dir));
        assert!(
            !dir.join("instance.sock").exists(),
            "dropping the primary removes its socket"
        );
        // And the next start is the primary again.
        let _again = primary(&dir);
    }

    #[test]
    fn of_racing_launches_exactly_one_is_primary() {
        let dir = temp_dir("race");
        let results: Vec<_> = (0..6)
            .map(|_| {
                let dir = dir.clone();
                std::thread::spawn(move || acquire(&dir, &Forward::default()))
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        // The losers can't be answered until the primary serves, so here they time out or fail;
        // what matters is that exactly one won the lock.
        let primaries = results
            .iter()
            .filter(|result| matches!(result, Ok(Instance::Primary(_))))
            .count();
        assert_eq!(primaries, 1);
    }

    #[test]
    fn malformed_messages_are_dropped_and_the_server_keeps_going() {
        use std::os::unix::net::UnixStream;
        let dir = temp_dir("malformed");
        let (sender, receiver) = mpsc::channel();
        let _serving = primary(&dir).serve(move |forward| sender.send(forward).unwrap());
        let socket = dir.join("instance.sock");

        for garbage in [
            b"not json\n".to_vec(),
            b"{\"v\":2,\"urls\":[]}\n".to_vec(),
            [
                b"{\"v\":1,\"urls\":[\"".as_slice(),
                &vec![b'a'; MAX_MESSAGE],
                b"\"]}\n",
            ]
            .concat(),
            b"{\"v\":1}".to_vec(), // no newline: the sender hung up mid-message
        ] {
            let mut stream = UnixStream::connect(&socket).unwrap();
            let _ = stream.write_all(&garbage);
            let _ = stream.shutdown(std::net::Shutdown::Write);
            let mut reply = Vec::new();
            let _ = stream.read_to_end(&mut reply);
            assert!(
                reply.is_empty(),
                "no ok for {:?}",
                String::from_utf8_lossy(&garbage[..20.min(garbage.len())])
            );
        }
        assert!(receiver.try_recv().is_err());

        // Hostile but well-formed: non-links and a bad token are stripped, the rest arrives.
        let sent = Forward {
            urls: vec!["https://evil.example".into(), "semaphore://join/abc".into()],
            activation_token: Some("bad token\n".into()),
        };
        assert!(matches!(acquire(&dir, &sent).unwrap(), Instance::Forwarded));
        assert_eq!(
            receiver.recv_timeout(PATIENCE).unwrap(),
            forward(&["semaphore://join/abc"], None)
        );
    }

    /// The update handover: the new build, started while the old app still serves, waits on the
    /// lock instead of forwarding to it, and is the primary as soon as the old one releases.
    /// Later launches then reach the new one.
    #[test]
    fn an_updated_build_waits_for_the_lock_and_takes_over() {
        let dir = temp_dir("handover");
        let (old_sender, old_received) = mpsc::channel();
        let old = primary(&dir).serve(move |forward| old_sender.send(forward).unwrap());

        let (ready_sender, ready) = mpsc::channel();
        let waiting = {
            let dir = dir.clone();
            std::thread::spawn(move || {
                let result = acquire_after_update(&dir, Duration::from_secs(30));
                ready_sender.send(()).unwrap();
                result
            })
        };
        // While the old app serves, the new one is still waiting: a plain launch still reaches
        // the old app, and the waiting one has sent it nothing.
        assert!(matches!(
            acquire(&dir, &forward(&["semaphore://join/a"], None)).unwrap(),
            Instance::Forwarded
        ));
        assert_eq!(
            old_received.recv_timeout(PATIENCE).unwrap(),
            forward(&["semaphore://join/a"], None)
        );
        assert!(
            ready.try_recv().is_err(),
            "it took over while the old app held the lock"
        );

        old.release();
        let new = waiting
            .join()
            .unwrap()
            .expect("the new build became the primary");
        assert!(
            old_received.try_recv().is_err(),
            "the new build forwarded nothing"
        );

        let (new_sender, new_received) = mpsc::channel();
        let _new = new.serve(move |forward| new_sender.send(forward).unwrap());
        assert!(matches!(
            acquire(&dir, &forward(&["semaphore://join/b"], None)).unwrap(),
            Instance::Forwarded
        ));
        assert_eq!(
            new_received.recv_timeout(PATIENCE).unwrap(),
            forward(&["semaphore://join/b"], None)
        );
    }

    /// An old app that never lets go: the new build gives up after its patience.
    #[test]
    fn waiting_for_the_lock_times_out() {
        let dir = temp_dir("handover-timeout");
        let _old = primary(&dir).serve(|_| {});
        let error = acquire_after_update(&dir, Duration::from_millis(200))
            .err()
            .expect("the lock is held");
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    /// With no app running, an updated build is the primary at once.
    #[test]
    fn an_updated_build_with_nobody_running_starts_at_once() {
        let dir = temp_dir("handover-free");
        let _new = acquire_after_update(&dir, Duration::from_secs(5)).unwrap();
        assert!(dir.join("instance.sock").exists());
    }

    /// Releasing (or dropping) a serving instance stops its thread, removes the socket and frees
    /// the lock, all before it returns: the next launch is the primary.
    #[test]
    fn releasing_frees_the_lock_and_the_socket_before_returning() {
        let dir = temp_dir("release");
        primary(&dir).serve(|_| {}).release();
        assert!(!dir.join("instance.sock").exists());
        let again = primary(&dir).serve(|_| {});
        drop(again);
        assert!(!dir.join("instance.sock").exists());
        let _third = primary(&dir);
    }

    #[test]
    fn the_directory_and_socket_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("modes");
        let _primary = primary(&dir);
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&dir.join("instance.sock")), 0o600);
    }
}
