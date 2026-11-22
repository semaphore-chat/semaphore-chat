//! The Lounge frame as a view, at a phone's, a tablet's and a desktop's width: the dock, the
//! sheet's foot, the Members button and the right content's close, the side panel's height, the
//! phone's panes and focus, the side panel's drawer (Escape, the scrim, focus), and the members'
//! long press. The shell is inside a `BehaviourRoot`, as in the app, so Escape, presses and focus
//! go through the window's overlay stack.

use super::press::LONG_PRESS;
use super::source::{Load, MemberRow, RailCounts, ShellSource};
use super::{ContentSlot, Shell, ShellEvent};
use crate::kit::{BehaviourRoot, PhonePane};
use crate::messages::fixture::{self, Body};
use crate::messages::{ListData, ListOptions, ListStatus, MessageList, NoMedia};
use crate::nav::Route;
use core::prelude::v1::test;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use semaphore_core::ConnectionState;
use semaphore_core::model::{
    ChannelKind, ChannelRow, CommunityCaps, CommunityRow, SessionState, UserView, VoiceRoom,
    VoiceStatus, VoiceView,
};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

const WIDTHS: [f32; 3] = [390., 900., 1280.];

struct Couch;

fn user(id: &str) -> UserView {
    UserView {
        id: id.into(),
        username: id.into(),
        display_name: None,
        avatar_file_id: None,
    }
}

fn channel(id: &str, kind: ChannelKind, position: i32) -> ChannelRow {
    ChannelRow {
        id: id.into(),
        community_id: "c1".into(),
        name: id.into(),
        kind,
        is_private: false,
        position,
        unread_count: 0,
        mention_count: 0,
        voice_users: Vec::new(),
        slowmode_seconds: 0,
        permissions: None,
        preset: Default::default(),
    }
}

impl ShellSource for Couch {
    fn session(&self) -> SessionState {
        SessionState::SignedIn { me: user("me") }
    }
    fn communities(&self) -> Load<Vec<CommunityRow>> {
        Load::Ready(vec![CommunityRow {
            id: "c1".into(),
            name: "Couch Co-op".into(),
            avatar_file_id: None,
            unread_count: 0,
            mention_count: 0,
        }])
    }
    fn channels(&self, _: &str) -> Load<Vec<ChannelRow>> {
        Load::Ready(vec![
            channel("general", ChannelKind::Text, 0),
            channel("squad", ChannelKind::Voice, 1),
        ])
    }
    fn members(&self, _: &str) -> Load<Vec<MemberRow>> {
        Load::Ready(vec![MemberRow {
            user: user("ana"),
            status: None,
            online: true,
            display_role: None,
        }])
    }
    fn rail_counts(&self) -> RailCounts {
        RailCounts::default()
    }
    fn voice(&self) -> VoiceView {
        VoiceView::default()
    }
    fn can_create_community(&self) -> bool {
        true
    }
}

type Events = Rc<RefCell<Vec<ShellEvent>>>;
type Asked = Rc<RefCell<Vec<bool>>>;

/// The window's root, as the app's: the shell inside a `BehaviourRoot`.
struct Host {
    shell: Entity<Shell>,
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        BehaviourRoot::new(div().size_full().child(self.shell.clone()))
    }
}

/// A shell on `route` in a `width` x 800 window, recording its events and every content slot's
/// `take_focus`.
fn shell(
    cx: &mut TestAppContext,
    width: f32,
    route: Route,
) -> (Entity<Shell>, &mut VisualTestContext, Events, Asked) {
    shell_on(cx, width, route, Rc::new(Couch))
}

/// [`shell`] on another source.
fn shell_on(
    cx: &mut TestAppContext,
    width: f32,
    route: Route,
    source: Rc<dyn ShellSource>,
) -> (Entity<Shell>, &mut VisualTestContext, Events, Asked) {
    let asked: Asked = Rc::default();
    let seen = asked.clone();
    let content: ContentSlot = Rc::new(move |props, _, _| {
        // Only what's on screen: the owner is also told when its content isn't.
        if props.shown {
            seen.borrow_mut().push(props.take_focus);
        }
        div().size_full().into_any_element()
    });
    shell_with(cx, width, route, source, content, None, asked)
}

/// [`shell_on`], with the content slot and the frame's call slot the test chooses.
fn shell_with(
    cx: &mut TestAppContext,
    width: f32,
    route: Route,
    source: Rc<dyn ShellSource>,
    content: ContentSlot,
    voice_bar: Option<crate::shell::VoiceBarSlot>,
    asked: Asked,
) -> (Entity<Shell>, &mut VisualTestContext, Events, Asked) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        crate::kit::set_reduced_motion(true, cx);
        crate::messages::init(cx);
    });
    // Under gpui-kit's window root, as `gpui_kit::open_window` puts every app view: it moves
    // focus on Tab.
    let made: Rc<RefCell<Option<Entity<Shell>>>> = Rc::default();
    let keep = made.clone();
    let (_, cx) = cx.add_window_view(move |window, cx| {
        let shell = cx.new(|cx| {
            let shell = Shell::new(
                source,
                route,
                content,
                ConnectionState::Connected,
                window,
                cx,
            )
            .with_instance_label("moss.social");
            match voice_bar {
                Some(bar) => shell.with_voice_bar(bar),
                None => shell,
            }
        });
        *keep.borrow_mut() = Some(shell.clone());
        let host = cx.new(|_| Host { shell });
        gpui_kit::base::Root::new(host, window, cx)
    });
    let view = made.borrow().clone().expect("built");
    // An active window, as the app's: keys reach focus and Tab moves it.
    cx.update(|window, _| window.activate_window());
    cx.simulate_resize(size(px(width), px(800.)));
    let events: Events = Rc::default();
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event: &ShellEvent, _| {
            sink.borrow_mut().push(event.clone());
        })
        .detach();
    });
    draw(cx);
    (view, cx, events, asked)
}

fn general() -> Route {
    Route::Channel {
        community_id: "c1".into(),
        channel_id: "general".into(),
    }
}

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
    cx.run_until_parked();
}

fn has(cx: &mut VisualTestContext, id: &str) -> bool {
    let id = id.to_owned();
    cx.update(|window, _| window.try_find(id).is_some())
}

fn click(cx: &mut VisualTestContext, id: &str) {
    let id = id.to_owned();
    cx.update(|window, cx| window.click(id, cx));
    draw(cx);
}

fn count(events: &Events, matches: impl Fn(&ShellEvent) -> bool) -> usize {
    events
        .borrow()
        .iter()
        .filter(|event| matches(event))
        .count()
}

// ---------------------------------------------------------------------------------------------
// The dock and the sheet

#[gpui_kit::test]
fn the_dock_opens_a_community_and_the_inbox_at_every_width(cx: &mut TestAppContext) {
    for width in WIDTHS {
        let (view, cx, _, _) = shell(cx, width, Route::DirectMessages);
        click(cx, "community-c1");
        let route = view.read_with(cx, |shell, _| shell.nav().current().clone());
        assert_eq!(route.community_id(), Some("c1"), "at {width}");
        click(cx, "dock-inbox");
        let route = view.read_with(cx, |shell, _| shell.nav().current().clone());
        assert_eq!(route, Route::DirectMessages, "at {width}");
    }
}

#[gpui_kit::test]
fn the_sheets_foot_has_notifications_everywhere_and_the_account_on_a_phone(
    cx: &mut TestAppContext,
) {
    for width in WIDTHS {
        let (_, cx, events, _) = shell(cx, width, general());
        click(cx, "dock-all");
        assert!(has(cx, "sheet-notifications"), "at {width}");
        assert!(has(cx, "sheet-create-community"), "at {width}");
        assert_eq!(has(cx, "sheet-settings"), width < 600., "at {width}");
        click(cx, "sheet-notifications");
        assert_eq!(
            count(&events, |event| matches!(
                event,
                ShellEvent::OpenNotifications
            )),
            1,
            "at {width}"
        );
        assert!(!has(cx, "sheet-notifications"), "the row closes the sheet");
    }
}

// ---------------------------------------------------------------------------------------------
// The members and the right content

#[gpui_kit::test]
fn the_members_show_beside_at_wide_and_on_request_below(cx: &mut TestAppContext) {
    for width in WIDTHS {
        let (_, cx, _, _) = shell(cx, width, general());
        if width < 600. {
            // A phone on a channel shows the centre, whose header has Members.
            assert!(has(cx, "phone-back"));
        }
        assert_eq!(has(cx, "member-ana"), width >= 1200., "default at {width}");
        click(cx, "members-toggle");
        assert_eq!(has(cx, "member-ana"), width < 1200., "toggled at {width}");
    }
}

#[gpui_kit::test]
fn escape_closes_the_members_sheet_below_wide(cx: &mut TestAppContext) {
    let (view, cx, _, _) = shell(cx, 900., general());
    click(cx, "members-toggle");
    assert!(has(cx, "member-ana"));
    cx.update(|window, cx| window.press("escape", cx));
    draw(cx);
    assert!(!has(cx, "member-ana"));
    assert_eq!(view.read_with(cx, |shell, _| shell.right_open), Some(false));
}

/// Stands in for pins: the side panel the owner opens.
struct Pins;

impl Render for Pins {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().id("pins-panel").test_support().size_full()
    }
}

fn closes(events: &Events) -> usize {
    count(events, |event| matches!(event, ShellEvent::CloseSidePanel))
}

fn open_pins(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    cx.update(|_, cx| {
        let pins = cx.new(|_| Pins);
        view.update(cx, |shell, cx| shell.set_side_panel(Some(pins.into()), cx));
    });
    draw(cx);
}

/// The members were hidden, so they show only because Members asked for them.
#[gpui_kit::test]
fn members_replace_an_open_side_panel(cx: &mut TestAppContext) {
    let (view, cx, events, _) = shell(cx, 1280., general());
    click(cx, "members-toggle");
    assert!(!has(cx, "member-ana"), "hidden first");
    cx.update(|window, cx| {
        let pins = cx.new(|_| Pins);
        view.update(cx, |shell, cx| shell.set_side_panel(Some(pins.into()), cx));
        window.refresh();
    });
    draw(cx);
    assert!(has(cx, "pins-panel"));
    assert!(!has(cx, "member-ana"), "the panel takes the members' place");
    click(cx, "members-toggle");
    assert_eq!(closes(&events), 1);
    view.update(cx, |shell, cx| shell.set_side_panel(None, cx));
    draw(cx);
    assert!(
        has(cx, "member-ana"),
        "and the members show once it's closed"
    );
}

/// The community header's members button is the same action as the centre header's.
#[gpui_kit::test]
fn the_community_headers_members_button_replaces_an_open_side_panel(cx: &mut TestAppContext) {
    let (view, cx, events, _) = shell(cx, 1280., general());
    click(cx, "members-toggle");
    open_pins(&view, cx);
    assert!(has(cx, "community-members"), "offered while pins show");
    click(cx, "community-members");
    assert_eq!(closes(&events), 1, "it asks the owner to close pins");
    view.update(cx, |shell, cx| shell.set_side_panel(None, cx));
    draw(cx);
    assert!(has(cx, "member-ana"), "the members replace the panel");
}

fn bounds_of(cx: &mut VisualTestContext, id: &str) -> Bounds<Pixels> {
    let id = id.to_owned();
    cx.update(|window, _| window.try_find(id.clone()).expect("drawn").bounds())
}

/// Below wide the side panel is a drawer: 400 px at the right edge, full height, or the whole
/// window on a phone; a press on the dimmed page asks the owner to close it.
#[gpui_kit::test]
fn a_side_panels_drawer_and_its_scrim_below_wide(cx: &mut TestAppContext) {
    for width in [599., 900.] {
        let (view, cx, events, _) = shell(cx, width, general());
        open_pins(&view, cx);
        let drawer = bounds_of(cx, "drawer-panel");
        let expected_width = if width < 600. { width } else { 400. };
        assert_eq!(drawer.size.width, px(expected_width), "at {width}");
        assert_eq!(drawer.size.height, px(800.), "full height at {width}");
        assert_eq!(drawer.right(), px(width), "at the right edge at {width}");
        assert!(has(cx, "pins-panel"));
        if width >= 600. {
            // The scrim's left part, clear of the drawer.
            let at = point(px(40.), px(400.));
            cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
            cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
            draw(cx);
            assert_eq!(closes(&events), 1, "the scrim at {width}");
        } else {
            cx.update(|window, cx| window.press("escape", cx));
            draw(cx);
            assert_eq!(closes(&events), 1, "Escape closes the phone's at {width}");
        }
    }
}

/// A panel with two controls that take focus, as pins' Close and a row.
struct FocusPanel {
    root: FocusHandle,
    inner: FocusHandle,
    second: FocusHandle,
}

impl Render for FocusPanel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("pins-panel")
            .test_support()
            .track_focus(&self.root)
            .size_full()
            .child(
                div()
                    .id("panel-inner")
                    .track_focus(&self.inner)
                    .child("inner"),
            )
            .child(
                div()
                    .id("panel-second")
                    .track_focus(&self.second)
                    .child("second"),
            )
    }
}

/// The drawer is a modal layer: Escape closes it from wherever focus is, focus moves in as it
/// opens, Tab stays inside, and focus goes back to the opener as it closes.
#[gpui_kit::test]
fn the_drawer_takes_focus_traps_tab_closes_on_escape_and_gives_focus_back(cx: &mut TestAppContext) {
    for width in [390., 900.] {
        let (view, cx, events, _) = shell(cx, width, general());
        // Escape from outside the panel: focus is on the shell, not in the drawer.
        open_pins(&view, cx);
        cx.update(|window, cx| {
            let shell_focus = view.read(cx).focus.clone();
            window.focus(&shell_focus, cx);
        });
        draw(cx);
        cx.update(|window, cx| window.press("escape", cx));
        draw(cx);
        assert_eq!(closes(&events), 1, "Escape from anywhere at {width}");
        view.update(cx, |shell, cx| shell.set_side_panel(None, cx));
        draw(cx);

        let opener = cx
            .update(|window, cx| window.focused(cx))
            .expect("focus somewhere");
        let (root, inner, second) = cx.update(|_, cx| {
            let root = cx.focus_handle();
            let inner = cx.focus_handle().tab_stop(true);
            let second = cx.focus_handle().tab_stop(true);
            let panel = cx.new(|_| FocusPanel {
                root: root.clone(),
                inner: inner.clone(),
                second: second.clone(),
            });
            view.update(cx, |shell, cx| shell.set_side_panel(Some(panel.into()), cx));
            (root, inner, second)
        });
        draw(cx);
        assert!(
            cx.update(|window, _| inner.is_focused(window)),
            "focus moves to the drawer's first control at {width}"
        );
        // Tab moves between the two and wraps round inside, never to the shell under the scrim.
        for press in 1..=6 {
            cx.update(|window, cx| window.press("tab", cx));
            draw(cx);
            let on = if press % 2 == 1 { &second } else { &inner };
            assert!(
                cx.update(|window, _| on.is_focused(window)),
                "Tab {press} stays in the drawer at {width}"
            );
        }
        assert!(cx.update(|window, cx| root.contains_focused(window, cx)));
        cx.update(|window, cx| window.press("escape", cx));
        draw(cx);
        assert_eq!(closes(&events), 2, "Escape from inside at {width}");
        view.update(cx, |shell, cx| shell.set_side_panel(None, cx));
        draw(cx);
        assert!(
            cx.update(|window, _| opener.is_focused(window)),
            "focus goes back to the opener at {width}"
        );
    }
}

/// A thread's panel: a header over a real message list that fills the rest, as `ThreadPane`.
struct Thread {
    list: Entity<MessageList>,
}

impl Render for Thread {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(div().h(px(48.)).child("Thread"))
            .child(div().flex_1().min_h_0().child(self.list.clone()))
    }
}

#[gpui_kit::test]
fn a_side_panels_list_gets_the_height_at_every_width(cx: &mut TestAppContext) {
    for width in WIDTHS {
        let (view, cx, _, _) = shell(cx, width, general());
        cx.update(|_, cx| {
            let list = cx.new(|cx| {
                let rows = (0..20)
                    .map(|seq| {
                        fixture::message(
                            seq,
                            fixture::me(),
                            fixture::NOW_MS + seq * 60_000,
                            Body::default().text(&format!("reply {seq}")),
                        )
                    })
                    .collect();
                MessageList::new(
                    ListData {
                        me_id: "me".into(),
                        rows,
                        replies: HashMap::new(),
                        status: ListStatus::Ready,
                    },
                    Rc::new(NoMedia),
                    ListOptions {
                        scrollbar: false,
                        ..ListOptions::default()
                    },
                    cx,
                )
            });
            let thread = cx.new(|_| Thread { list });
            view.update(cx, |shell, cx| {
                shell.set_side_panel(Some(thread.into()), cx)
            });
        });
        draw(cx);
        // A list with no height draws one row (its bottom padding is all it gets); with the
        // panel's height it draws many.
        let drawn = cx.update(|window, _| {
            (0..20u64)
                .filter(|index| {
                    window
                        .try_find(ElementId::NamedInteger("message".into(), *index))
                        .is_some_and(|row| row.visible())
                })
                .count()
        });
        assert!(
            drawn >= 10,
            "the replies get the panel's height at {width}: {drawn} rows drawn"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The phone's panes and focus

/// A source in a call in Squad Up, for the frame's call slot.
struct InCall;

fn call_voice() -> VoiceView {
    VoiceView {
        status: VoiceStatus::Connected,
        channel_id: Some("squad".into()),
        room: Some(VoiceRoom::Channel {
            channel_id: "squad".into(),
            community_id: Some("c1".into()),
        }),
        ..VoiceView::default()
    }
}

impl ShellSource for InCall {
    fn session(&self) -> SessionState {
        Couch.session()
    }
    fn communities(&self) -> Load<Vec<CommunityRow>> {
        Couch.communities()
    }
    fn channels(&self, community_id: &str) -> Load<Vec<ChannelRow>> {
        Couch.channels(community_id)
    }
    fn members(&self, community_id: &str) -> Load<Vec<MemberRow>> {
        Couch.members(community_id)
    }
    fn rail_counts(&self) -> RailCounts {
        Couch.rail_counts()
    }
    fn voice(&self) -> VoiceView {
        call_voice()
    }
    fn can_create_community(&self) -> bool {
        Couch.can_create_community()
    }
}

#[gpui_kit::test]
fn a_phone_back_from_the_call_view_keeps_the_call_bar(cx: &mut TestAppContext) {
    // The app's content slot: it reports the stage as shown only while the centre is drawn.
    let voice = call_voice();
    let stage_shown: Rc<Cell<bool>> = Rc::default();
    let showing = stage_shown.clone();
    let content: ContentSlot = Rc::new(move |props, _, _| {
        showing.set(props.call_stage_drawn(&voice));
        div().size_full().into_any_element()
    });
    // The app's call slot: no bar while the stage draws its own controls.
    let drawn = stage_shown.clone();
    let bar: crate::shell::VoiceBarSlot = Rc::new(move |_, _| {
        (!drawn.get()).then(|| div().id("frame-call-bar").test_support().into())
    });
    let route = Route::Channel {
        community_id: "c1".into(),
        channel_id: "squad".into(),
    };
    let (view, cx, _, _) = shell_with(
        cx,
        390.,
        route,
        Rc::new(InCall),
        content,
        Some(bar),
        Rc::default(),
    );
    assert!(has(cx, "phone-back"));
    assert!(!has(cx, "frame-call-bar"), "the stage's own bar");
    // Back to the left pane: the route is still the call's channel, nothing of the stage shows,
    // so the bar must.
    click(cx, "phone-back");
    assert_eq!(
        view.read_with(cx, |shell, _| shell.phone_pane),
        PhonePane::Left
    );
    assert!(
        has(cx, "frame-call-bar"),
        "left pane in front: nobody loses Mute, Deafen and Leave"
    );
    // Its channel row shows the centre again, with the stage.
    click(cx, "channel-squad");
    assert!(!has(cx, "frame-call-bar"));
}

#[gpui_kit::test]
fn a_phone_asks_the_composer_for_focus_only_when_the_centre_shows(cx: &mut TestAppContext) {
    let (view, cx, _, asked) = shell(cx, 390., Route::DirectMessages);
    asked.borrow_mut().clear();
    // What the dock's community does: the community's home, its left pane.
    click(cx, "community-c1");
    assert_eq!(
        view.read_with(cx, |shell, _| shell.phone_pane),
        PhonePane::Left
    );
    assert!(
        !asked.borrow().contains(&true),
        "no focus for a centre that isn't drawn: {:?}",
        asked.borrow()
    );
    // Tab still moves focus, onto a control that is drawn.
    let before = cx.update(|window, cx| window.focused(cx));
    cx.update(|window, cx| window.press("tab", cx));
    draw(cx);
    let after = cx.update(|window, cx| window.focused(cx));
    assert!(after.is_some() && after != before, "Tab moved focus");
    // Its channel row shows the centre, which takes the focus then.
    click(cx, "channel-general");
    assert_eq!(
        view.read_with(cx, |shell, _| shell.phone_pane),
        PhonePane::Centre
    );
    assert!(asked.borrow().contains(&true), "{:?}", asked.borrow());
}

// ---------------------------------------------------------------------------------------------
// The members' long press

fn row_centre(cx: &mut VisualTestContext) -> Point<Pixels> {
    cx.update(|window, _| {
        window
            .try_find("member-ana")
            .expect("ana's row is drawn")
            .bounds()
            .center()
    })
}

fn menus(events: &Events) -> usize {
    count(
        events,
        |event| matches!(event, ShellEvent::MemberMenu { user_id, .. } if user_id == "ana"),
    )
}

fn profiles(events: &Events) -> usize {
    count(events, |event| {
        matches!(event, ShellEvent::OpenProfile { .. })
    })
}

#[gpui_kit::test]
fn a_long_press_on_a_phone_opens_the_menu_and_its_release_isnt_a_click(cx: &mut TestAppContext) {
    let (_, cx, events, _) = shell(cx, 390., general());
    click(cx, "members-toggle");
    let at = row_centre(cx);
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.executor()
        .advance_clock(LONG_PRESS - Duration::from_millis(1));
    draw(cx);
    assert_eq!(menus(&events), 0, "not yet");
    cx.executor().advance_clock(Duration::from_millis(2));
    draw(cx);
    assert_eq!(menus(&events), 1, "held long enough");
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(
        profiles(&events),
        0,
        "the release that ends it opens nothing"
    );

    // A short tap is a click: the profile, and no menu after it.
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    cx.executor().advance_clock(LONG_PRESS * 2);
    draw(cx);
    assert_eq!((menus(&events), profiles(&events)), (1, 1));

    // A drag past the slop cancels it.
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    let away = point(at.x, at.y + px(40.));
    cx.simulate_mouse_move(away, Some(MouseButton::Left), Modifiers::default());
    cx.executor().advance_clock(LONG_PRESS * 2);
    draw(cx);
    assert_eq!(menus(&events), 1, "a drag isn't a long press");
}

#[gpui_kit::test]
fn a_held_mouse_on_a_desktop_is_no_long_press(cx: &mut TestAppContext) {
    let (_, cx, events, _) = shell(cx, 1280., general());
    let at = row_centre(cx);
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.executor().advance_clock(LONG_PRESS * 2);
    draw(cx);
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!((menus(&events), profiles(&events)), (0, 1));
}

// ---------------------------------------------------------------------------------------------
// The community home (B12)

/// Couch Co-op with only its voice room, where the user may create channels; or, with `lists`
/// set, every list in that load state.
struct RoomsOnly {
    lists: Option<Load<()>>,
}

fn rooms_only() -> Rc<dyn ShellSource> {
    Rc::new(RoomsOnly { lists: None })
}

fn as_load<T>(lists: &Load<()>, ready: impl FnOnce() -> T) -> Load<T> {
    match lists {
        Load::Loading => Load::Loading,
        Load::Failed(error) => Load::Failed(error.clone()),
        Load::Ready(()) => Load::Ready(ready()),
    }
}

impl ShellSource for RoomsOnly {
    fn session(&self) -> SessionState {
        Couch.session()
    }
    fn communities(&self) -> Load<Vec<CommunityRow>> {
        match &self.lists {
            Some(lists) => as_load(lists, Vec::new),
            None => Couch.communities(),
        }
    }
    fn channels(&self, _: &str) -> Load<Vec<ChannelRow>> {
        Load::Ready(vec![channel("squad", ChannelKind::Voice, 1)])
    }
    fn members(&self, id: &str) -> Load<Vec<MemberRow>> {
        Couch.members(id)
    }
    fn rail_counts(&self) -> RailCounts {
        RailCounts::default()
    }
    fn voice(&self) -> VoiceView {
        VoiceView::default()
    }
    fn community_caps(&self, _: &str) -> CommunityCaps {
        CommunityCaps {
            create_channel: true,
            ..CommunityCaps::default()
        }
    }
}

/// Couch Co-op's channels loaded while the communities are still on their way.
struct CommunitiesLoading;

impl ShellSource for CommunitiesLoading {
    fn session(&self) -> SessionState {
        Couch.session()
    }
    fn communities(&self) -> Load<Vec<CommunityRow>> {
        Load::Loading
    }
    fn channels(&self, id: &str) -> Load<Vec<ChannelRow>> {
        Couch.channels(id)
    }
    fn members(&self, id: &str) -> Load<Vec<MemberRow>> {
        Couch.members(id)
    }
    fn rail_counts(&self) -> RailCounts {
        RailCounts::default()
    }
    fn voice(&self) -> VoiceView {
        VoiceView::default()
    }
}

fn couch() -> Route {
    Route::Community {
        community_id: "c1".into(),
    }
}

fn pane(view: &Entity<Shell>, cx: &mut VisualTestContext) -> PhonePane {
    view.read_with(cx, |shell, _| shell.phone_pane)
}

#[gpui_kit::test]
fn a_phone_opening_a_community_shows_its_home_though_the_route_settles(cx: &mut TestAppContext) {
    // Opening the community (the app's first landing does this) settles on its first text
    // channel, and a phone shows the home: its channels and rooms.
    let (view, cx, _, _) = shell(cx, 390., Route::DirectMessages);
    view.update(cx, |shell, cx| shell.navigate(couch(), cx));
    draw(cx);
    assert_eq!(
        view.read_with(cx, |shell, _| shell.nav().current().clone()),
        general()
    );
    assert_eq!(pane(&view, cx), PhonePane::Left);
    assert!(has(cx, "channel-general"));
    // A channel shows the chat; Back from it is the home again.
    click(cx, "channel-general");
    assert_eq!(pane(&view, cx), PhonePane::Centre);
    click(cx, "phone-back");
    assert_eq!(pane(&view, cx), PhonePane::Left);
}

#[gpui_kit::test]
fn a_phone_deep_link_to_a_community_shows_its_home(cx: &mut TestAppContext) {
    let (view, cx, _, _) = shell(cx, 390., Route::DirectMessages);
    let opened = view.update(cx, |shell, cx| {
        shell.open_deep_link(
            "semaphore://community/00000000-0000-4000-8000-000000000001",
            cx,
        )
    });
    draw(cx);
    assert!(opened);
    assert_eq!(pane(&view, cx), PhonePane::Left);
}

#[gpui_kit::test]
fn a_phone_home_shows_the_owner_nothing(cx: &mut TestAppContext) {
    // The home settles on #general, but its chat isn't on screen: the owner is never asked to
    // show it, so it marks nothing read (only `shown` calls are recorded).
    let (view, cx, _, asked) = shell(cx, 390., Route::DirectMessages);
    asked.borrow_mut().clear();
    view.update(cx, |shell, cx| shell.navigate(couch(), cx));
    draw(cx);
    assert_eq!(pane(&view, cx), PhonePane::Left);
    assert!(asked.borrow().is_empty(), "{:?}", asked.borrow());
    // The chat is.
    click(cx, "channel-general");
    assert!(!asked.borrow().is_empty());
}

#[gpui_kit::test]
fn back_returns_to_the_pane_each_entry_was_left_on(cx: &mut TestAppContext) {
    let (view, cx, _, _) = shell(cx, 390., Route::DirectMessages);
    let settings = || Route::Settings {
        tab: Default::default(),
    };
    // Left from the home: Back is the home, though its route is the channel's.
    view.update(cx, |shell, cx| shell.navigate(couch(), cx));
    view.update(cx, |shell, cx| shell.navigate(settings(), cx));
    assert_eq!(pane(&view, cx), PhonePane::Centre);
    view.update(cx, |shell, cx| shell.go_back(cx));
    assert_eq!(
        view.read_with(cx, |shell, _| shell.nav().current().clone()),
        general()
    );
    assert_eq!(pane(&view, cx), PhonePane::Left);
    // Left from the chat: Back is the chat.
    view.update(cx, |shell, cx| shell.navigate(general(), cx));
    view.update(cx, |shell, cx| {
        shell.phone_pane = PhonePane::Centre;
        shell.navigate(settings(), cx)
    });
    view.update(cx, |shell, cx| shell.go_back(cx));
    assert_eq!(pane(&view, cx), PhonePane::Centre);
    // And Back again, to the inbox's list.
    view.update(cx, |shell, cx| shell.go_back(cx));
    assert_eq!(
        view.read_with(cx, |shell, _| shell.nav().current().clone()),
        Route::DirectMessages
    );
    assert_eq!(pane(&view, cx), PhonePane::Left);
}

#[gpui_kit::test]
fn a_phone_on_a_channel_that_isnt_in_the_list_shows_the_list(cx: &mut TestAppContext) {
    let (view, cx, _, asked) = shell(cx, 390., Route::DirectMessages);
    asked.borrow_mut().clear();
    let gone = Route::Channel {
        community_id: "c1".into(),
        channel_id: "gone".into(),
    };
    view.update(cx, |shell, cx| shell.navigate(gone, cx));
    draw(cx);
    assert_eq!(pane(&view, cx), PhonePane::Left);
    assert!(has(cx, "channel-general"));
    assert!(!has(cx, "community-home"));
    assert!(asked.borrow().is_empty());
}

#[gpui_kit::test]
fn the_home_shows_in_the_centre_for_a_community_with_no_text_channel(cx: &mut TestAppContext) {
    for width in WIDTHS {
        let (view, cx, events, asked) = shell_on(cx, width, couch(), rooms_only());
        // Nothing to settle on: the route stays the community's, and the shell draws its home.
        assert_eq!(
            view.read_with(cx, |shell, _| shell.nav().current().clone()),
            couch()
        );
        asked.borrow_mut().clear();
        draw(cx);
        assert!(asked.borrow().is_empty(), "the owner draws no centre here");
        if width < 600. {
            // A phone shows the left pane, never this centre.
            assert_eq!(pane(&view, cx), PhonePane::Left);
            continue;
        }
        assert!(has(cx, "community-home"), "at {width}");
        assert!(has(cx, "community-home-title"), "at {width}");
        click(cx, "community-home-create");
        assert_eq!(
            count(&events, |event| matches!(
                event,
                ShellEvent::CreateChannel { community_id } if community_id == "c1"
            )),
            1,
            "at {width}"
        );
        // Members: beside the home at wide, a button below it that shows them.
        assert_eq!(
            has(cx, "community-home-members"),
            width < 1000.,
            "at {width}"
        );
        if width < 1000. {
            click(cx, "community-home-members");
            assert!(view.read_with(cx, |shell, _| shell.right_open == Some(true)));
            assert!(!has(cx, "community-home-members"), "at {width}");
        }
    }
}

#[gpui_kit::test]
fn the_home_has_the_load_faces_while_the_communities_load_or_fail(cx: &mut TestAppContext) {
    let (_, cx, _, _) = shell_on(
        cx,
        1280.,
        couch(),
        Rc::new(RoomsOnly {
            lists: Some(Load::Loading),
        }),
    );
    assert!(has(cx, "community-home-face"));
    assert!(!has(cx, "community-home-create"));
    // A channel's route too, with the channel in a loaded list: nothing of the community is
    // drawn until the communities are in, and the owner shows nothing.
    let (_, cx, _, asked) = shell_on(cx, 1280., general(), Rc::new(CommunitiesLoading));
    assert!(has(cx, "community-home-face"));
    assert!(asked.borrow().is_empty(), "{:?}", asked.borrow());
    let failed = Load::Failed(semaphore_core::model::ErrorView {
        code: "UNAVAILABLE".into(),
        message: "The server didn't answer.".into(),
        retryable: true,
        retry_after_ms: None,
    });
    let (_, cx, events, _) = shell_on(
        cx,
        1280.,
        couch(),
        Rc::new(RoomsOnly {
            lists: Some(failed),
        }),
    );
    click(cx, "community-home-load-error-action");
    assert_eq!(
        count(&events, |event| matches!(event, ShellEvent::Retry)),
        1
    );
}
