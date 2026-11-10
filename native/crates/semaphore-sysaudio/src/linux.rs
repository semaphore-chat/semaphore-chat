//! PipeWire: one capture stream of ours, linked by hand to every app's output stream except our
//! own. PipeWire mixes several links into one input port, so the graph does the mixing on its own
//! clock, and capturing at the stream (not a sink's monitor) means multiple sinks, apps moving
//! between them and per-app volume all just work.
//!
//! **What "ours" means.** A node is ours when its `application.process.id`, or its client's, is our
//! PID. Both libpipewire and the PulseAudio protocol crate cpal uses set that from `getpid()`,
//! so the comparison holds inside a PID namespace (Flatpak) too. `pipewire.sec.pid` can't be used:
//! for PulseAudio clients it is pipewire-pulse's PID, not the app's (measured, T11).
//!
//! **Taint.** Our audio can come back out of another node: an effects chain (module-loopback,
//! filter-chain, EasyEffects) takes it in and plays it out again. Anything downstream of our
//! nodes by link, or in the same `node.link-group` as such a node, is never linked. Game audio
//! that goes through the same chain is lost with it: never echo beats always include.
//!
//! Nothing is linked until both the node's and its client's full properties have arrived, so a
//! new stream of ours is never linked even briefly. Links are `object.linger=false`: they go away
//! with this connection, crash included.

use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::types::ObjectType;
use semaphore_media_livekit::audio::system::{
    CaptureScope, SYSTEM_AUDIO_CHANNELS, SYSTEM_AUDIO_RATE, SystemAudioCallback,
    SystemAudioCapture, SystemAudioSupport,
};
use semaphore_media_livekit::audio::{AudioStream, ErrorCallback};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::rc::{Rc, Weak};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

const NODE_NAME: &str = "semaphore-system-audio";
const STREAM_OUTPUT: &str = "Stream/Output/Audio";
const START_TIMEOUT: Duration = Duration::from_secs(5);

/// The desktop Linux capture. `Default` is the product behaviour.
#[derive(Debug, Clone, Default)]
pub struct PipeWireCapture {
    include_own: bool,
}

impl PipeWireCapture {
    /// T11's negative control only: links our own streams too, which must make the call audible
    /// in the share. Proves the detector would catch a leak. Never use it in the app.
    pub fn negative_control() -> Self {
        Self { include_own: true }
    }
}

impl SystemAudioCapture for PipeWireCapture {
    /// A socket check, not a connection: cheap enough for a settings screen. `start` reports
    /// anything the socket can't tell.
    fn support(&self) -> SystemAudioSupport {
        let socket = std::env::var_os("PIPEWIRE_REMOTE")
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| {
                std::env::var_os("XDG_RUNTIME_DIR")
                    .map(|dir| std::path::Path::new(&dir).join("pipewire-0"))
            });
        match socket {
            Some(path) if path.exists() => SystemAudioSupport::Supported,
            _ => SystemAudioSupport::Unsupported("PipeWire isn't running".into()),
        }
    }

    fn start(
        &self,
        scope: CaptureScope,
        on_audio: SystemAudioCallback,
        on_error: ErrorCallback,
    ) -> Result<AudioStream, String> {
        let CaptureScope::EverythingExceptOurs = scope;
        let include_own = self.include_own;
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (stop_tx, stop_rx) = pw::channel::channel::<()>();
        let thread = std::thread::Builder::new()
            .name("semaphore-sysaudio".into())
            .spawn(move || {
                if let Err(error) = run(include_own, on_audio, on_error, &ready_tx, stop_rx) {
                    let _ = ready_tx.send(Err(error));
                }
            })
            .map_err(|error| error.to_string())?;
        let mut running = Running {
            stop: Some(stop_tx),
            thread: Some(thread),
        };
        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(())) => Ok(AudioStream::new(running)),
            Ok(Err(error)) => Err(error),
            Err(_) => {
                running.stop();
                Err("PipeWire did not answer within 5 s".into())
            }
        }
    }
}

struct Running {
    stop: Option<pw::channel::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
    fn stop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop();
    }
}

/// libwebrtc (inside webrtc-sys) links its own `pw_*` functions: stubs that jump through pointers
/// it fills only when its PipeWire screen capturer starts, and null until then. Our binary gets
/// those stubs, not libpipewire's functions, because webrtc-sys's archive is on the link line
/// ahead of `-lpipewire-0.3` (found by T11: `pw_init` jumped to address 0). So we fill the
/// pointers ourselves, from the libpipewire that is already loaded, through libwebrtc's own
/// initializer. If libwebrtc renames it, the link fails, which is loud and early.
mod webrtc_stubs {
    use std::ffi::c_void;

    unsafe extern "C" {
        /// `void modules_portal::InitializePipewire(void* module)`, from webrtc's generated stubs
        /// (Chromium's generate_stubs.py: it dlsyms every stubbed function from `module`).
        #[link_name = "_ZN14modules_portal18InitializePipewireEPv"]
        fn initialize_pipewire(module: *mut c_void);
        /// `bool modules_portal::IsPipewireInitialized()`.
        #[link_name = "_ZN14modules_portal21IsPipewireInitializedEv"]
        fn is_pipewire_initialized() -> bool;
    }

    pub(super) fn ensure() -> Result<(), String> {
        static DONE: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
        DONE.get_or_init(|| unsafe {
            if is_pipewire_initialized() {
                return Ok(());
            }
            let handle = libc::dlopen(c"libpipewire-0.3.so.0".as_ptr(), libc::RTLD_NOW);
            if handle.is_null() {
                return Err("libpipewire-0.3.so.0 isn't installed".into());
            }
            // The handle stays open for the life of the process, as libpipewire does anyway.
            initialize_pipewire(handle);
            if is_pipewire_initialized() {
                Ok(())
            } else {
                Err("libpipewire lacks a function libwebrtc's stubs need".into())
            }
        })
        .clone()
    }
}

fn err(error: impl std::fmt::Display) -> String {
    format!("PipeWire: {error}")
}

struct CaptureData {
    on_audio: SystemAudioCallback,
    scratch: Vec<f32>,
}

fn run(
    include_own: bool,
    on_audio: SystemAudioCallback,
    on_error: ErrorCallback,
    ready: &mpsc::Sender<Result<(), String>>,
    stop: pw::channel::Receiver<()>,
) -> Result<(), String> {
    webrtc_stubs::ensure()?;
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(err)?;
    let context = pw::context::ContextRc::new(&mainloop, None).map_err(err)?;
    let core = context.connect_rc(None).map_err(err)?;
    let registry = core.get_registry_rc().map_err(err)?;

    let stream = pw::stream::StreamRc::new(
        core.clone(),
        NODE_NAME,
        properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
            *pw::keys::NODE_NAME => NODE_NAME,
            *pw::keys::NODE_DESCRIPTION => "Semaphore screen share audio",
            // We link by hand. Left to the session manager, a capture stream goes to the mic.
            *pw::keys::NODE_AUTOCONNECT => "false",
            *pw::keys::AUDIO_CHANNELS => "2",
            "audio.position" => "FL,FR",
        },
    )
    .map_err(err)?;

    let ctx = Rc::new(Ctx {
        core: core.clone(),
        stream: stream.clone(),
        registry: registry.clone(),
        own_pid: std::process::id().to_string(),
        include_own,
        graph: RefCell::new(Graph::default()),
    });

    let error_sink = on_error.clone();
    let state_ctx = Rc::downgrade(&ctx);
    let _stream_listener = stream
        .add_local_listener_with_user_data(CaptureData {
            on_audio,
            scratch: Vec::with_capacity(8192),
        })
        .state_changed(move |_, _, old, new| {
            log::info!(target: "sysaudio", "stream {old:?} -> {new:?}");
            if let pw::stream::StreamState::Error(message) = &new {
                error_sink(format!("capture stream failed: {message}"));
            }
            if let Some(ctx) = state_ctx.upgrade() {
                reconcile(&ctx);
            }
        })
        .process(|stream, data| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let Some(first) = buffer.datas_mut().first_mut() else {
                return;
            };
            let (offset, size) = (first.chunk().offset() as usize, first.chunk().size() as usize);
            let Some(bytes) = first.data() else {
                return;
            };
            let end = (offset + size).min(bytes.len());
            let bytes = &bytes[offset.min(end)..end];
            data.scratch.clear();
            data.scratch.extend(
                bytes
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
            );
            if !data.scratch.is_empty() {
                (data.on_audio)(&data.scratch);
            }
        })
        .register()
        .map_err(err)?;

    let error_log = on_error.clone();
    let _core_listener = core
        .add_listener_local()
        .error(move |id, seq, res, message| {
            log::warn!(target: "sysaudio", "core error on {id} (seq {seq}): {res} {message}");
            let _ = &error_log;
        })
        .register();

    let global_ctx = Rc::downgrade(&ctx);
    let remove_ctx = Rc::downgrade(&ctx);
    let _registry_listener = registry
        .add_listener_local()
        .global(move |global| {
            if let Some(ctx) = global_ctx.upgrade() {
                on_global(&ctx, global);
            }
        })
        .global_remove(move |id| {
            if let Some(ctx) = remove_ctx.upgrade() {
                on_global_remove(&ctx, id);
            }
        })
        .register();

    let mut format = spa::param::audio::AudioInfoRaw::new();
    format.set_format(spa::param::audio::AudioFormat::F32LE);
    format.set_rate(SYSTEM_AUDIO_RATE);
    format.set_channels(SYSTEM_AUDIO_CHANNELS as u32);
    let mut position = [0u32; spa::sys::SPA_AUDIO_MAX_CHANNELS as usize];
    position[0] = spa::sys::SPA_AUDIO_CHANNEL_FL;
    position[1] = spa::sys::SPA_AUDIO_CHANNEL_FR;
    format.set_position(position);
    let object = spa::pod::Object {
        type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: format.into(),
    };
    let bytes = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(object),
    )
    .map_err(|e| err(format!("{e:?}")))?
    .0
    .into_inner();
    let pod = spa::pod::Pod::from_bytes(&bytes).ok_or_else(|| err("format pod"))?;
    stream
        .connect(
            spa::utils::Direction::Input,
            None,
            pw::stream::StreamFlags::MAP_BUFFERS | pw::stream::StreamFlags::RT_PROCESS,
            &mut [pod],
        )
        .map_err(err)?;

    let quit = mainloop.clone();
    let _stop = stop.attach(mainloop.loop_(), move |()| quit.quit());
    let _ = ready.send(Ok(()));
    mainloop.run();

    // Our links go with their proxies (`object.linger=false`), before the connection closes.
    ctx.graph.borrow_mut().ours.clear();
    let _ = stream.disconnect();
    Ok(())
}

struct Ctx {
    core: pw::core::CoreRc,
    stream: pw::stream::StreamRc,
    registry: pw::registry::RegistryRc,
    own_pid: String,
    include_own: bool,
    graph: RefCell<Graph>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct NodeProps {
    class: String,
    name: String,
    app_pid: Option<String>,
    client: Option<u32>,
    link_group: Option<String>,
}

struct NodeEntry {
    _proxy: pw::node::Node,
    _listener: pw::node::NodeListener,
    props: Option<NodeProps>,
}

struct ClientEntry {
    _proxy: pw::client::Client,
    _listener: pw::client::ClientListener,
    /// `None` until the client's info arrives; then its `application.process.id`, if any.
    app_pid: Option<Option<String>>,
}

#[derive(Debug, Clone)]
struct PortEntry {
    node: u32,
    output: bool,
    channel: String,
    monitor: bool,
}

#[derive(Default)]
struct Graph {
    nodes: HashMap<u32, NodeEntry>,
    clients: HashMap<u32, ClientEntry>,
    ports: HashMap<u32, PortEntry>,
    /// Every link in the graph, as (output node, input node).
    links: HashMap<u32, (u32, u32)>,
    /// The ports of each link, as (output port, input port), to notice when one of ours goes.
    link_ports: HashMap<u32, (u32, u32)>,
    /// Links we made, by (output port, input port). Dropping one removes it.
    ours: HashMap<(u32, u32), (pw::link::Link, pw::link::LinkListener)>,
    /// The last verdict logged per node, so each change is logged once.
    verdicts: HashMap<u32, &'static str>,
}

fn dict_u32(props: &spa::utils::dict::DictRef, key: &str) -> Option<u32> {
    props.get(key).and_then(|value| value.parse().ok())
}

fn on_global(ctx: &Rc<Ctx>, global: &pw::registry::GlobalObject<&spa::utils::dict::DictRef>) {
    let id = global.id;
    match global.type_ {
        ObjectType::Node => {
            let Ok(proxy) = ctx.registry.bind::<pw::node::Node, _>(global) else {
                return;
            };
            let weak: Weak<Ctx> = Rc::downgrade(ctx);
            let listener = proxy
                .add_listener_local()
                .info(move |info| {
                    // An info without the PROPS bit carries an empty dict (state changes do
                    // this all the time), not "no properties". Reading it anyway dropped
                    // media.class and the PID of live streams (T11).
                    if !info.change_mask().contains(pw::node::NodeChangeMask::PROPS) {
                        return;
                    }
                    let (Some(ctx), Some(props)) = (weak.upgrade(), info.props()) else {
                        return;
                    };
                    let mut parsed = NodeProps {
                        class: props.get("media.class").unwrap_or_default().to_owned(),
                        name: props.get("node.name").unwrap_or_default().to_owned(),
                        app_pid: props.get("application.process.id").map(str::to_owned),
                        client: dict_u32(props, "client.id"),
                        link_group: props.get("node.link-group").map(str::to_owned),
                    };
                    let changed = match ctx.graph.borrow_mut().nodes.get_mut(&id) {
                        Some(entry) => {
                            // A node's process never changes: once seen, a PID stays.
                            if parsed.app_pid.is_none() {
                                parsed.app_pid = entry.props.as_ref().and_then(|p| p.app_pid.clone());
                            }
                            let changed = entry.props.as_ref() != Some(&parsed);
                            entry.props = Some(parsed);
                            changed
                        }
                        None => false,
                    };
                    if changed {
                        reconcile(&ctx);
                    }
                })
                .register();
            ctx.graph.borrow_mut().nodes.insert(
                id,
                NodeEntry {
                    _proxy: proxy,
                    _listener: listener,
                    props: None,
                },
            );
        }
        ObjectType::Client => {
            let Ok(proxy) = ctx.registry.bind::<pw::client::Client, _>(global) else {
                return;
            };
            let weak: Weak<Ctx> = Rc::downgrade(ctx);
            let listener = proxy
                .add_listener_local()
                .info(move |info| {
                    if !info.change_mask().contains(pw::client::ClientChangeMask::PROPS) {
                        return;
                    }
                    let Some(ctx) = weak.upgrade() else {
                        return;
                    };
                    let pid = info
                        .props()
                        .and_then(|props| props.get("application.process.id"))
                        .map(str::to_owned);
                    let changed = match ctx.graph.borrow_mut().clients.get_mut(&id) {
                        // Same rule as nodes: a PID, once seen, stays.
                        Some(entry) if pid.is_some() && entry.app_pid.as_ref() != Some(&pid) => {
                            entry.app_pid = Some(pid);
                            true
                        }
                        Some(entry) if entry.app_pid.is_none() => {
                            entry.app_pid = Some(None);
                            true
                        }
                        _ => false,
                    };
                    if changed {
                        reconcile(&ctx);
                    }
                })
                .register();
            ctx.graph.borrow_mut().clients.insert(
                id,
                ClientEntry {
                    _proxy: proxy,
                    _listener: listener,
                    app_pid: None,
                },
            );
        }
        ObjectType::Port => {
            let Some(props) = global.props else {
                return;
            };
            let Some(node) = dict_u32(props, "node.id") else {
                return;
            };
            let port = PortEntry {
                node,
                output: props.get("port.direction") == Some("out"),
                channel: props.get("audio.channel").unwrap_or("UNK").to_owned(),
                monitor: props.get("port.monitor") == Some("true"),
            };
            log::debug!(target: "sysaudio", "port {id}: {port:?}");
            ctx.graph.borrow_mut().ports.insert(id, port);
            reconcile(ctx);
        }
        ObjectType::Link => {
            let Some(props) = global.props else {
                return;
            };
            if let (Some(output), Some(input)) = (
                dict_u32(props, "link.output.node"),
                dict_u32(props, "link.input.node"),
            ) {
                log::debug!(target: "sysaudio", "link {id}: {output} -> {input}");
                let mut graph = ctx.graph.borrow_mut();
                graph.links.insert(id, (output, input));
                if let (Some(out_port), Some(in_port)) = (
                    dict_u32(props, "link.output.port"),
                    dict_u32(props, "link.input.port"),
                ) {
                    graph.link_ports.insert(id, (out_port, in_port));
                }
                drop(graph);
                reconcile(ctx);
            }
        }
        _ => {}
    }
}

fn on_global_remove(ctx: &Rc<Ctx>, id: u32) {
    {
        let mut graph = ctx.graph.borrow_mut();
        graph.nodes.remove(&id);
        graph.clients.remove(&id);
        if let Some((output, input)) = graph.links.remove(&id) {
            log::debug!(target: "sysaudio", "link {id} gone: {output} -> {input}");
        }
        // PipeWire removes links itself, for instance when a node renegotiates its ports. If
        // it was one of ours, forget the proxy so the next pass makes it again.
        if let Some(ports) = graph.link_ports.remove(&id)
            && graph.ours.remove(&ports).is_some()
        {
            log::debug!(target: "sysaudio", "our link {ports:?} went away");
        }
        graph.verdicts.remove(&id);
        if let Some(port) = graph.ports.remove(&id) {
            log::debug!(target: "sysaudio", "port {id} gone: {port:?}");
            // A link whose port is gone is gone too; forget our proxy for it.
            graph
                .ours
                .retain(|(output, input), _| *output != id && *input != id);
        }
    }
    reconcile(ctx);
}

/// Which of our two input channels an output port feeds.
fn targets(channel: &str) -> &'static [&'static str] {
    match channel {
        "FL" | "RL" | "SL" | "FLC" | "RLC" | "FLW" | "TFL" | "TRL" | "TSL" => &["FL"],
        "FR" | "RR" | "SR" | "FRC" | "RRC" | "FRW" | "TFR" | "TRR" | "TSR" => &["FR"],
        "LFE" | "LFE2" => &[],
        // MONO, FC, RC and anything unpositioned go to both sides.
        _ => &["FL", "FR"],
    }
}

/// Recomputes which links should exist and makes it so. Cheap: graphs are tens of nodes.
fn reconcile(ctx: &Rc<Ctx>) {
    let own = ctx.stream.node_id();
    if own == pw::constants::ID_ANY {
        return;
    }
    let mut create = Vec::new();
    let mut logs = Vec::new();
    {
        let mut graph = ctx.graph.borrow_mut();
        let inputs: HashMap<&str, u32> = graph
            .ports
            .iter()
            .filter(|(_, port)| port.node == own && !port.output)
            .filter_map(|(id, port)| match port.channel.as_str() {
                "FL" => Some(("FL", *id)),
                "FR" => Some(("FR", *id)),
                _ => None,
            })
            .collect();
        if inputs.len() < 2 {
            return;
        }

        let client_pid = |client: Option<u32>| -> Option<Option<&str>> {
            match client {
                None => Some(None),
                Some(client) => graph
                    .clients
                    .get(&client)
                    .and_then(|entry| entry.app_pid.as_ref())
                    .map(|pid| pid.as_deref()),
            }
        };

        // Ours, and nodes we can't judge yet (their info hasn't arrived).
        let mut tainted: HashSet<u32> = HashSet::new();
        let mut unknown: HashSet<u32> = HashSet::new();
        for (id, entry) in &graph.nodes {
            let Some(props) = &entry.props else {
                unknown.insert(*id);
                continue;
            };
            let Some(client_pid) = client_pid(props.client) else {
                unknown.insert(*id);
                continue;
            };
            let ours = props.app_pid.as_deref() == Some(ctx.own_pid.as_str())
                || client_pid == Some(ctx.own_pid.as_str());
            if ours && !ctx.include_own && *id != own {
                tainted.insert(*id);
            }
        }
        let own_nodes: HashSet<u32> = tainted.clone();
        let mut queue: VecDeque<u32> = tainted.iter().copied().collect();
        while let Some(node) = queue.pop_front() {
            let group = graph
                .nodes
                .get(&node)
                .and_then(|entry| entry.props.as_ref())
                .and_then(|props| props.link_group.clone());
            if let Some(group) = group {
                for (id, entry) in &graph.nodes {
                    let same = entry
                        .props
                        .as_ref()
                        .is_some_and(|props| props.link_group.as_deref() == Some(group.as_str()));
                    if same && tainted.insert(*id) {
                        queue.push_back(*id);
                    }
                }
            }
            for (output, input) in graph.links.values() {
                if *output == node && *input != own && tainted.insert(*input) {
                    queue.push_back(*input);
                }
            }
        }

        // What the user hears: a stream the session manager has routed to a sink. One that plays
        // into a virtual mic, or isn't routed yet, isn't. Waiting for that link also means its
        // ports are configured before we link them.
        let is_sink = |node: &u32| {
            graph
                .nodes
                .get(node)
                .and_then(|entry| entry.props.as_ref())
                .is_some_and(|props| props.class.starts_with("Audio/Sink"))
        };
        let routed: HashSet<u32> = graph
            .links
            .values()
            .filter(|(_, input)| is_sink(input))
            .map(|(output, _)| *output)
            .collect();

        let mut desired: HashSet<(u32, u32)> = HashSet::new();
        let mut verdicts = Vec::new();
        for (id, entry) in &graph.nodes {
            let Some(props) = &entry.props else {
                continue;
            };
            if props.class != STREAM_OUTPUT || *id == own {
                continue;
            }
            let verdict = if unknown.contains(id) {
                "waiting"
            } else if own_nodes.contains(id) {
                "excluded: ours"
            } else if tainted.contains(id) {
                "excluded: carries ours"
            } else if !routed.contains(id) {
                "waiting: not playing to a sink"
            } else {
                for (port_id, port) in &graph.ports {
                    if port.node != *id || !port.output || port.monitor {
                        continue;
                    }
                    for side in targets(&port.channel) {
                        desired.insert((*port_id, inputs[side]));
                    }
                }
                "linked"
            };
            verdicts.push((*id, props.name.clone(), props.app_pid.clone(), verdict));
        }
        for (id, name, pid, verdict) in verdicts {
            if graph.verdicts.insert(id, verdict) != Some(verdict) {
                logs.push(format!(
                    "node {id} {name} pid {} -> {verdict}",
                    pid.as_deref().unwrap_or("?")
                ));
            }
        }

        if log::log_enabled!(target: "sysaudio", log::Level::Debug) {
            let mut links: Vec<_> = graph.links.iter().collect();
            links.sort();
            let groups: Vec<_> = graph
                .nodes
                .iter()
                .map(|(id, entry)| (*id, entry.props.as_ref().map(|p| p.link_group.clone())))
                .collect();
            log::debug!(target: "sysaudio", "tainted {tainted:?} unknown {unknown:?} links {links:?} groups {groups:?}");
        }
        let ports_now = graph.ports.clone();
        let verdicts_now = graph.verdicts.clone();
        graph.ours.retain(|key, _| {
            let keep = desired.contains(key);
            if !keep {
                log::debug!(target: "sysaudio", "unlinking {key:?}; desired {desired:?}; routed {routed:?}; port {:?}; verdicts {verdicts_now:?}", ports_now.get(&key.0));
            }
            keep
        });
        for key in desired {
            if !graph.ours.contains_key(&key) {
                create.push(key);
            }
        }
        for key in &create {
            let output_node = graph.ports[&key.0].node;
            let made = ctx.core.create_object::<pw::link::Link>(
                "link-factory",
                &properties! {
                    *pw::keys::LINK_OUTPUT_NODE => output_node.to_string(),
                    *pw::keys::LINK_OUTPUT_PORT => key.0.to_string(),
                    *pw::keys::LINK_INPUT_NODE => own.to_string(),
                    *pw::keys::LINK_INPUT_PORT => key.1.to_string(),
                    *pw::keys::OBJECT_LINGER => "false",
                    // Our links never wake a paused app or hold the graph up.
                    *pw::keys::LINK_PASSIVE => "true",
                },
            );
            match made {
                Ok(link) => {
                    let key = *key;
                    let listener = link
                        .add_listener_local()
                        .info(move |info| {
                            log::debug!(target: "sysaudio", "our link {key:?} id {}: {:?}", info.id(), info.state());
                        })
                        .register();
                    graph.ours.insert(key, (link, listener));
                }
                Err(error) => logs.push(format!("link {key:?} failed: {error}")),
            }
        }
    }
    for line in logs {
        log::info!(target: "sysaudio", "{line}");
    }
}
