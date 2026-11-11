//! The OS saying it's about to sleep, has woken, or changed network, for `Core::suspend`, `resume`
//! and `network_changed`.
//!
//! - **Linux:** logind's `PrepareForSleep` and NetworkManager's `StateChanged`, on the system bus.
//!   Where logind isn't there, a check that compares the boot clock with the monotonic one, which
//!   stops during sleep, finds a sleep after the fact.
//! - **Windows:** `PowerRegisterSuspendResumeNotification` and `NotifyIpInterfaceChange`, with
//!   `GetNetworkConnectivityHint` saying whether any network is left.
//! - **Anything else:** nothing; the socket's own ping timeout still notices a dead connection.
//!
//! **Threads.** D-Bus runs on a thread of its own, through zbus's async-io `block_on`, never on a
//! Tokio worker: zbus 5 here must not have the `tokio` feature (`scripts/check-zbus-tokio.sh`).
//! Windows calls back on its own threads. Either way the sink is called on a thread that isn't the
//! UI's and mustn't block it: hand the event to a runtime and return.

use semaphore_core::NetworkState;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsEvent {
    /// About to sleep. On Linux without logind, and when the OS gives no warning, this arrives
    /// just before `Resumed`, after the fact.
    Suspending,
    Resumed,
    Network(NetworkState),
}

pub type OsEventSink = Arc<dyn Fn(OsEvent) + Send + Sync>;

/// Keeps the OS registrations for as long as it lives. The Linux listener is a thread blocked on
/// the bus, which ends with the process.
pub struct OsWatcher {
    #[cfg(windows)]
    _windows: Option<windows::Registrations>,
}

/// Starts listening. Never fails: what isn't available is logged and left out.
pub fn watch(sink: OsEventSink) -> OsWatcher {
    #[cfg(target_os = "linux")]
    linux::start(sink);
    #[cfg(windows)]
    return OsWatcher {
        _windows: windows::start(sink),
    };
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = sink;
        log::info!("no OS sleep or network notifications on this platform");
    }
    #[cfg(not(windows))]
    OsWatcher {}
}

/// NetworkManager's `NMState`, as far as a chat client cares: `None` for the states in between.
pub fn network_from_nm_state(state: u32) -> Option<NetworkState> {
    match state {
        // CONNECTED_LOCAL, CONNECTED_SITE, CONNECTED_GLOBAL. A self-hosted server is often on the
        // local network, so local connectivity counts.
        50 | 60 | 70 => Some(NetworkState::Available),
        // ASLEEP, DISCONNECTED.
        10 | 20 => Some(NetworkState::Unavailable),
        // UNKNOWN, DISCONNECTING, CONNECTING.
        _ => None,
    }
}

/// How much longer the boot clock ran than the monotonic one between two samples, past which the
/// machine slept. Both are sampled on one thread, so scheduling alone stays far below this.
pub const SLEEP_GAP_MS: i64 = 2_000;

/// Whether the clocks' difference moved enough between samples to mean a sleep.
pub fn slept_between(before_ms: i64, after_ms: i64) -> bool {
    after_ms - before_ms > SLEEP_GAP_MS
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{OsEvent, OsEventSink, network_from_nm_state, slept_between};
    use futures_util::StreamExt as _;
    use std::time::Duration;
    use zbus::message::Type;
    use zbus::{Connection, MatchRule, MessageStream};

    /// How often the fallback compares the clocks.
    const JUMP_CHECK_EVERY: Duration = Duration::from_secs(5);

    pub fn start(sink: OsEventSink) {
        let spawned = std::thread::Builder::new()
            .name("semaphore-os".into())
            .spawn(move || {
                let logind = zbus::block_on(listen(sink.clone()));
                match logind {
                    Ok(true) => log::info!("the system bus went away; sleep detection falls back"),
                    Ok(false) => log::info!("no logind; sleep detection uses the clocks"),
                    Err(error) => {
                        log::info!("no system bus ({error}); sleep detection uses the clocks")
                    }
                }
                jump_check(&sink);
            });
        if let Err(error) = spawned {
            log::warn!("cannot start the OS event thread: {error}");
        }
    }

    fn signal(
        sender: &str,
        path: &str,
        interface: &str,
        member: &str,
    ) -> zbus::Result<MatchRule<'static>> {
        Ok(MatchRule::builder()
            .msg_type(Type::Signal)
            .sender(sender.to_owned())?
            .path(path.to_owned())?
            .interface(interface.to_owned())?
            .member(member.to_owned())?
            .build())
    }

    /// Listens until the bus goes away. `Ok(false)` straight away if logind isn't running.
    async fn listen(sink: OsEventSink) -> zbus::Result<bool> {
        let connection = Connection::system().await?;
        let reply = connection
            .call_method(
                Some("org.freedesktop.DBus"),
                "/org/freedesktop/DBus",
                Some("org.freedesktop.DBus"),
                "NameHasOwner",
                &("org.freedesktop.login1"),
            )
            .await?;
        let has_logind: bool = reply.body().deserialize()?;
        let sleep = MessageStream::for_match_rule(
            signal(
                "org.freedesktop.login1",
                "/org/freedesktop/login1",
                "org.freedesktop.login1.Manager",
                "PrepareForSleep",
            )?,
            &connection,
            Some(16),
        )
        .await?;
        // NetworkManager may well be absent (iwd, systemd-networkd): then this never fires, and the
        // socket's ping timeout notices a network that went away.
        let network = MessageStream::for_match_rule(
            signal(
                "org.freedesktop.NetworkManager",
                "/org/freedesktop/NetworkManager",
                "org.freedesktop.NetworkManager",
                "StateChanged",
            )?,
            &connection,
            Some(16),
        )
        .await?;
        if !has_logind {
            // Network events still matter; sleep comes from the clocks on another thread.
            let clocks = sink.clone();
            std::thread::Builder::new()
                .name("semaphore-clocks".into())
                .spawn(move || jump_check(&clocks))
                .ok();
        }
        let sleeping = sleep.for_each(|message| {
            let sink = sink.clone();
            async move {
                match message.and_then(|message| message.body().deserialize::<bool>()) {
                    Ok(true) => sink(OsEvent::Suspending),
                    Ok(false) => sink(OsEvent::Resumed),
                    Err(error) => log::debug!("an unreadable PrepareForSleep: {error}"),
                }
            }
        });
        let networking = network.for_each(|message| {
            let sink = sink.clone();
            async move {
                match message.and_then(|message| message.body().deserialize::<u32>()) {
                    Ok(state) => {
                        if let Some(network) = network_from_nm_state(state) {
                            sink(OsEvent::Network(network));
                        }
                    }
                    Err(error) => log::debug!("an unreadable StateChanged: {error}"),
                }
            }
        });
        futures_util::future::join(sleeping, networking).await;
        Ok(has_logind)
    }

    /// The boot clock minus the monotonic one: it grows by however long the machine slept.
    fn asleep_so_far_ms() -> i64 {
        fn read(clock: libc::clockid_t) -> i64 {
            let mut time = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            // SAFETY: `time` is a valid timespec for the call to fill in.
            unsafe { libc::clock_gettime(clock, &mut time) };
            time.tv_sec * 1000 + time.tv_nsec / 1_000_000
        }
        read(libc::CLOCK_BOOTTIME) - read(libc::CLOCK_MONOTONIC)
    }

    /// Samples the clocks at an interval for the life of the process. A periodic sample, not a
    /// wait: the OS offered nothing to wait on.
    fn jump_check(sink: &OsEventSink) {
        let mut before = asleep_so_far_ms();
        loop {
            std::thread::sleep(JUMP_CHECK_EVERY);
            let after = asleep_so_far_ms();
            if slept_between(before, after) {
                log::info!("woke after about {} s asleep", (after - before) / 1000);
                sink(OsEvent::Suspending);
                sink(OsEvent::Resumed);
            }
            before = after;
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::{OsEvent, OsEventSink};
    use semaphore_core::NetworkState;
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        CancelMibChangeNotify2, GetNetworkConnectivityHint, MIB_IPINTERFACE_ROW,
        MIB_NOTIFICATION_TYPE, NotifyIpInterfaceChange,
    };
    use windows_sys::Win32::Networking::WinSock::{
        AF_UNSPEC, NL_NETWORK_CONNECTIVITY_HINT, NetworkConnectivityLevelHintNone,
    };
    use windows_sys::Win32::System::Power::{
        DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, PowerRegisterSuspendResumeNotification,
        PowerUnregisterSuspendResumeNotification,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, PBT_APMSUSPEND,
    };

    /// What the callbacks get as their context: owned here, freed after unregistering.
    struct Context {
        sink: OsEventSink,
    }

    pub struct Registrations {
        context: *mut Context,
        /// Must stay where it is while registered: Windows keeps the pointer.
        parameters: *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
        power: *mut c_void,
        network: HANDLE,
    }

    // SAFETY: the pointers are only handed back to Windows to unregister, on drop.
    unsafe impl Send for Registrations {}

    impl Drop for Registrations {
        fn drop(&mut self) {
            // SAFETY: each handle came from its registration call; after unregistering nothing
            // calls back, so the context and parameters can go.
            unsafe {
                if !self.power.is_null() {
                    PowerUnregisterSuspendResumeNotification(self.power as isize);
                }
                if !self.network.is_null() {
                    CancelMibChangeNotify2(self.network);
                }
                drop(Box::from_raw(self.parameters));
                drop(Box::from_raw(self.context));
            }
        }
    }

    unsafe extern "system" fn on_power(context: *const c_void, kind: u32, _: *const c_void) -> u32 {
        // SAFETY: the context is the `Context` registered with this callback, alive until it's
        // unregistered.
        let context = unsafe { &*(context as *const Context) };
        match kind {
            PBT_APMSUSPEND => (context.sink)(OsEvent::Suspending),
            // Automatic comes on every resume; Suspend only when a user is there. Core ignores a
            // second resume.
            PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => (context.sink)(OsEvent::Resumed),
            _ => {}
        }
        ERROR_SUCCESS
    }

    unsafe extern "system" fn on_interface(
        context: *const c_void,
        _: *const MIB_IPINTERFACE_ROW,
        _: MIB_NOTIFICATION_TYPE,
    ) {
        // SAFETY: as for `on_power`.
        let context = unsafe { &*(context as *const Context) };
        (context.sink)(OsEvent::Network(connectivity()));
    }

    /// Whether any network is left, by Windows' own judgement (Windows 10 2004 and later). Unknown
    /// reads as available: then the socket finds out for itself.
    fn connectivity() -> NetworkState {
        let mut hint = NL_NETWORK_CONNECTIVITY_HINT::default();
        // SAFETY: `hint` is a valid struct for the call to fill in.
        let read = unsafe { GetNetworkConnectivityHint(&mut hint) };
        if read == ERROR_SUCCESS && hint.ConnectivityLevel == NetworkConnectivityLevelHintNone {
            NetworkState::Unavailable
        } else {
            NetworkState::Available
        }
    }

    pub fn start(sink: OsEventSink) -> Option<Registrations> {
        let context = Box::into_raw(Box::new(Context { sink }));
        let parameters = Box::into_raw(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_power),
            Context: context as *mut c_void,
        }));
        let mut power: *mut c_void = std::ptr::null_mut();
        // SAFETY: `parameters` stays allocated until `Registrations` unregisters it.
        let registered = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                parameters as HANDLE,
                &mut power,
            )
        };
        if registered != ERROR_SUCCESS {
            log::warn!(
                "no sleep notifications: PowerRegisterSuspendResumeNotification {registered}"
            );
            power = std::ptr::null_mut();
        }
        let mut network: HANDLE = std::ptr::null_mut();
        // SAFETY: the context outlives the registration, as above.
        let registered = unsafe {
            NotifyIpInterfaceChange(
                AF_UNSPEC,
                Some(on_interface),
                context as *const c_void,
                false,
                &mut network,
            )
        };
        if registered != ERROR_SUCCESS {
            log::warn!("no network notifications: NotifyIpInterfaceChange {registered}");
            network = std::ptr::null_mut();
        }
        Some(Registrations {
            context,
            parameters,
            power,
            network,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_manager_states_map_to_what_core_needs() {
        assert_eq!(network_from_nm_state(70), Some(NetworkState::Available));
        assert_eq!(network_from_nm_state(50), Some(NetworkState::Available));
        assert_eq!(network_from_nm_state(20), Some(NetworkState::Unavailable));
        assert_eq!(network_from_nm_state(10), Some(NetworkState::Unavailable));
        for between in [0, 30, 40] {
            assert_eq!(network_from_nm_state(between), None);
        }
    }

    #[test]
    fn only_a_real_gap_between_the_clocks_is_a_sleep() {
        assert!(!slept_between(1_000, 1_000));
        assert!(!slept_between(1_000, 1_000 + SLEEP_GAP_MS));
        assert!(slept_between(1_000, 1_001 + SLEEP_GAP_MS));
    }
}
