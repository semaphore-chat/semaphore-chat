//! `ChatPane`: a conversation inside the centre island (`frontend/src/kit/chat/ChatPane.tsx`).

use super::child_id;
use crate::kit::live::live_node;
use gpui_kit::accesskit::Live;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{SPACE_LG, SPACE_SM, SPACE_XS};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

type DropHandler = Rc<dyn Fn(&[PathBuf], &mut Window, &mut App)>;
type OverHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

/// Header, the message list with its floating typing line and Jump to latest, and the composer.
/// It owns the placement of the floating parts, so a screen never positions anything itself. The
/// list region gets the room the header and the composer leave; only the list scrolls. A `cover`
/// (a thread) fills the pane over the conversation, which stays drawn underneath (so its list
/// scroll and its composer's draft are kept) but hidden: not painted, not focusable, not pressable
/// and not announced until the cover goes.
#[derive(IntoElement)]
pub struct ChatPane {
    id: ElementId,
    header: Option<AnyElement>,
    list: Option<AnyElement>,
    state: Option<AnyElement>,
    typing: Option<AnyElement>,
    jump: Option<AnyElement>,
    announcement: Option<SharedString>,
    composer: Option<AnyElement>,
    cover: Option<AnyElement>,
    list_foot: Option<AnyElement>,
    on_drop_files: Option<DropHandler>,
    on_files_over: Option<OverHandler>,
}

impl ChatPane {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            header: None,
            list: None,
            state: None,
            typing: None,
            jump: None,
            announcement: None,
            composer: None,
            cover: None,
            list_foot: None,
            on_drop_files: None,
            on_files_over: None,
        }
    }

    /// Something placed in the list region, which is `relative` and ends where the composer
    /// starts: the screen's toast anchor, so the window's toasts sit above the composer (#900).
    /// Left out while a `cover` is up, like the announcement.
    pub fn list_foot(mut self, element: impl IntoElement) -> Self {
        self.list_foot = Some(element.into_any_element());
        self
    }

    /// The conversation's header: Back, its name, its buttons. Stays at the top.
    pub fn header(mut self, header: impl IntoElement) -> Self {
        self.header = Some(header.into_any_element());
        self
    }

    /// The message list. Fills what is left and scrolls inside itself.
    pub fn list(mut self, list: impl IntoElement) -> Self {
        self.list = Some(list.into_any_element());
        self
    }

    /// Shown in the list region in place of the list, centred with room around it: skeleton rows,
    /// an empty channel, no access, an error with Try again.
    pub fn state(mut self, state: impl IntoElement) -> Self {
        self.state = Some(state.into_any_element());
        self
    }

    /// The typing line, floating at the bottom of the list region.
    pub fn typing(mut self, typing: impl IntoElement) -> Self {
        self.typing = Some(typing.into_any_element());
        self
    }

    /// A JumpToLatest, floating over the bottom of the list region.
    pub fn jump(mut self, jump: impl IntoElement) -> Self {
        self.jump = Some(jump.into_any_element());
        self
    }

    /// New messages the reader cannot see, said politely ("2 new messages from aiko"). Never
    /// shown. A change of the words is a new announcement.
    pub fn announcement(mut self, words: impl Into<SharedString>) -> Self {
        self.announcement = Some(words.into());
        self
    }

    /// The composer, under the list.
    pub fn composer(mut self, composer: impl IntoElement) -> Self {
        self.composer = Some(composer.into_any_element());
        self
    }

    /// A second conversation over this one, filling the pane (a thread over its channel).
    pub fn cover(mut self, cover: impl IntoElement) -> Self {
        self.cover = Some(cover.into_any_element());
        self
    }

    /// Files dropped anywhere on the conversation (they go to its composer). Not on a covered
    /// pane: the cover has its own.
    pub fn on_drop_files(
        mut self,
        handler: impl Fn(&[PathBuf], &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_drop_files = Some(Rc::new(handler));
        self
    }

    /// Files are dragged over the conversation (true) or have left it (false): the composer's
    /// drop look. A drag that is over something in front of the pane (a dialog, the image viewer)
    /// counts as off it, so the look goes rather than stays while the files are over that.
    pub fn on_files_over(
        mut self,
        handler: impl Fn(bool, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_files_over = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for ChatPane {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let covered = self.cover.is_some();
        let drop = (!covered).then_some(self.on_drop_files).flatten();
        let over = (!covered).then_some(self.on_files_over).flatten();
        let over_now = window
            .use_keyed_state(child_id(&self.id, "files-over"), cx, |_, _| {
                Rc::new(Cell::new(false))
            })
            .read(cx)
            .clone();
        // The pane's own hitbox of the last frame, so a drag's position can be hit-tested: a
        // point over something that occludes the pane is not over the pane.
        let probe = window
            .use_keyed_state(child_id(&self.id, "drag-probe"), cx, |_, _| {
                Rc::new(RefCell::new(None::<Hitbox>))
            })
            .read(cx)
            .clone();

        let region = div()
            .relative()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .map(|region| match self.state {
                Some(state) => region.child(
                    div()
                        .id(child_id(&self.id, "state"))
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .justify_center()
                        .p(px(SPACE_LG))
                        .child(state),
                ),
                None => region.children(self.list),
            })
            .children(
                self.typing
                    .map(|typing| div().absolute().left_0().right_0().bottom_0().child(typing)),
            )
            .children(self.jump)
            // Under a cover the conversation is laid out but not painted: an anchor here would
            // claim the window's toasts and draw none, so the cover's own placement wins.
            .children(self.list_foot.filter(|_| !covered))
            .children(
                self.announcement
                    .filter(|words| !covered && !words.is_empty())
                    .map(|words| live_node(child_id(&self.id, "announce"), words, Live::Polite)),
            );

        let base = div()
            .id(child_id(&self.id, "base"))
            .test_support()
            .size_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .children(self.header.map(|header| {
                div()
                    .flex_none()
                    .min_w_0()
                    .pt(px(SPACE_SM))
                    .px(px(SPACE_SM))
                    .pb(px(SPACE_XS))
                    .child(header)
            }))
            .child(region)
            .children(
                self.composer
                    .map(|composer| div().flex_none().min_w_0().child(composer)),
            )
            .when_some(drop, |base, drop| {
                let over = over.clone();
                let over_now = over_now.clone();
                base.on_drop(move |paths: &ExternalPaths, window, cx| {
                    if over_now.replace(false)
                        && let Some(over) = &over
                    {
                        over(false, window, cx);
                    }
                    drop(paths.paths(), window, cx);
                })
            })
            .when_some(over.clone(), |base, over| {
                let over_now = over_now.clone();
                // A drag that leaves the window or is cancelled sends no mouse move.
                base.on_file_drop_exit(move |_, window, cx| {
                    if over_now.replace(false) {
                        over(false, window, cx);
                    }
                })
            })
            .when_some(over.clone(), |base, over| {
                // Some platforms end a drag with neither a drop nor an exit. A file drag reaches
                // the window as moves with the button held, so the first move without it, or a
                // release, means the drag is over and clears the drop look.
                let stale = {
                    let over_now = over_now.clone();
                    move |window: &mut Window, cx: &mut App| {
                        if over_now.replace(false) {
                            over(false, window, cx);
                        }
                    }
                };
                let on_up = stale.clone();
                base.on_mouse_move(move |event: &MouseMoveEvent, window, cx| {
                    if event.pressed_button.is_none() {
                        stale(window, cx)
                    }
                })
                .on_mouse_up(MouseButton::Left, move |_, window, cx| on_up(window, cx))
            })
            .when_some(over, |base, over| {
                let probe = probe.clone();
                base.on_drag_move(move |event: &DragMoveEvent<ExternalPaths>, window, cx| {
                    let position = event.event.position;
                    let inside = match probe.borrow().as_ref() {
                        Some(pane) => pane.is_hovered_at(position, window),
                        // No probe yet (the frame that drew the pane is not the last one): the
                        // pane's box is the best answer, as before.
                        None => event.bounds.contains(&position),
                    };
                    if over_now.replace(inside) != inside {
                        over(inside, window, cx);
                    }
                })
            });

        div()
            .id(self.id)
            .test_support()
            .relative()
            .size_full()
            .min_h_0()
            .min_w_0()
            .overflow_hidden()
            .child(DragProbe {
                slot: probe,
                body: div().absolute().inset_0(),
            })
            .child(Inert {
                inert: covered,
                child: base.into_any_element(),
            })
            .children(self.cover.map(|cover| {
                div()
                    .absolute()
                    .inset_0()
                    .occlude()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .min_w_0()
                    .child(cover)
            }))
    }
}

/// A layer over the whole pane that inserts a hitbox and keeps it, so a drag's position can be
/// hit-tested against the pane ([`Hitbox::is_hovered_at`]). A normal hitbox neither blocks nor
/// handles anything: it is hovered only where the pane is at the front of the window, so a point
/// over something that occludes the pane (`occlude`, as a dialog and the image viewer do) is not
/// on it. The hitbox is a frame old while an event is dispatched, which is the frame the drag is
/// over.
struct DragProbe {
    slot: Rc<RefCell<Option<Hitbox>>>,
    body: Div,
}

impl IntoElement for DragProbe {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for DragProbe {
    type RequestLayoutState = <Div as Element>::RequestLayoutState;
    type PrepaintState = Option<Hitbox>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        self.body.request_layout(id, inspector, window, cx)
    }

    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let hitbox = self
            .body
            .prepaint(id, inspector, bounds, layout, window, cx);
        self.slot
            .replace(Some(window.insert_hitbox(bounds, HitboxBehavior::Normal)));
        hitbox
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        layout: &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.body
            .paint(id, inspector, bounds, layout, hitbox, window, cx);
    }
}

/// The conversation under a cover: still rendered and laid out, so its element state and its
/// layout are kept, but not prepainted or painted, so nothing in it is drawn, focusable,
/// pressable or in the accessibility tree (GPUI builds a node's accessibility entry, its tab stop
/// and its hitbox in those steps). A list that must keep its scroll under a cover keeps its
/// `ListState` or `ScrollHandle` in the screen, as a screen does anyway.
struct Inert {
    inert: bool,
    child: AnyElement,
}

impl IntoElement for Inert {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for Inert {
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
        (self.child.request_layout(window, cx), ())
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
        if !self.inert {
            self.child.prepaint(window, cx);
        }
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
        if !self.inert {
            self.child.paint(window, cx);
        }
    }
}
