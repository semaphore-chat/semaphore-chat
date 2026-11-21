//! The one behaviour host of a window, the native side of the web's `BehaviourHost.tsx`.
//!
//! [`BehaviourRoot`] wraps a window's root content (the app's windows and the story harness). It
//! keeps the host entity in its element state, so the host lives as long as the window draws it,
//! and records it in an `App` global by window, where kit pieces find it with
//! [`BehaviourHost::of`]. Without a root (a bare unit test), `of` is `None` and every piece keeps
//! its own local behaviour, as the web's hooks do nothing outside a `KitProvider`.
//!
//! The root draws its child in one full-size element that tracks the host's own focus handle: the
//! window's root view already fills the window, so the child's layout does not change, and the
//! handle tells the host what is on the page ("is the opener still drawn?" is "does the root
//! contain it?"). The handle is no Tab stop, and it takes focus only from a press on nothing else
//! that takes focus. In paint the root adds the window's Escape listener (bubble phase, so a focused
//! control that uses Escape has it first) and its press listeners (capture phase, before any
//! element's), and it draws the announcer's live nodes out of layout.

use super::announce::Announcer;
use super::overlay::{self, OverlayHost};
use super::toasts::ToastHost;
use gpui_kit::*;
use std::collections::HashMap;

/// What a window's host holds: the overlay stack, the toast queue and the announcer.
pub struct BehaviourHost {
    pub(crate) overlay: OverlayHost,
    pub(crate) toasts: ToastHost,
    pub(crate) announcer: Announcer,
    /// Where focus sits when nothing else has it (the app root's own handle): focus found there
    /// as a layer closes counts as lost, and it is the last fallback of a focus return.
    pub(crate) focus_sink: Option<WeakFocusHandle>,
    /// Tracked on the root's element: everything drawn in the window is inside it.
    pub(crate) root: FocusHandle,
    /// What had focus when the last frame was painted: the opener of a layer whose owner moved
    /// focus into it before its first frame.
    pub(crate) last_focus: Option<WeakFocusHandle>,
    /// An Escape is down: its key repeats do nothing (one layer per press).
    pub(crate) escape_down: bool,
    /// Follows the window's activation for the toast queue's "hidden" reason, frame or not.
    _activation: Option<Subscription>,
}

#[derive(Default)]
struct Hosts {
    by_window: HashMap<WindowId, WeakEntity<BehaviourHost>>,
}

impl Global for Hosts {}

impl BehaviourHost {
    fn new(cx: &mut App) -> Self {
        Self {
            overlay: OverlayHost::new(),
            toasts: ToastHost::new(),
            announcer: Announcer::default(),
            focus_sink: None,
            root: cx.focus_handle(),
            last_focus: None,
            escape_down: false,
            _activation: None,
        }
    }

    /// Where focus goes when the place it would return to has gone: the screen's focus target,
    /// else the window's focus sink.
    pub(crate) fn screen_focus(&self, cx: &App) -> Option<FocusHandle> {
        overlay::screen_target(&self.overlay, cx).or_else(|| self.sink())
    }

    /// Whether `handle`'s element was in the last frame drawn.
    pub(crate) fn drawn(&self, handle: &FocusHandle, window: &Window) -> bool {
        self.root.contains(handle, window)
    }

    /// The host of `window`, or `None` when the window has no [`BehaviourRoot`].
    pub fn of(window: &Window, cx: &App) -> Option<Entity<BehaviourHost>> {
        Self::for_window(window.window_handle().window_id(), cx)
    }

    /// The host of the window `id` names, from anywhere (a task, another view).
    pub fn for_window(id: WindowId, cx: &App) -> Option<Entity<BehaviourHost>> {
        cx.try_global::<Hosts>()?.by_window.get(&id)?.upgrade()
    }

    pub(crate) fn sink(&self) -> Option<FocusHandle> {
        self.focus_sink.as_ref().and_then(WeakFocusHandle::upgrade)
    }
}

/// Mounts the behaviour host of a window around `child`.
pub struct BehaviourRoot {
    child: AnyElement,
    focus_sink: Option<FocusHandle>,
    live: Option<AnyElement>,
}

impl BehaviourRoot {
    pub fn new(child: impl IntoElement) -> Self {
        Self {
            child: child.into_any_element(),
            focus_sink: None,
            live: None,
        }
    }

    /// The handle the window keeps focus on when nothing else has it (the app root's).
    pub fn focus_sink(mut self, handle: &FocusHandle) -> Self {
        self.focus_sink = Some(handle.clone());
        self
    }
}

impl IntoElement for BehaviourRoot {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl Element for BehaviourRoot {
    type RequestLayoutState = Option<Entity<BehaviourHost>>;
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some("kit-behaviour-root".into())
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let host = window.use_keyed_state("kit-behaviour-host", cx, |window, cx| {
            let mut host = BehaviourHost::new(cx);
            host._activation = Some(cx.observe_window_activation(window, |_, window, cx| {
                let host = cx.entity();
                window.defer(cx, move |window, cx| {
                    super::toasts::sync_pause(&host, window, cx)
                });
            }));
            host
        });
        let id = window.window_handle().window_id();
        let hosts = &mut cx.default_global::<Hosts>().by_window;
        // Windows that closed leave a dead entry: drop them as a host is recorded.
        hosts.retain(|_, host| host.upgrade().is_some());
        hosts.insert(id, host.downgrade());
        let sink = self.focus_sink.as_ref().map(FocusHandle::downgrade);
        let (live, root) = host.update(cx, |host, _| {
            host.focus_sink = sink;
            (host.announcer.nodes(), host.root.clone())
        });
        self.live = live;
        let child = std::mem::replace(&mut self.child, Empty.into_any_element());
        self.child = div()
            .id("kit-behaviour-root")
            .size_full()
            .track_focus(&root)
            .child(child)
            .into_any_element();
        let child = &mut self.child;
        let layout = overlay::outside_every_layer(cx, |cx| child.request_layout(window, cx));
        (layout, Some(host))
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let child = &mut self.child;
        overlay::outside_every_layer(cx, |cx| child.prepaint(window, cx));
        if let Some(live) = &mut self.live {
            live.prepaint_as_root(
                bounds.origin,
                size(AvailableSpace::MinContent, AvailableSpace::MinContent),
                window,
                cx,
            );
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        host: &mut Self::RequestLayoutState,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        if let Some(host) = host.clone() {
            overlay::listen(&host, window);
        }
        self.child.paint(window, cx);
        if let Some(live) = &mut self.live {
            live.paint(window, cx);
        }
        if let Some(host) = host {
            let focused = window.focused(cx).map(|handle| handle.downgrade());
            let inactive = !window.is_window_active();
            host.update(cx, |host, _| {
                host.last_focus = focused;
                if inactive {
                    host.escape_down = false;
                }
            });
        }
    }
}
