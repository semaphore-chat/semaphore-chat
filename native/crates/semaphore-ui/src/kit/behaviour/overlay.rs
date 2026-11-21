//! The overlay-stack host (`design/guide/behaviour.md`, "Overlay stack" and "What a host does"),
//! the native side of the web's `hosts/overlay.ts`. Every kit Menu, Popover, Dialog and Sheet
//! registers a layer with [`use_layer`]; the window's [`super::BehaviourRoot`] turns Escape and
//! presses into the reducer's events, and the host applies its effects: it asks an owner to close,
//! moves focus back, or runs the screen's Escape chain.
//!
//! How the GPUI pieces map onto the web's:
//! - **A layer's life is its element state.** `use_layer` keeps a token in keyed element state
//!   under the piece's id. The first render that draws it opens the layer; GPUI drops the token
//!   at the end of the first frame that does not draw it, and its release reports `closed`. The
//!   releases of one frame are reported together, after it, outermost first, so a parent's
//!   `closed` comes before its children's (they get `parentClosed`, whatever order GPUI dropped
//!   them in).
//! - **The parent** is the innermost [`LayerScope`] being drawn, a tree-scoped context kept the
//!   way `SurfaceScope` keeps the surface.
//! - **Focus.** As a layer closes, focus is `lost` when nothing has focus, when it is on the
//!   window's focus sink (the app root parks lost focus there) or on the root's own handle (a
//!   press on nothing that takes focus), or on an element no longer drawn (it went with the
//!   layer); anywhere else the user moved it (`outside`). This is the web's `focusPosition`: it
//!   is read when the layer closes, not sampled while it renders. An opener is a
//!   `WeakFocusHandle`, on the page while the root contains it.
//! - **Presses.** Each layer writes its panel's bounds (and a popover its anchor's) in prepaint;
//!   the root's capture-phase listeners find the innermost layer under a left press going down
//!   and coming up, among the layers open at the mouse-down (one opened by the press itself is
//!   left out of the hit test), and send `pressOutside` when both are the same. A press outside a
//!   topmost menu goes no further (rule 8): its down and up stop in the capture phase.
//!   **A layer opens on click, never on mouse-down**: one opened by a press's own mouse-down is
//!   above the layer the press started in, and that press's `pressOutside` closes it (the
//!   reducer closes every layer above `insideId`). The kit's triggers (Button, the Popover's)
//!   open on click.
//! - **Escape** reaches the stack ahead of key bindings: every layer's element sets the
//!   `KitLayer` key context, where Escape is bound to the host, so a binding of an ancestor
//!   (a pane's `escape`) cannot take it while a layer has focus. A focused control that uses
//!   Escape binds it in its own, deeper key context and has it first. With focus outside every
//!   layer, the root's bubble-phase listener sends it.
//!
//! Tooltips are not layers: GPUI's own tooltips have no open or close the host could see. So an
//! Escape pressed while a tooltip shows closes the layer under it (the web's tooltip takes that
//! Escape); see `design/guide/behaviour.md`.

use super::BehaviourHost;
use super::machine::{Machine, drive};
use gpui_kit::*;
use semaphore_design::behaviour::overlay_stack::{
    self as stack, CloseFocus, Effect, Event, Layer, Params, State,
};
pub use semaphore_design::behaviour::overlay_stack::{CloseReason, LayerKind};
use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;

pub(crate) type Close = Rc<dyn Fn(CloseReason, &mut Window, &mut App)>;
pub(crate) type FocusLayer = Rc<dyn Fn(&mut Window, &mut App)>;
type ScreenStep = Rc<dyn Fn(&mut Window, &mut App) -> bool>;

/// What a kit overlay gives the host, each time it renders.
pub(crate) struct LayerSpec {
    pub kind: LayerKind,
    /// Focus in any of these (or anything they contain) is inside the layer.
    pub roots: Vec<FocusHandle>,
    /// The host asks the owner to close. Every reason but `ParentClosed` may be refused.
    pub on_request_close: Close,
    /// Focuses the layer: its first control that takes focus, else its panel.
    pub focus_layer: Option<FocusLayer>,
    /// Focus returns here, whatever has focus as the layer opens (a popover's trigger).
    pub opener: Option<FocusHandle>,
    /// Focus returns here when nothing had focus as the layer opened (a menu's anchor).
    pub fallback_opener: Option<FocusHandle>,
}

struct Registration {
    kind: LayerKind,
    roots: Vec<FocusHandle>,
    on_request_close: Close,
    focus_layer: Option<FocusLayer>,
    panel: Rc<Cell<Option<Bounds<Pixels>>>>,
    anchor: Rc<Cell<Option<Bounds<Pixels>>>>,
}

/// A left press that is down: the innermost layer under it, the layers open then, and whether it
/// was swallowed (outside a topmost menu).
struct Press {
    inside: Option<String>,
    open: Vec<String>,
    swallowed: bool,
}

/// The token whose life is the layer's.
struct LayerToken {
    id: String,
}

struct ScreenEscape {
    priority: i32,
    order: u64,
    handler: ScreenStep,
}

struct ScreenTarget {
    order: u64,
    handle: FocusHandle,
}

type StackMachine = Machine<State, Event, Effect, Params>;

pub(crate) struct OverlayHost {
    machine: StackMachine,
    layers: HashMap<String, Registration>,
    openers: HashMap<String, WeakFocusHandle>,
    next_id: u64,
    /// The left press that is down, while a layer is open.
    press: Option<Press>,
    /// Layers gone this frame, reported together after it.
    released: Vec<String>,
    escapes: Vec<WeakEntity<ScreenEscape>>,
    targets: Vec<WeakEntity<ScreenTarget>>,
}

impl OverlayHost {
    pub(crate) fn new() -> Self {
        Self {
            machine: Machine::new(stack::step, stack::initial(&Params), Params),
            layers: HashMap::new(),
            openers: HashMap::new(),
            next_id: 0,
            press: None,
            released: Vec::new(),
            escapes: Vec::new(),
            targets: Vec::new(),
        }
    }

    fn next(&mut self, prefix: &str) -> String {
        self.next_id += 1;
        format!("{prefix}-{}", self.next_id)
    }

    /// The open layers, bottom first.
    pub(crate) fn layers(&self) -> &[Layer] {
        &self.machine.state().layers
    }

    /// The innermost layer whose panel (or anchor) holds `point`, among `among` if given.
    fn inside_at(&self, point: Point<Pixels>, among: Option<&[String]>) -> Option<String> {
        self.layers().iter().rev().find_map(|layer| {
            if among.is_some_and(|among| !among.contains(&layer.id)) {
                return None;
            }
            let reg = self.layers.get(&layer.id)?;
            let hit = |cell: &Rc<Cell<Option<Bounds<Pixels>>>>| {
                cell.get().is_some_and(|bounds| bounds.contains(&point))
            };
            (hit(&reg.panel) || hit(&reg.anchor)).then(|| layer.id.clone())
        })
    }

    /// Where `handle` is: the innermost open layer one of whose roots is or contains it.
    fn layer_of(&self, handle: &FocusHandle, window: &Window) -> Option<String> {
        self.layers().iter().rev().find_map(|layer| {
            let reg = self.layers.get(&layer.id)?;
            reg.roots
                .iter()
                .any(|root| root == handle || root.contains(handle, window))
                .then(|| layer.id.clone())
        })
    }

    /// Forgets the openers no open layer names any more.
    fn prune_openers(&mut self) {
        let named: Vec<String> = self
            .layers()
            .iter()
            .filter_map(|layer| layer.opener.clone())
            .collect();
        self.openers.retain(|id, _| named.contains(id));
    }
}

fn machine(host: &mut BehaviourHost) -> &mut StackMachine {
    &mut host.overlay.machine
}

// ---------------------------------------------------------------------------------------------
// Layer scope

/// The ids of the layer scopes being drawn, innermost last; `None` is outside every layer.
#[derive(Default)]
struct LayerStack {
    ids: Vec<Option<String>>,
}

impl Global for LayerStack {}

/// The layer the piece being drawn is inside, or `None` for the screen.
pub(crate) fn current_layer(cx: &App) -> Option<String> {
    cx.try_global::<LayerStack>()
        .and_then(|stack| stack.ids.last().cloned())
        .flatten()
}

fn with_layer<R>(id: Option<String>, cx: &mut App, f: impl FnOnce(&mut App) -> R) -> R {
    let stack = cx.default_global::<LayerStack>();
    let depth = stack.ids.len();
    stack.ids.push(id);
    let result = f(cx);
    cx.default_global::<LayerStack>().ids.truncate(depth);
    result
}

/// Runs `f` with no layer around it: the root's content is the screen.
pub(crate) fn outside_every_layer<R>(cx: &mut App, f: impl FnOnce(&mut App) -> R) -> R {
    with_layer(None, cx, f)
}

/// Gives `child`'s subtree its layer: an overlay opened in it is owned by this layer and closes
/// with it. Layout-transparent, as `SurfaceScope`.
pub(crate) struct LayerScope {
    id: String,
    child: AnyElement,
}

impl LayerScope {
    pub(crate) fn new(id: impl Into<String>, child: impl IntoElement) -> Self {
        Self {
            id: id.into(),
            child: child.into_any_element(),
        }
    }
}

impl IntoElement for LayerScope {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl Element for LayerScope {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
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
    ) -> (LayoutId, ()) {
        let child = &mut self.child;
        let layout = with_layer(Some(self.id.clone()), cx, |cx| {
            child.request_layout(window, cx)
        });
        (layout, ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let child = &mut self.child;
        with_layer(Some(self.id.clone()), cx, |cx| child.prepaint(window, cx));
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.paint(window, cx);
    }
}

// ---------------------------------------------------------------------------------------------
// Layers

/// A layer of the stack, as a piece drawing it sees it.
#[derive(Clone)]
pub(crate) struct LayerHandle {
    pub id: String,
    panel: Rc<Cell<Option<Bounds<Pixels>>>>,
    anchor: Rc<Cell<Option<Bounds<Pixels>>>>,
}

impl LayerHandle {
    /// An out-of-layout child of the panel that records the panel's bounds: presses in them are
    /// inside the layer. Put it in a `relative` panel.
    pub(crate) fn panel_probe(&self) -> impl IntoElement {
        bounds_probe(self.panel.clone())
    }

    /// Records the panel's bounds from a parent's `on_children_prepainted`.
    pub(crate) fn set_panel(&self, bounds: Option<Bounds<Pixels>>) {
        self.panel.set(bounds);
    }

    /// The same for a popover's anchor: a press on it counts as inside the popover.
    pub(crate) fn anchor_probe(&self) -> impl IntoElement {
        bounds_probe(self.anchor.clone())
    }
}

/// A child that fills its `relative` parent, draws nothing and records the parent's bounds.
pub(crate) fn bounds_probe(cell: Rc<Cell<Option<Bounds<Pixels>>>>) -> impl IntoElement {
    canvas(move |bounds, _, _| cell.set(Some(bounds)), |_, _, _, _| {})
        .absolute()
        .top_0()
        .left_0()
        .size_full()
}

/// Makes a kit overlay a layer of the window's stack, keyed by `key` (the piece's own id). Call
/// it in every render that draws the overlay, before anything in it takes focus: the first one
/// opens the layer with the element that has focus as its opener. Open it on a click, never on a
/// mouse-down: a layer opened by a press's own mouse-down is closed by that press. `None` without a host: the
/// piece keeps its own handling.
pub(crate) fn use_layer(
    key: impl Into<ElementId>,
    spec: LayerSpec,
    window: &mut Window,
    cx: &mut App,
) -> Option<LayerHandle> {
    let host = BehaviourHost::of(window, cx)?;
    let mut opened: Option<Layer> = None;
    let token = window.use_keyed_state(key, cx, |window, cx| {
        let focused = window.focused(cx);
        let parent = current_layer(cx);
        let (id, layer) = host.update(cx, |host, _| {
            let id = host.overlay.next("layer");
            let sink = host.sink();
            // An owner that focused a control of this layer before its first frame (a field of
            // a new dialog): the opener is what had focus in the last frame drawn.
            let focused = match focused {
                Some(handle) if !host.drawn(&handle, window) => {
                    host.last_focus.as_ref().and_then(WeakFocusHandle::upgrade)
                }
                other => other,
            };
            // Focus parked on the sink or the root is no opener: focus then returns to the
            // layer's own fallback, else (none) to the screen's focus target.
            let lost = match &focused {
                None => true,
                Some(handle) => Some(handle) == sink.as_ref() || *handle == host.root,
            };
            let opener = spec.opener.clone().or_else(|| {
                if lost {
                    spec.fallback_opener.clone()
                } else {
                    focused
                }
            });
            let (opener_id, opener_layer) = match &opener {
                Some(handle) => {
                    let opener_id = host.overlay.next("opener");
                    host.overlay
                        .openers
                        .insert(opener_id.clone(), handle.downgrade());
                    (Some(opener_id), host.overlay.layer_of(handle, window))
                }
                None => (None, None),
            };
            let layer = Layer {
                id: id.clone(),
                kind: spec.kind,
                parent,
                opener: opener_id,
                opener_layer,
            };
            (id, layer)
        });
        opened = Some(layer);
        LayerToken { id }
    });
    let id = token.read(cx).id.clone();
    if opened.is_some() {
        let weak = host.downgrade();
        window
            .observe_release(&token, cx, move |token, window, cx| {
                if let Some(host) = weak.upgrade() {
                    released(&host, token.id.clone(), window, cx);
                }
            })
            .detach();
    }
    let handle = host.update(cx, |host, _| {
        let reg = host
            .overlay
            .layers
            .entry(id.clone())
            .or_insert_with(|| Registration {
                kind: spec.kind,
                roots: Vec::new(),
                on_request_close: spec.on_request_close.clone(),
                focus_layer: None,
                panel: Rc::default(),
                anchor: Rc::default(),
            });
        reg.kind = spec.kind;
        reg.roots = spec.roots;
        reg.on_request_close = spec.on_request_close;
        reg.focus_layer = spec.focus_layer;
        LayerHandle {
            id: id.clone(),
            panel: reg.panel.clone(),
            anchor: reg.anchor.clone(),
        }
    });
    if let Some(layer) = opened {
        send(&host, Event::Open { layer }, window, cx);
    }
    Some(handle)
}

/// A layer's token was dropped: report it after the frame, with the others gone in it.
fn released(host: &Entity<BehaviourHost>, id: String, window: &mut Window, cx: &mut App) {
    let first = host.update(cx, |host, _| {
        host.overlay.released.push(id);
        host.overlay.released.len() == 1
    });
    if first {
        let host = host.clone();
        window.defer(cx, move |window, cx| flush_released(&host, window, cx));
    }
}

/// Reports the layers gone in the last frame, outermost first.
fn flush_released(host: &Entity<BehaviourHost>, window: &mut Window, cx: &mut App) {
    let mut gone = host.update(cx, |host, _| std::mem::take(&mut host.overlay.released));
    let order: Vec<String> = host
        .read(cx)
        .overlay
        .layers()
        .iter()
        .map(|layer| layer.id.clone())
        .collect();
    gone.sort_by_key(|id| order.iter().position(|known| known == id));
    for id in gone {
        let event = {
            let host = host.read(cx);
            let overlay = &host.overlay;
            // The web's `focusPosition`: lost when nothing has focus, focus is parked (the
            // sink, the root's own handle) or on an element no longer drawn.
            let focused = window.focused(cx);
            let lost = match &focused {
                None => true,
                Some(handle) => {
                    Some(handle) == host.sink().as_ref()
                        || *handle == host.root
                        || !host.drawn(handle, window)
                }
            };
            let focus = if lost {
                CloseFocus::Lost
            } else {
                CloseFocus::Outside
            };
            let opener_present = overlay
                .layers()
                .iter()
                .find(|layer| layer.id == id)
                .and_then(|layer| layer.opener.as_ref())
                .and_then(|opener| overlay.openers.get(opener))
                .and_then(WeakFocusHandle::upgrade)
                .is_some_and(|opener| host.drawn(&opener, window));
            Event::Closed {
                id: id.clone(),
                opener_present,
                focus,
            }
        };
        send(host, event, window, cx);
        host.update(cx, |host, _| {
            host.overlay.layers.remove(&id);
        });
    }
    host.update(cx, |host, _| host.overlay.prune_openers());
}

/// Sends one event and applies its effects; true when an effect used the key (a layer was asked
/// to close, or the screen's Escape chain took it).
fn send(host: &Entity<BehaviourHost>, event: Event, window: &mut Window, cx: &mut App) -> bool {
    let used = Cell::new(false);
    drive(host, machine, event, window, cx, |effect, window, cx| {
        if apply(host, effect, window, cx) {
            used.set(true);
        }
    });
    used.get()
}

fn apply(host: &Entity<BehaviourHost>, effect: Effect, window: &mut Window, cx: &mut App) -> bool {
    match effect {
        Effect::RequestClose { id, reason } => {
            let close = host.update(cx, |host, _| {
                let close = host
                    .overlay
                    .layers
                    .get(&id)
                    .map(|reg| reg.on_request_close.clone());
                // A layer told to close with its parent has already left the stack.
                if reason == CloseReason::ParentClosed {
                    host.overlay.layers.remove(&id);
                }
                close
            });
            if let Some(close) = close {
                close(reason, window, cx);
            }
            true
        }
        Effect::RestoreFocus { to } => {
            restore_focus(host, to, window, cx);
            false
        }
        Effect::PassToScreen => run_screen_escape(host, window, cx),
        // A desktop window has no system Back to pass on.
        Effect::PassToPlatform => false,
    }
}

/// `restoreFocus{to}`: the opener or layer named, else the topmost dialog or sheet still open,
/// else the screen's focus target, else the window's focus sink.
fn restore_focus(
    host: &Entity<BehaviourHost>,
    to: Option<String>,
    window: &mut Window,
    cx: &mut App,
) {
    enum Target {
        Handle(FocusHandle),
        Layer(FocusLayer),
    }
    let target = {
        let host = host.read(cx);
        let overlay = &host.overlay;
        let named = to.as_ref().and_then(|to| {
            if let Some(opener) = overlay.openers.get(to) {
                opener.upgrade().map(Target::Handle)
            } else {
                let reg = overlay.layers.get(to)?;
                reg.focus_layer
                    .clone()
                    .map(Target::Layer)
                    .or_else(|| reg.roots.first().cloned().map(Target::Handle))
            }
        });
        named.or_else(|| {
            let modal = overlay.layers().iter().rev().find_map(|layer| {
                matches!(layer.kind, LayerKind::Dialog | LayerKind::Sheet)
                    .then(|| overlay.layers.get(&layer.id))
                    .flatten()
            });
            if let Some(reg) = modal {
                return reg
                    .focus_layer
                    .clone()
                    .map(Target::Layer)
                    .or_else(|| reg.roots.first().cloned().map(Target::Handle));
            }
            screen_target(overlay, cx)
                .or_else(|| host.sink())
                .map(Target::Handle)
        })
    };
    match target {
        Some(Target::Handle(handle)) => window.focus(&handle, cx),
        Some(Target::Layer(focus)) => focus(window, cx),
        None => {}
    }
}

pub(crate) fn screen_target(overlay: &OverlayHost, cx: &App) -> Option<FocusHandle> {
    overlay
        .targets
        .iter()
        .filter_map(WeakEntity::upgrade)
        .max_by_key(|target| target.read(cx).order)
        .map(|target| target.read(cx).handle.clone())
}

fn run_screen_escape(host: &Entity<BehaviourHost>, window: &mut Window, cx: &mut App) -> bool {
    let mut steps: Vec<(i32, u64, ScreenStep)> = host
        .read(cx)
        .overlay
        .escapes
        .iter()
        .filter_map(WeakEntity::upgrade)
        .map(|step| {
            let step = step.read(cx);
            (step.priority, step.order, step.handler.clone())
        })
        .collect();
    steps.sort_by_key(|(priority, order, _)| (*priority, *order));
    steps.into_iter().any(|(_, _, handler)| handler(window, cx))
}

// ---------------------------------------------------------------------------------------------
// What the window reports

/// The window's listeners, added by the root in paint: Escape in the bubble phase (a focused
/// control that uses it stops it first), presses in the capture phase (before any element).
pub(crate) fn listen(host: &Entity<BehaviourHost>, window: &mut Window) {
    let keys = host.clone();
    window.on_key_event(move |event: &KeyDownEvent, phase, window, cx| {
        if phase != DispatchPhase::Bubble || !is_plain_escape(event) {
            return;
        }
        // Its repeats then do nothing on the binding path either (focus may move into a layer).
        keys.update(cx, |host, _| host.escape_down = true);
        if escape(&keys, window, cx) {
            cx.stop_propagation();
        }
    });
    // The key-up reaches this node only while focus is on something drawn: after a layer closed
    // and before focus is restored, GPUI sends it to the window's root node alone. A real key-up
    // comes after the restore; the root also clears the flag while the window is inactive, so a
    // missed key-up can swallow at most one Escape.
    let released = host.clone();
    window.on_key_event(move |event: &KeyUpEvent, phase, _, cx| {
        if phase == DispatchPhase::Capture && event.keystroke.key == "escape" {
            released.update(cx, |host, _| host.escape_down = false);
        }
    });
    let down = host.clone();
    window.on_mouse_event(move |event: &MouseDownEvent, phase, _, cx| {
        if phase != DispatchPhase::Capture || event.button != MouseButton::Left {
            return;
        }
        let swallowed = down.update(cx, |host, _| {
            let overlay = &mut host.overlay;
            if overlay.layers().is_empty() {
                overlay.press = None;
                return false;
            }
            let inside = overlay.inside_at(event.position, None);
            let open: Vec<String> = overlay.layers().iter().map(|l| l.id.clone()).collect();
            let swallowed = outside_top_menu(overlay, inside.as_deref());
            overlay.press = Some(Press {
                inside,
                open,
                swallowed,
            });
            swallowed
        });
        // Rule 8: a press outside a menu closes it and goes no further.
        if swallowed {
            cx.stop_propagation();
        }
    });
    let up = host.clone();
    window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
        if phase != DispatchPhase::Capture || event.button != MouseButton::Left {
            return;
        }
        let press = up.update(cx, |host, _| {
            let overlay = &mut host.overlay;
            let press = overlay.press.take()?;
            // A layer opened by this press (on its mouse-down) is not part of it.
            let at_up = overlay.inside_at(event.position, Some(&press.open));
            Some((at_up == press.inside, press))
        });
        let Some((same, press)) = press else { return };
        if press.swallowed {
            cx.stop_propagation();
        }
        if same {
            send(
                &up,
                Event::PressOutside {
                    inside_id: press.inside,
                },
                window,
                cx,
            );
        }
    });
}

/// The topmost layer under the tooltips is a menu, and the press is not in it (or a layer it
/// owns).
fn outside_top_menu(overlay: &OverlayHost, inside: Option<&str>) -> bool {
    let layers = overlay.layers();
    let Some(top) = layers.iter().rev().find(|l| l.kind != LayerKind::Tooltip) else {
        return false;
    };
    if top.kind != LayerKind::Menu {
        return false;
    }
    // Inside when the press is in the menu or in a layer opened from it.
    let mut current = inside.map(str::to_owned);
    while let Some(id) = current {
        if id == top.id {
            return false;
        }
        current = layers
            .iter()
            .find(|l| l.id == id)
            .and_then(|l| l.parent.clone());
    }
    true
}

actions!(kit_layer, [LayerEscape]);

/// The key context every layer's element sets: Escape there is the host's.
pub(crate) const LAYER_CONTEXT: &str = "KitLayer";

struct LayerKeysBound;
impl Global for LayerKeysBound {}

/// Gives a hosted layer's element the host's Escape. The element sets the `KitLayer` key context
/// itself (with any context of its own: `"KitMenu KitLayer"`), where Escape goes to the stack
/// ahead of any ancestor's binding. A control inside that binds Escape in its own context has it
/// first.
pub(crate) fn layer_keys<E: InteractiveElement>(element: E, cx: &mut App) -> E {
    if !cx.has_global::<LayerKeysBound>() {
        cx.bind_keys([KeyBinding::new("escape", LayerEscape, Some(LAYER_CONTEXT))]);
        cx.set_global(LayerKeysBound);
    }
    element.on_action(|_: &LayerEscape, window, cx| {
        let Some(host) = BehaviourHost::of(window, cx) else {
            cx.propagate();
            return;
        };
        // Key repeats match bindings too: while this Escape is down, they do nothing, so a held
        // Escape closes one layer, as on the listener path (`is_held`).
        if host.update(cx, |host, _| std::mem::replace(&mut host.escape_down, true)) {
            return;
        }
        if !escape(&host, window, cx) {
            cx.propagate();
        }
    })
}

/// Escape alone (Shift allowed), not a held repeat: Ctrl, Alt or Meta make another shortcut.
fn is_plain_escape(event: &KeyDownEvent) -> bool {
    let m = &event.keystroke.modifiers;
    event.keystroke.key == "escape"
        && !event.is_held
        && !(m.control || m.alt || m.platform || m.function)
}

/// One Escape reached the window. True when the stack or the screen's chain used it.
///
/// `composing` is always false: GPUI's key event has no composing flag, so a text field with an
/// input method composing stops the key itself, as "focus owns Escape".
// TODO(#848 B8): check with a real IME (fcitx5/IBus, the Windows IME) that composition never
// lets an Escape reach the stack.
pub(crate) fn escape(host: &Entity<BehaviourHost>, window: &mut Window, cx: &mut App) -> bool {
    send(
        host,
        Event::Escape {
            composing: false,
            focus_owns_escape: false,
        },
        window,
        cx,
    )
}

/// For a screen's own Escape binding (a pane's `escape` in its key context): asks the stack
/// first. True when a layer is open: the stack gets this Escape (after the caller's handler
/// returns), and the screen does nothing.
pub fn escape_open_layer(window: &mut Window, cx: &mut App) -> bool {
    let Some(host) = BehaviourHost::of(window, cx) else {
        return false;
    };
    if host.read(cx).overlay.layers().is_empty() {
        return false;
    }
    // After the caller's handler: an owner's close handler may update the view that called this,
    // which is being updated now.
    window.defer(cx, move |window, cx| {
        escape(&host, window, cx);
    });
    true
}

/// Tab or Shift+Tab in a menu. True when the stack closed the menu: the key is then consumed.
pub(crate) fn tab(host: &Entity<BehaviourHost>, window: &mut Window, cx: &mut App) -> bool {
    send(host, Event::Tab, window, cx)
}

// ---------------------------------------------------------------------------------------------
// What screens give the stack

/// For screens: a step of the Escape chain, run when Escape reaches the screen (no layer is open).
/// Steps run by ascending `priority` until one returns true (it used the key). Call it in every
/// render of the screen; `key` names the step in the screen's element state. The host exists
/// once the window's `BehaviourRoot` has been laid out: a view that calls this in the same render
/// that builds the root (the root view itself) is registered from its next render, so register
/// from a view inside the root.
pub fn screen_escape(
    key: impl Into<ElementId>,
    priority: i32,
    handler: impl Fn(&mut Window, &mut App) -> bool + 'static,
    window: &mut Window,
    cx: &mut App,
) {
    let Some(host) = BehaviourHost::of(window, cx) else {
        return;
    };
    let mut fresh = false;
    let step = window.use_keyed_state(key, cx, |_, _| {
        fresh = true;
        ScreenEscape {
            priority,
            order: 0,
            handler: Rc::new(|_, _| false),
        }
    });
    let order = if fresh {
        host.update(cx, |host, _| {
            host.overlay.escapes.retain(|step| step.upgrade().is_some());
            host.overlay.escapes.push(step.downgrade());
            host.overlay.next_id += 1;
            host.overlay.next_id
        })
    } else {
        step.read(cx).order
    };
    step.update(cx, |step, _| {
        step.priority = priority;
        step.order = order;
        step.handler = Rc::new(handler);
    });
}

/// For screens: where focus goes when the layer it would return to has gone (the composer on a
/// chat screen). The last one drawn first wins; without one, the window's focus sink. Like
/// [`screen_escape`], it takes effect from a view inside the window's `BehaviourRoot`.
pub fn screen_focus_target(
    key: impl Into<ElementId>,
    handle: &FocusHandle,
    window: &mut Window,
    cx: &mut App,
) {
    let Some(host) = BehaviourHost::of(window, cx) else {
        return;
    };
    let mut fresh = false;
    let target = window.use_keyed_state(key, cx, |_, _| {
        fresh = true;
        ScreenTarget {
            order: 0,
            handle: handle.clone(),
        }
    });
    if fresh {
        let order = host.update(cx, |host, _| {
            host.overlay
                .targets
                .retain(|target| target.upgrade().is_some());
            host.overlay.targets.push(target.downgrade());
            host.overlay.next_id += 1;
            host.overlay.next_id
        });
        target.update(cx, |target, _| target.order = order);
    }
    target.update(cx, |target, _| target.handle = handle.clone());
}
