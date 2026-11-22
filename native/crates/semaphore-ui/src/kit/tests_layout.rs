//! Layout templates: the width ranges and their edges, where each template puts its panes, the
//! kept phone pane (state survives, nothing reachable), focus following the shown pane, the
//! right and side Sheets, the call slot's bounds, the banner row and where the toast region goes.

use super::layout::focus::{FocusMove, decide};
use super::{
    AppFrame, BehaviourRoot, CallStack, PANE_MIN, PhonePane, SettingsLayout, SettingsPane,
    StageLayout, ThreeIslands, ToastRequest, Toasts, WidthRange,
};
use crate::dms::rig::{Rig, rig_sized};
use core::prelude::v1::test;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_design::lounge::{
    BREAKPOINT_DOCKED, BREAKPOINT_PHONE, LAYOUT_DOCK, LAYOUT_GUTTER, LAYOUT_LEFT_COLUMN,
    LAYOUT_RIGHT_COLUMN, SPACE_SM,
};
use std::cell::RefCell;
use std::rc::Rc;

const G: f32 = LAYOUT_GUTTER;

/// What a test draws, changed between frames.
#[derive(Clone)]
struct Cfg {
    template: Template,
    pane: PhonePane,
    settings_pane: SettingsPane,
    right: bool,
    right_label: bool,
    right_open: Option<bool>,
    dock: bool,
    call: Call,
    footer: bool,
    banners: usize,
    strip: bool,
    side_open: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Template {
    Chat,
    Settings,
    Stage,
    Plain,
}

#[derive(Clone, Copy, PartialEq)]
enum Call {
    None,
    Bar,
    Stack,
    StackNoSurface,
}

impl Default for Cfg {
    fn default() -> Self {
        Self {
            template: Template::Chat,
            pane: PhonePane::Centre,
            settings_pane: SettingsPane::Nav,
            right: true,
            right_label: true,
            right_open: None,
            dock: true,
            call: Call::None,
            footer: true,
            banners: 0,
            strip: true,
            side_open: false,
        }
    }
}

type Shared = Rc<RefCell<Cfg>>;
type Log = Rc<RefCell<Vec<String>>>;

struct Probes {
    focus: Rc<RefCell<Vec<(&'static str, FocusHandle)>>>,
    /// How many times each keyed-state probe was created.
    made: Rc<RefCell<Vec<(&'static str, u32)>>>,
}

struct Host {
    cfg: Shared,
    log: Log,
    probes: Rc<Probes>,
}

impl EventEmitter<()> for Host {}

fn block(id: &'static str, height: f32) -> AnyElement {
    div()
        .id(id)
        .test_support()
        .flex_none()
        .h(px(height))
        .into_any_element()
}

/// A focusable box, with its handle kept for the test.
fn focusable(id: &'static str, probes: &Probes, cx: &mut App) -> AnyElement {
    let handle = {
        let mut focus = probes.focus.borrow_mut();
        match focus.iter().find(|(name, _)| *name == id) {
            Some((_, handle)) => handle.clone(),
            None => {
                let handle = cx.focus_handle().tab_stop(true);
                focus.push((id, handle.clone()));
                handle
            }
        }
    };
    div()
        .id(id)
        .test_support()
        .track_focus(&handle)
        .h(px(20.))
        .into_any_element()
}

/// Keyed state, counting how often it is made: made once means it survived.
#[derive(IntoElement)]
struct Keyed {
    name: &'static str,
    made: Rc<RefCell<Vec<(&'static str, u32)>>>,
}

impl RenderOnce for Keyed {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let made = self.made.clone();
        let name = self.name;
        window.use_keyed_state(name, cx, move |_, _| {
            let mut made = made.borrow_mut();
            match made.iter_mut().find(|(known, _)| *known == name) {
                Some((_, count)) => *count += 1,
                None => made.push((name, 1)),
            }
        });
        div().h(px(4.))
    }
}

fn rows(prefix: &'static str, count: usize) -> Div {
    div().flex().flex_col().children((0..count).map(|n| {
        div()
            .id(SharedString::from(format!("{prefix}-row-{n}")))
            .test_support()
            .flex_none()
            .h(px(40.))
    }))
}

impl Host {
    fn chat(&self, cfg: &Cfg, cx: &mut App) -> AnyElement {
        let probes = &self.probes;
        let left = div()
            .child(focusable("left-focus", probes, cx))
            .child(Keyed {
                name: "left-keyed",
                made: probes.made.clone(),
            })
            .child(rows("left", 40));
        let centre = div()
            .child(focusable("centre-focus", probes, cx))
            .child(Keyed {
                name: "centre-keyed",
                made: probes.made.clone(),
            })
            .child(block("centre-body", 100.));
        let log = self.log.clone();
        let mut chat = ThreeIslands::new(left, "Channels", centre, "general")
            .phone_pane(cfg.pane)
            .right_open(cfg.right_open)
            .on_right_close(move |_, _| log.borrow_mut().push("right-close".into()));
        if cfg.right {
            chat = chat.right(div().child(focusable("right-focus", probes, cx)));
            if cfg.right_label {
                chat = chat.right_label("Members");
            }
        }
        if cfg.dock {
            chat = chat.dock(block("dock", LAYOUT_DOCK));
        }
        chat = match cfg.call {
            Call::None => chat,
            Call::Bar => chat.call_bar(block("bar", 48.)),
            Call::Stack => chat.call_bar(
                CallStack::new(block("bar", 48.))
                    .surface(block("surface-content", 2000.))
                    .summary(block("summary", 20.)),
            ),
            Call::StackNoSurface => chat.call_bar(CallStack::new(block("bar", 48.))),
        };
        chat.into_any_element()
    }

    fn settings(&self, cfg: &Cfg, cx: &mut App) -> AnyElement {
        let probes = &self.probes;
        let log = self.log.clone();
        let mut settings = SettingsLayout::new(
            "Community settings",
            div()
                .child(focusable("nav-focus", probes, cx))
                .child(rows("nav", 3)),
            "Settings sections",
            div()
                .child(focusable("content-focus", probes, cx))
                .child(Keyed {
                    name: "content-keyed",
                    made: probes.made.clone(),
                })
                .child(rows("content", 40)),
            move |_, _| log.borrow_mut().push("back".into()),
        )
        .phone_pane(cfg.settings_pane);
        if cfg.footer {
            settings = settings.footer(block("footer-content", 40.));
        }
        settings.into_any_element()
    }

    fn stage(&self, cfg: &Cfg) -> AnyElement {
        let log = self.log.clone();
        let mut stage = StageLayout::new(
            block("header-content", 24.),
            div()
                .id("stage-content")
                .test_support()
                .w(px(4000.))
                .h(px(3000.)),
            block("controls-content", 40.),
            "Squad Up",
        )
        .side(block("people", 40.))
        .side_open(cfg.side_open)
        .on_side_close(move |_, _| log.borrow_mut().push("side-close".into()));
        if cfg.strip {
            stage = stage.strip(block("strip-content", 60.));
        }
        stage.into_any_element()
    }
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let cfg = self.cfg.borrow().clone();
        let template = match cfg.template {
            Template::Chat => self.chat(&cfg, cx),
            Template::Settings => self.settings(&cfg, cx),
            Template::Stage => self.stage(&cfg),
            Template::Plain => block("plain", 100.),
        };
        let mut frame = AppFrame::new(template);
        for n in 0..cfg.banners {
            frame = frame.banner(block(["banner-0", "banner-1", "banner-2"][n], 30.));
        }
        BehaviourRoot::new(div().size_full().child(frame))
    }
}

struct T {
    rig: Rig<Host, ()>,
    cfg: Shared,
    log: Log,
    probes: Rc<Probes>,
}

fn open(cx: &mut TestAppContext, width: f32, height: f32, cfg: Cfg) -> T {
    let shared: Shared = Rc::new(RefCell::new(cfg));
    let log: Log = Rc::default();
    let probes = Rc::new(Probes {
        focus: Rc::default(),
        made: Rc::default(),
    });
    let (c, l, p) = (shared.clone(), log.clone(), probes.clone());
    let rig = rig_sized(cx, width, height, move |_, _| Host {
        cfg: c,
        log: l,
        probes: p,
    });
    let t = T {
        rig,
        cfg: shared,
        log,
        probes,
    };
    t.redraw(cx);
    t
}

impl T {
    fn redraw(&self, cx: &mut TestAppContext) {
        self.rig
            .with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
        self.rig.with(cx, |_, _, _| ());
    }

    fn set(&self, cx: &mut TestAppContext, change: impl FnOnce(&mut Cfg)) {
        change(&mut self.cfg.borrow_mut());
        self.redraw(cx);
    }

    fn resize(&self, cx: &mut TestAppContext, width: f32, height: f32) {
        cx.simulate_window_resize(self.rig.window, size(px(width), px(height)));
        self.redraw(cx);
    }

    fn bounds(&self, cx: &mut TestAppContext, id: &'static str) -> Bounds<Pixels> {
        self.rig
            .with(cx, move |_, window, _| window.find(id).bounds())
    }

    fn has(&self, cx: &mut TestAppContext, id: &'static str) -> bool {
        self.rig.has(cx, id)
    }

    fn focus(&self, cx: &mut TestAppContext, id: &'static str) {
        let handle = self.handle(id);
        self.rig
            .with(cx, move |_, window, cx| window.focus(&handle, cx));
        self.redraw(cx);
    }

    fn handle(&self, id: &'static str) -> FocusHandle {
        self.probes
            .focus
            .borrow()
            .iter()
            .find(|(name, _)| *name == id)
            .map(|(_, handle)| handle.clone())
            .unwrap_or_else(|| panic!("no focus probe {id}"))
    }

    fn is_focused(&self, cx: &mut TestAppContext, id: &'static str) -> bool {
        let handle = self.handle(id);
        self.rig
            .with(cx, move |_, window, _| handle.is_focused(window))
    }

    /// Whether the layout moved focus to this pane (its own handle is the one focused).
    fn focus_in(&self, cx: &mut TestAppContext, pane: &'static str) -> bool {
        self.rig.with(cx, move |_, window, _| {
            window.find(pane).focused() == Some(true)
        })
    }

    fn made(&self, name: &'static str) -> u32 {
        self.probes
            .made
            .borrow()
            .iter()
            .find(|(known, _)| *known == name)
            .map_or(0, |(_, count)| *count)
    }

    fn log(&self) -> Vec<String> {
        self.log.borrow().clone()
    }

    fn roles(&self, cx: &mut TestAppContext, role: Role) -> Vec<String> {
        self.rig.with(cx, move |_, window, _| {
            window
                .find_all_by_role(role)
                .iter()
                .map(|element| element.label().unwrap_or("").to_string())
                .collect()
        })
    }
}

trait Num {
    fn f32(self) -> f32;
}

impl Num for f32 {
    fn f32(self) -> f32 {
        self
    }
}

impl Num for Pixels {
    fn f32(self) -> f32 {
        f32::from(self)
    }
}

fn close(a: Pixels, b: f32) -> bool {
    (f32::from(a) - b).abs() <= 1.
}

macro_rules! near {
    ($a:expr, $b:expr) => {{
        let (a, b) = ($a, Num::f32($b));
        assert!(close(a, b), "{} = {a:?}, expected {b}", stringify!($a));
    }};
}

// ---------------------------------------------------------------------------------------------
// Width ranges and the focus rule

#[test]
fn width_ranges_split_at_the_breakpoint_tokens() {
    let of = |width: f32| WidthRange::of(px(width));
    assert_eq!(of(0.), WidthRange::Phone);
    assert_eq!(of(BREAKPOINT_PHONE - 0.5), WidthRange::Phone);
    assert_eq!(of(BREAKPOINT_PHONE - 0.01), WidthRange::Phone);
    assert_eq!(of(BREAKPOINT_PHONE), WidthRange::Compact);
    assert_eq!(of(BREAKPOINT_DOCKED - 0.01), WidthRange::Compact);
    assert_eq!(of(BREAKPOINT_DOCKED), WidthRange::Wide);
    assert_eq!(of(100_000.), WidthRange::Wide);
    assert_eq!(of(-1.), WidthRange::Phone);
    assert_eq!(of(f32::NAN), WidthRange::Phone);
    assert!(of(0.).is_phone() && !of(0.).is_wide());
    assert!(of(BREAKPOINT_DOCKED).is_wide() && !of(BREAKPOINT_DOCKED).is_phone());
    let compact = of(BREAKPOINT_PHONE);
    assert!(!compact.is_phone() && !compact.is_wide());
}

#[test]
fn focus_moves_only_when_its_pane_stops_being_shown() {
    use FocusMove::*;
    // In a shown pane: stays.
    assert_eq!(decide(Some(1), true, Some(1), &[0, 1]), Stay);
    // In a pane no longer shown: to the target.
    assert_eq!(decide(Some(0), true, Some(0), &[1]), ToTarget);
    assert_eq!(decide(Some(2), true, None, &[0, 1]), ToTarget);
    // Dropped right after being in a pane that is gone: to the target.
    assert_eq!(decide(None, false, Some(0), &[1]), ToTarget);
    // Dropped, but the pane it was in is still shown: stays (nothing to follow).
    assert_eq!(decide(None, false, Some(1), &[1]), Stay);
    // Elsewhere (an overlay, outside the layout): left alone.
    assert_eq!(decide(None, true, Some(0), &[1]), Stay);
    // Never in a pane: left alone.
    assert_eq!(decide(None, false, None, &[]), Stay);
}

/// What CallStack's cap is built on: a direct child's percentage max height resolves against a
/// flex column of definite height.
#[gpui_kit::test]
fn taffy_resolves_a_percentage_max_height_in_a_flex_column(cx: &mut TestAppContext) {
    struct Probe;
    impl EventEmitter<()> for Probe {}
    impl Render for Probe {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().p(px(16.)).flex().flex_col().child(
                div().flex_1().min_h_0().flex().flex_row().child(
                    div()
                        .id("column")
                        .test_support()
                        .w(px(200.))
                        .flex()
                        .flex_col()
                        .child(div().flex_1().min_h_0())
                        .child(
                            div()
                                .id("surface")
                                .test_support()
                                .flex_shrink(1.)
                                .min_h_0()
                                .max_h(relative(0.4))
                                .overflow_y_scroll()
                                .child(div().h(px(2000.))),
                        )
                        .child(div().id("bar").test_support().h(px(48.)).flex_none()),
                ),
            )
        }
    }
    let rig: Rig<Probe, ()> = rig_sized(cx, 400., 1000., |_, _| Probe);
    rig.with(cx, |_, window, _| {
        let column = f32::from(window.find("column").bounds().size.height);
        near!(window.find("surface").bounds().size.height, column * 0.4);
        near!(window.find("bar").bounds().size.height, 48.);
    });
}

// ---------------------------------------------------------------------------------------------
// ThreeIslands: placement

#[gpui_kit::test]
fn three_islands_wide_places_dock_left_centre_and_right(cx: &mut TestAppContext) {
    let t = open(cx, 1280., 800., Cfg::default());
    let left = t.bounds(cx, "three-islands-left");
    let centre = t.bounds(cx, "three-islands-centre");
    let right = t.bounds(cx, "three-islands-right");
    let dock = t.bounds(cx, "dock");
    near!(dock.origin.x, G);
    near!(dock.origin.y, G);
    near!(dock.size.height, LAYOUT_DOCK);
    near!(left.origin.x, G);
    near!(left.size.width, LAYOUT_LEFT_COLUMN);
    near!(left.origin.y, G + LAYOUT_DOCK + G);
    near!(left.bottom(), 800. - G);
    near!(centre.origin.x, G + LAYOUT_LEFT_COLUMN + G);
    near!(centre.origin.y, G);
    near!(centre.bottom(), 800. - G);
    near!(right.size.width, LAYOUT_RIGHT_COLUMN);
    near!(right.right(), 1280. - G);
    near!(right.origin.x, f32::from(centre.right()) + G);
    assert!(!t.has(cx, "sheet-panel"));
}

#[gpui_kit::test]
fn three_islands_landmarks_in_reading_order(cx: &mut TestAppContext) {
    let t = open(cx, 1280., 800., Cfg::default());
    // In reading order: the navigation, the main, the complementary landmark, left to right.
    let order = t.rig.with(cx, |_, window, _| {
        let mut landmarks: Vec<_> = window
            .elements()
            .into_iter()
            .filter(|element| {
                matches!(
                    element.role(),
                    Some(Role::Navigation | Role::Main | Role::Complementary)
                )
            })
            .map(|element| {
                (
                    element.bounds().origin.x,
                    element.label().unwrap_or("").to_string(),
                )
            })
            .collect();
        landmarks.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("a number"));
        landmarks
            .into_iter()
            .map(|(_, label)| label)
            .collect::<Vec<_>>()
    });
    assert_eq!(order, ["Channels", "general", "Members"]);
    assert_eq!(t.roles(cx, Role::Main), ["general"]);
    assert_eq!(t.roles(cx, Role::Navigation), ["Channels"]);
    assert_eq!(t.roles(cx, Role::Complementary), ["Members"]);
    // Without a label the right island and the Sheet are "Details".
    t.set(cx, |cfg| cfg.right_label = false);
    assert_eq!(t.roles(cx, Role::Complementary), ["Details"]);
}

#[gpui_kit::test]
fn the_right_island_closes_at_wide_and_the_centre_takes_the_room(cx: &mut TestAppContext) {
    let t = open(cx, 1280., 800., Cfg::default());
    t.set(cx, |cfg| cfg.right_open = Some(false));
    assert!(!t.has(cx, "three-islands-right"));
    assert!(!t.has(cx, "sheet-panel"));
    assert!(t.roles(cx, Role::Complementary).is_empty());
    near!(t.bounds(cx, "three-islands-centre").right(), 1280. - G);
    // No right content: no region at any width, even asked open.
    t.set(cx, |cfg| {
        cfg.right = false;
        cfg.right_open = Some(true);
    });
    assert!(!t.has(cx, "three-islands-right"));
    t.resize(cx, 900., 800.);
    assert!(!t.has(cx, "sheet-panel"));
}

#[gpui_kit::test]
fn below_wide_the_right_content_is_a_sheet_only_while_open(cx: &mut TestAppContext) {
    // Left out: closed below wide, so a resize never opens a Sheet by itself.
    let t = open(cx, 900., 800., Cfg::default());
    assert!(!t.has(cx, "three-islands-right"));
    assert!(!t.has(cx, "sheet-panel"));
    near!(t.bounds(cx, "three-islands-centre").right(), 900. - G);
    t.set(cx, |cfg| cfg.right_open = Some(true));
    assert!(t.has(cx, "sheet-panel"));
    assert!(t.has(cx, "right-focus"));
    assert!(!t.has(cx, "three-islands-right"));
    t.rig.click(cx, "sheet-close");
    assert_eq!(t.log(), ["right-close"]);
    // Growing to wide with it open: an island, no Sheet.
    t.resize(cx, 1280., 800.);
    assert!(t.has(cx, "three-islands-right"));
    assert!(!t.has(cx, "sheet-panel"));
    // Left out again, and narrowing: closed.
    t.set(cx, |cfg| cfg.right_open = None);
    t.resize(cx, 1199., 800.);
    assert!(!t.has(cx, "sheet-panel"));
    t.resize(cx, 1200., 800.);
    assert!(t.has(cx, "three-islands-right"));
}

#[gpui_kit::test]
fn compact_keeps_the_left_column_and_no_right_island(cx: &mut TestAppContext) {
    let t = open(cx, BREAKPOINT_PHONE, 800., Cfg::default());
    let left = t.bounds(cx, "three-islands-left");
    let centre = t.bounds(cx, "three-islands-centre");
    near!(left.size.width, LAYOUT_LEFT_COLUMN);
    near!(centre.origin.x, G + LAYOUT_LEFT_COLUMN + G);
    near!(centre.right(), BREAKPOINT_PHONE - G);
    assert!(!t.has(cx, "three-islands-right"));
}

#[gpui_kit::test]
fn a_phone_shows_one_pane_then_the_dock_bar(cx: &mut TestAppContext) {
    let t = open(cx, 390., 844., Cfg::default());
    assert!(!t.has(cx, "three-islands-left"));
    let centre = t.bounds(cx, "three-islands-centre");
    let dock = t.bounds(cx, "dock");
    near!(centre.origin.x, G);
    near!(centre.size.width, 390. - 2. * G);
    near!(centre.origin.y, G);
    near!(dock.origin.y, f32::from(centre.bottom()) + G);
    near!(dock.bottom(), 844. - G);
    assert_eq!(t.roles(cx, Role::Main), ["general"]);
    // The left pane, which is then the main; the centre is kept but not drawn.
    t.set(cx, |cfg| cfg.pane = PhonePane::Left);
    assert!(!t.has(cx, "three-islands-centre"));
    assert!(!t.has(cx, "centre-focus"));
    let left = t.bounds(cx, "three-islands-left");
    near!(left.size.width, 390. - 2. * G);
    assert_eq!(t.roles(cx, Role::Main), [""]);
    assert_eq!(t.roles(cx, Role::Navigation), ["Channels"]);
    // No dock: the pane reaches the frame's foot.
    t.set(cx, |cfg| cfg.dock = false);
    near!(t.bounds(cx, "three-islands-left").bottom(), 844. - G);
}

// ---------------------------------------------------------------------------------------------
// ThreeIslands: the kept pane and focus

#[gpui_kit::test]
fn a_kept_pane_keeps_its_state_and_scroll_and_cannot_be_reached(cx: &mut TestAppContext) {
    let t = open(
        cx,
        390.,
        844.,
        Cfg {
            pane: PhonePane::Left,
            ..Cfg::default()
        },
    );
    let before = t.bounds(cx, "left-row-0").origin.y;
    t.rig.with(cx, |_, window, cx| {
        window.scroll(
            "left-row-3",
            ScrollDelta::Pixels(point(px(0.), px(-200.))),
            cx,
        )
    });
    let scrolled = t.bounds(cx, "left-row-0").origin.y;
    assert!(scrolled < before - px(100.), "{scrolled:?} {before:?}");
    // Away and back: same scroll, the state made once.
    t.set(cx, |cfg| cfg.pane = PhonePane::Centre);
    assert!(!t.has(cx, "left-row-0"));
    assert!(!t.has(cx, "left-focus"));
    assert!(t.roles(cx, Role::Navigation).is_empty());
    t.set(cx, |cfg| cfg.pane = PhonePane::Left);
    assert_eq!(t.bounds(cx, "left-row-0").origin.y, scrolled);
    assert_eq!(t.made("left-keyed"), 1);
    assert_eq!(t.made("centre-keyed"), 1);
    // Across a resize to wide and back, too.
    t.resize(cx, 1280., 844.);
    assert!(t.has(cx, "three-islands-centre"));
    t.resize(cx, 390., 844.);
    assert_eq!(t.bounds(cx, "left-row-0").origin.y, scrolled);
    assert_eq!(t.made("left-keyed"), 1);
    assert_eq!(t.made("centre-keyed"), 1);
}

#[gpui_kit::test]
fn focus_follows_the_shown_pane_on_a_phone(cx: &mut TestAppContext) {
    let t = open(
        cx,
        390.,
        844.,
        Cfg {
            pane: PhonePane::Left,
            ..Cfg::default()
        },
    );
    t.focus(cx, "left-focus");
    assert!(t.is_focused(cx, "left-focus"));
    t.set(cx, |cfg| cfg.pane = PhonePane::Centre);
    assert!(!t.is_focused(cx, "left-focus"));
    assert!(t.focus_in(cx, "three-islands-centre"));
    // And back.
    t.focus(cx, "centre-focus");
    t.set(cx, |cfg| cfg.pane = PhonePane::Left);
    assert!(t.focus_in(cx, "three-islands-left"));
}

#[gpui_kit::test]
fn focus_follows_when_the_width_hides_its_pane(cx: &mut TestAppContext) {
    let t = open(cx, 1280., 800., Cfg::default());
    // In the right island, which goes when the window narrows: to the centre.
    t.focus(cx, "right-focus");
    t.resize(cx, 900., 800.);
    assert!(t.focus_in(cx, "three-islands-centre"));
    // In the left column, which a phone showing the centre hides.
    t.focus(cx, "left-focus");
    t.resize(cx, 390., 800.);
    assert!(t.focus_in(cx, "three-islands-centre"));
}

#[gpui_kit::test]
fn focus_in_a_shown_pane_or_elsewhere_is_left_alone(cx: &mut TestAppContext) {
    let t = open(cx, 1280., 800., Cfg::default());
    t.focus(cx, "left-focus");
    t.resize(cx, 900., 800.);
    assert!(t.is_focused(cx, "left-focus"));
    // In the Sheet (an overlay, outside the panes), on a phone: switching the shown pane, there
    // and back, leaves it.
    t.resize(cx, 390., 844.);
    t.set(cx, |cfg| cfg.right_open = Some(true));
    assert!(t.has(cx, "sheet-panel"));
    t.focus(cx, "right-focus");
    t.set(cx, |cfg| cfg.pane = PhonePane::Left);
    assert!(t.is_focused(cx, "right-focus"));
    assert!(!t.focus_in(cx, "three-islands-left"));
    t.set(cx, |cfg| cfg.pane = PhonePane::Centre);
    assert!(t.is_focused(cx, "right-focus"));
}

#[gpui_kit::test]
fn focus_in_a_toast_stays_on_a_phone_pane_switch(cx: &mut TestAppContext) {
    let t = open(cx, 390., 844., Cfg::default());
    show_toast(&t, cx);
    let region = t.rig.with(cx, |_, window, cx| {
        super::BehaviourHost::of(window, cx)
            .expect("host")
            .read(cx)
            .toasts
            .region
            .clone()
            .expect("region")
    });
    let r = region.clone();
    t.rig.with(cx, move |_, window, cx| window.focus(&r, cx));
    t.redraw(cx);
    let inside = |t: &T, cx: &mut TestAppContext| {
        let r = region.clone();
        t.rig
            .with(cx, move |_, window, cx| r.contains_focused(window, cx))
    };
    assert!(inside(&t, cx));
    t.set(cx, |cfg| cfg.pane = PhonePane::Left);
    // Not pulled into the pane now shown (the region is in that pane, so the pane still
    // contains it).
    assert!(inside(&t, cx), "focus stays in the toast");
}

#[gpui_kit::test]
fn closing_the_right_island_at_wide_moves_its_focus_to_the_centre(cx: &mut TestAppContext) {
    let t = open(cx, 1280., 800., Cfg::default());
    t.focus(cx, "right-focus");
    t.set(cx, |cfg| cfg.right_open = Some(false));
    assert!(t.focus_in(cx, "three-islands-centre"));
}

// ---------------------------------------------------------------------------------------------
// The call slot

#[gpui_kit::test]
fn the_call_bar_sits_under_the_left_island_at_compact_and_wide(cx: &mut TestAppContext) {
    for width in [900., 1280.] {
        let t = open(
            cx,
            width,
            800.,
            Cfg {
                call: Call::Bar,
                ..Cfg::default()
            },
        );
        let left = t.bounds(cx, "three-islands-left");
        let bar = t.bounds(cx, "kit-call-bar");
        near!(bar.origin.x, G);
        near!(bar.size.width, LAYOUT_LEFT_COLUMN);
        near!(bar.origin.y, f32::from(left.bottom()) + G);
        near!(bar.bottom(), 800. - G);
        near!(bar.size.height, 48.);
        // The centre still spans the whole height.
        near!(t.bounds(cx, "three-islands-centre").bottom(), 800. - G);
    }
}

#[gpui_kit::test]
fn a_phone_call_bar_sits_between_the_pane_and_the_dock(cx: &mut TestAppContext) {
    let t = open(
        cx,
        390.,
        844.,
        Cfg {
            call: Call::Bar,
            ..Cfg::default()
        },
    );
    let pane = t.bounds(cx, "three-islands-centre");
    let bar = t.bounds(cx, "kit-call-bar");
    let dock = t.bounds(cx, "dock");
    near!(bar.origin.y, f32::from(pane.bottom()) + G);
    near!(dock.origin.y, f32::from(bar.bottom()) + G);
    // It stays whichever pane shows.
    t.set(cx, |cfg| cfg.pane = PhonePane::Left);
    assert_eq!(t.bounds(cx, "kit-call-bar"), bar);
}

#[gpui_kit::test]
fn the_call_surface_takes_at_most_two_fifths_and_the_bar_stays_whole(cx: &mut TestAppContext) {
    for (width, height) in [(1280., 800.), (900., 1000.), (390., 844.)] {
        let t = open(
            cx,
            width,
            height,
            Cfg {
                call: Call::Stack,
                ..Cfg::default()
            },
        );
        let layout = t.bounds(cx, "three-islands").size.height;
        let surface = t.bounds(cx, "kit-call-surface");
        let bar = t.bounds(cx, "kit-call-bar");
        near!(surface.size.height, f32::from(layout) * 0.4);
        near!(bar.size.height, 48.);
        near!(bar.origin.y, f32::from(surface.bottom()) + SPACE_SM);
        // No summary without an on-screen keyboard.
        assert!(!t.has(cx, "summary"));
        // The surface scrolls inside itself.
        assert!(t.bounds(cx, "surface-content").size.height > surface.size.height);
    }
}

#[gpui_kit::test]
fn a_short_frame_shrinks_the_surface_never_the_bar_or_the_phone_pane(cx: &mut TestAppContext) {
    // Banners eat the height; the pane keeps a composer's height, the bar its own.
    let t = open(
        cx,
        390.,
        400.,
        Cfg {
            call: Call::Stack,
            banners: 3,
            ..Cfg::default()
        },
    );
    let pane = t.bounds(cx, "three-islands-centre");
    let bar = t.bounds(cx, "kit-call-bar");
    near!(pane.size.height, PANE_MIN);
    near!(bar.size.height, 48.);
    near!(t.bounds(cx, "dock").bottom(), 400. - G);
    let surface = t.bounds(cx, "kit-call-surface").size.height;
    let layout = t.bounds(cx, "three-islands").size.height;
    assert!(surface < layout * 0.4, "{surface:?} {layout:?}");
    // Without a call the pane has no minimum beyond the room.
    t.set(cx, |cfg| cfg.call = Call::None);
    assert!(t.bounds(cx, "three-islands-centre").size.height > px(PANE_MIN));
}

#[gpui_kit::test]
fn a_call_stack_without_a_surface_is_just_the_bar(cx: &mut TestAppContext) {
    let t = open(
        cx,
        1280.,
        800.,
        Cfg {
            call: Call::StackNoSurface,
            ..Cfg::default()
        },
    );
    assert!(!t.has(cx, "kit-call-surface"));
    let left = t.bounds(cx, "three-islands-left");
    near!(
        t.bounds(cx, "kit-call-bar").origin.y,
        f32::from(left.bottom()) + G
    );
}

// ---------------------------------------------------------------------------------------------
// SettingsLayout

#[gpui_kit::test]
fn settings_wide_and_compact_put_nav_beside_content(cx: &mut TestAppContext) {
    for width in [1280., 700.] {
        let t = open(
            cx,
            width,
            800.,
            Cfg {
                template: Template::Settings,
                ..Cfg::default()
            },
        );
        let nav = t.bounds(cx, "settings-layout-nav");
        let content = t.bounds(cx, "settings-layout-content");
        near!(nav.size.width, LAYOUT_LEFT_COLUMN);
        near!(content.origin.x, G + LAYOUT_LEFT_COLUMN + G);
        near!(content.right(), width - G);
        near!(content.bottom(), 800. - G);
        // The footer is pinned to the content island's foot, under the body.
        let footer = t.bounds(cx, "settings-layout-footer");
        near!(footer.bottom(), 800. - G);
        near!(
            t.bounds(cx, "settings-layout-body").bottom(),
            footer.origin.y
        );
        assert!(!t.has(cx, "settings-layout-header"));
        let heading = t.rig.with(cx, |_, window, _| {
            window.find("settings-layout-nav-title").role()
        });
        assert_eq!(heading, Some(Role::Heading));
        assert_eq!(t.roles(cx, Role::Main), ["Community settings"]);
        assert_eq!(t.roles(cx, Role::Navigation), ["Settings sections"]);
    }
}

#[gpui_kit::test]
fn settings_without_a_footer_leaves_no_bar(cx: &mut TestAppContext) {
    let t = open(
        cx,
        1280.,
        800.,
        Cfg {
            template: Template::Settings,
            footer: false,
            ..Cfg::default()
        },
    );
    assert!(!t.has(cx, "settings-layout-footer"));
    near!(t.bounds(cx, "settings-layout-body").bottom(), 800. - G);
}

#[gpui_kit::test]
fn a_phone_settings_page_shows_one_pane_with_back(cx: &mut TestAppContext) {
    let t = open(
        cx,
        390.,
        844.,
        Cfg {
            template: Template::Settings,
            ..Cfg::default()
        },
    );
    // The nav is the default, and the main.
    assert!(t.has(cx, "settings-layout-nav"));
    assert!(!t.has(cx, "settings-layout-content"));
    assert_eq!(t.roles(cx, Role::Main), [""]);
    near!(
        t.bounds(cx, "settings-layout-nav").size.width,
        390. - 2. * G
    );
    t.focus(cx, "nav-focus");
    t.set(cx, |cfg| cfg.settings_pane = SettingsPane::Content);
    assert!(t.has(cx, "settings-layout-header"));
    assert!(!t.has(cx, "settings-layout-nav"));
    assert!(t.focus_in(cx, "settings-layout-content"));
    assert_eq!(t.roles(cx, Role::Main), ["Community settings"]);
    let heading = t.rig.with(cx, |_, window, _| {
        window.find("settings-layout-header-title").role()
    });
    assert_eq!(heading, Some(Role::Heading));
    t.rig.click(cx, "settings-layout-back");
    assert_eq!(t.log(), ["back"]);
    // The content's state survives going back to the list and returning.
    t.set(cx, |cfg| cfg.settings_pane = SettingsPane::Nav);
    t.set(cx, |cfg| cfg.settings_pane = SettingsPane::Content);
    assert_eq!(t.made("content-keyed"), 1);
}

// ---------------------------------------------------------------------------------------------
// StageLayout

#[gpui_kit::test]
fn the_stage_holds_its_content_inside_and_the_controls_at_the_foot(cx: &mut TestAppContext) {
    for (width, height) in [(1280., 720.), (390., 844.)] {
        let t = open(
            cx,
            width,
            height,
            Cfg {
                template: Template::Stage,
                ..Cfg::default()
            },
        );
        let island = t.bounds(cx, "stage-layout-island");
        let stage = t.bounds(cx, "stage-layout-stage");
        let strip = t.bounds(cx, "stage-layout-strip");
        let controls = t.bounds(cx, "stage-layout-controls");
        near!(island.origin.x, G);
        near!(island.right(), width - G);
        near!(island.bottom(), height - G);
        near!(controls.bottom(), island.bottom());
        near!(strip.bottom(), controls.origin.y);
        near!(stage.bottom(), strip.origin.y);
        assert!(stage.size.height > px(100.));
        // The content is capped at the stage on both axes (a fixed size larger is clipped).
        let content = t.bounds(cx, "stage-layout-content");
        assert!(
            content.size.width <= stage.size.width,
            "{content:?} {stage:?}"
        );
        assert!(
            content.size.height <= stage.size.height,
            "{content:?} {stage:?}"
        );
        assert!(content.origin.x >= stage.origin.x && content.right() <= stage.right());
        assert!(content.origin.y >= stage.origin.y && content.bottom() <= stage.bottom());
        // As big as the stage less its padding: content that sizes itself to the room fills it.
        near!(content.size.height, stage.size.height);
        assert_eq!(t.roles(cx, Role::Main), ["Squad Up"]);
    }
}

#[gpui_kit::test]
fn no_strip_leaves_no_gap(cx: &mut TestAppContext) {
    let t = open(
        cx,
        1280.,
        720.,
        Cfg {
            template: Template::Stage,
            strip: false,
            ..Cfg::default()
        },
    );
    assert!(!t.has(cx, "stage-layout-strip"));
    let stage = t.bounds(cx, "stage-layout-stage");
    near!(
        stage.bottom(),
        t.bounds(cx, "stage-layout-controls").origin.y
    );
}

#[gpui_kit::test]
fn people_is_a_sheet_at_every_width(cx: &mut TestAppContext) {
    for width in [1280., 390.] {
        let t = open(
            cx,
            width,
            800.,
            Cfg {
                template: Template::Stage,
                ..Cfg::default()
            },
        );
        assert!(!t.has(cx, "sheet-panel"));
        t.set(cx, |cfg| cfg.side_open = true);
        assert!(t.has(cx, "sheet-panel"));
        assert!(t.has(cx, "people"));
        t.rig.click(cx, "sheet-close");
        assert_eq!(t.log(), ["side-close"]);
    }
}

// ---------------------------------------------------------------------------------------------
// AppFrame: banners and toasts

#[gpui_kit::test]
fn banners_stack_and_the_layout_fills_the_rest(cx: &mut TestAppContext) {
    let t = open(
        cx,
        1280.,
        800.,
        Cfg {
            banners: 2,
            ..Cfg::default()
        },
    );
    let first = t.bounds(cx, "banner-0");
    let second = t.bounds(cx, "banner-1");
    near!(first.origin.y, G);
    near!(second.origin.y, f32::from(first.bottom()) + SPACE_SM);
    let layout = t.bounds(cx, "three-islands");
    near!(layout.origin.y, f32::from(second.bottom()) + G);
    near!(layout.bottom(), 800. - G);
    // None: no row and no gap.
    t.set(cx, |cfg| cfg.banners = 0);
    assert!(!t.has(cx, "app-frame-banner"));
    near!(t.bounds(cx, "three-islands").origin.y, G);
}

fn show_toast(t: &T, cx: &mut TestAppContext) -> Bounds<Pixels> {
    t.rig.with(cx, |_, window, cx| {
        Toasts::of(window, cx)
            .expect("a host")
            .show(ToastRequest::new("Saved").id("saved"), cx);
    });
    t.redraw(cx);
    let regions = t
        .rig
        .with(cx, |_, window, _| window.find_all("kit-toast-region").len());
    assert_eq!(regions, 1, "exactly one toast region");
    t.bounds(cx, "kit-toast-region")
}

#[gpui_kit::test]
fn toasts_sit_in_the_main_pane_never_over_the_left_column(cx: &mut TestAppContext) {
    let t = open(
        cx,
        1280.,
        800.,
        Cfg {
            call: Call::Bar,
            ..Cfg::default()
        },
    );
    let toast = show_toast(&t, cx);
    let centre = t.bounds(cx, "three-islands-centre");
    assert!(centre.contains(&toast.origin) && toast.bottom() <= centre.bottom());
    // A phone showing the left pane: in the left pane, above the call bar.
    t.resize(cx, 390., 844.);
    t.set(cx, |cfg| cfg.pane = PhonePane::Left);
    let toast = show_toast(&t, cx);
    let left = t.bounds(cx, "three-islands-left");
    assert!(left.contains(&toast.origin) && toast.bottom() <= left.bottom());
    assert!(toast.bottom() <= t.bounds(cx, "kit-call-bar").origin.y);
}

#[gpui_kit::test]
fn toasts_sit_above_the_settings_footer_and_the_stage_controls(cx: &mut TestAppContext) {
    let t = open(
        cx,
        1280.,
        800.,
        Cfg {
            template: Template::Settings,
            ..Cfg::default()
        },
    );
    let toast = show_toast(&t, cx);
    let content = t.bounds(cx, "settings-layout-content");
    assert!(content.contains(&toast.origin));
    assert!(toast.bottom() <= t.bounds(cx, "settings-layout-footer").origin.y);
    t.set(cx, |cfg| cfg.template = Template::Stage);
    let toast = show_toast(&t, cx);
    assert!(toast.bottom() <= t.bounds(cx, "stage-layout-controls").origin.y);
}

#[gpui_kit::test]
fn a_frame_around_plain_content_draws_the_toast_region_itself(cx: &mut TestAppContext) {
    // Plain first, then a template, then plain again: the flag never carries over.
    let t = open(
        cx,
        1280.,
        800.,
        Cfg {
            template: Template::Plain,
            ..Cfg::default()
        },
    );
    let toast = show_toast(&t, cx);
    near!(toast.bottom(), 800. - 24.);
    t.set(cx, |cfg| cfg.template = Template::Chat);
    let toast = show_toast(&t, cx);
    assert!(t.bounds(cx, "three-islands-centre").contains(&toast.origin));
    t.set(cx, |cfg| cfg.template = Template::Plain);
    show_toast(&t, cx);
}

#[gpui_kit::test]
fn the_frame_is_the_ground_and_fills_the_window(cx: &mut TestAppContext) {
    let t = open(
        cx,
        1280.,
        800.,
        Cfg {
            template: Template::Plain,
            ..Cfg::default()
        },
    );
    let frame = t.bounds(cx, "app-frame");
    near!(frame.size.width, 1280.);
    near!(frame.size.height, 800.);
    near!(t.bounds(cx, "plain").origin.x, G);
    near!(t.bounds(cx, "plain").origin.y, G);
    // No landmark of its own.
    assert!(t.roles(cx, Role::Main).is_empty());
}

// ---------------------------------------------------------------------------------------------
// Kept panes and the overlay stack

/// A pane with an overlay in it, a click target and a Tab stop in each pane: the kept pane's
/// reachability and the overlay stack, with the reviewer's probes as tests.
mod kept_overlays {
    use super::*;
    use crate::kit::BehaviourHost;
    use crate::kit::{Menu, MenuItem, Sheet};
    use std::cell::Cell;

    #[derive(Clone, Default)]
    struct PCfg {
        pane: PhonePane,
        sheet_in_left: bool,
        menu_in_left: bool,
    }

    struct PHost {
        cfg: Rc<RefCell<PCfg>>,
        log: Log,
        left_clicks: Rc<Cell<u32>>,
        left_focus: FocusHandle,
        centre_focus: FocusHandle,
    }

    impl EventEmitter<()> for PHost {}

    impl Render for PHost {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let cfg = self.cfg.borrow().clone();
            let clicks = self.left_clicks.clone();
            let (sheet_log, menu_log, centre_log) =
                (self.log.clone(), self.log.clone(), self.log.clone());
            let sheet = cfg.sheet_in_left.then(|| {
                Sheet::new("probe-sheet", "Probe")
                    .body(div().h(px(20.)))
                    .on_request_close(move |reason, _, _| {
                        sheet_log.borrow_mut().push(format!("sheet:{reason:?}"))
                    })
            });
            let menu = cfg.menu_in_left.then(|| {
                div().absolute().top(px(300.)).left(px(40.)).child(
                    Menu::new("Probe menu", [MenuItem::new("pin", "Pin", |_, _| {})])
                        .id("probe-menu")
                        .on_close(move |reason, _, _| {
                            menu_log.borrow_mut().push(format!("menu:{reason:?}"))
                        }),
                )
            });
            let left = div()
                .child(
                    div()
                        .id("left-button")
                        .test_support()
                        .track_focus(&self.left_focus)
                        .w_full()
                        .h(px(200.))
                        .on_click(move |_, _, _| clicks.set(clicks.get() + 1)),
                )
                .children(sheet)
                .children(menu);
            let centre = div().child(
                div()
                    .id("centre-button")
                    .test_support()
                    .track_focus(&self.centre_focus)
                    .w_full()
                    .h(px(400.))
                    .on_click(move |_, _, _| centre_log.borrow_mut().push("centre-click".into())),
            );
            let chat = ThreeIslands::new(left, "Channels", centre, "general").phone_pane(cfg.pane);
            BehaviourRoot::new(div().size_full().child(AppFrame::new(chat)))
        }
    }

    struct P {
        rig: Rig<PHost, ()>,
        cfg: Rc<RefCell<PCfg>>,
        log: Log,
        left_clicks: Rc<Cell<u32>>,
    }

    fn popen(cx: &mut TestAppContext, width: f32, height: f32, cfg: PCfg) -> P {
        let shared = Rc::new(RefCell::new(cfg));
        let log: Log = Rc::default();
        let left_clicks = Rc::new(Cell::new(0));
        let (c, l, k) = (shared.clone(), log.clone(), left_clicks.clone());
        let rig = rig_sized(cx, width, height, move |_, cx| PHost {
            cfg: c,
            log: l,
            left_clicks: k,
            left_focus: cx.focus_handle().tab_stop(true),
            centre_focus: cx.focus_handle().tab_stop(true),
        });
        let p = P {
            rig,
            cfg: shared,
            log,
            left_clicks,
        };
        p.redraw(cx);
        p
    }

    impl P {
        fn redraw(&self, cx: &mut TestAppContext) {
            self.rig
                .with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
            self.rig.with(cx, |_, _, _| ());
        }
        fn set(&self, cx: &mut TestAppContext, change: impl FnOnce(&mut PCfg)) {
            change(&mut self.cfg.borrow_mut());
            self.redraw(cx);
        }
        fn resize(&self, cx: &mut TestAppContext, width: f32, height: f32) {
            cx.simulate_window_resize(self.rig.window, size(px(width), px(height)));
            self.redraw(cx);
        }
        fn layers(&self, cx: &mut TestAppContext) -> usize {
            self.rig.with(cx, |_, window, cx| {
                BehaviourHost::of(window, cx)
                    .expect("host")
                    .read(cx)
                    .overlay
                    .layers()
                    .len()
            })
        }
    }

    impl P {
        fn paused(&self, cx: &mut TestAppContext) -> bool {
            self.rig.with(cx, |_, window, cx| {
                BehaviourHost::of(window, cx)
                    .expect("host")
                    .read(cx)
                    .toasts
                    .state()
                    .paused
            })
        }

        fn show_toast(&self, cx: &mut TestAppContext) {
            self.rig.with(cx, |_, window, cx| {
                Toasts::of(window, cx)
                    .expect("a host")
                    .show(ToastRequest::new("Saved").id("saved"), cx);
            });
            self.redraw(cx);
        }
    }

    /// A real click where the kept pane's control is, and a Tab walk from the shown pane.
    #[gpui_kit::test]
    fn a_kept_pane_takes_no_clicks_and_no_tab(cx: &mut TestAppContext) {
        let p = popen(
            cx,
            390.,
            844.,
            PCfg {
                pane: PhonePane::Left,
                ..PCfg::default()
            },
        );
        let left = p
            .rig
            .with(cx, |_, window, _| window.find("left-button").bounds());
        p.rig.click(cx, "left-button");
        assert_eq!(p.left_clicks.get(), 1, "shown, it takes the click");
        p.set(cx, |cfg| cfg.pane = PhonePane::Centre);
        let centre = p
            .rig
            .with(cx, |_, window, _| window.find("centre-button").bounds());
        assert!(centre.contains(&left.center()));
        let offset = left.center() - centre.origin;
        p.rig.with(cx, move |_, window, cx| {
            window.click_at("centre-button", offset, cx)
        });
        assert_eq!(p.left_clicks.get(), 1, "kept, it takes none");
        assert_eq!(p.log.borrow().as_slice(), ["centre-click"]);
        let (lf, cf) = p.rig.with(cx, |view, _, cx| {
            let host = view.read(cx);
            (host.left_focus.clone(), host.centre_focus.clone())
        });
        p.rig.with(cx, move |_, window, cx| window.focus(&cf, cx));
        for _ in 0..6 {
            p.rig.with(cx, |_, window, cx| window.focus_next(cx));
            let l2 = lf.clone();
            assert!(!p.rig.with(cx, move |_, window, _| l2.is_focused(window)));
        }
    }

    /// A Sheet open in the left pane, then a phone showing the centre: the layer closes with the
    /// pane (nothing undrawn holds Escape, the scrim or the toasts), and opens again, drawn, when
    /// the pane is shown again.
    #[gpui_kit::test]
    fn a_sheet_in_a_pane_that_becomes_kept_leaves_the_stack(cx: &mut TestAppContext) {
        let p = popen(cx, 1280., 800., PCfg::default());
        p.set(cx, |cfg| cfg.sheet_in_left = true);
        assert!(p.rig.has(cx, "sheet-panel"));
        assert_eq!(p.layers(cx), 1);
        p.resize(cx, 390., 800.);
        p.redraw(cx);
        // An active window: inactive is a reason of its own to pause the toasts.
        p.rig.with(cx, |_, window, _| window.activate_window());
        assert!(!p.rig.has(cx, "sheet-panel"));
        assert_eq!(p.layers(cx), 0);
        p.show_toast(cx);
        assert!(!p.paused(cx), "the toast queue runs");
        p.rig.click(cx, "centre-button");
        p.rig.with(cx, |_, window, cx| window.press("escape", cx));
        assert_eq!(p.log.borrow().as_slice(), ["centre-click"]);
        // The pane shown again: the owner still has the sheet open, so it is drawn and a layer.
        p.set(cx, |cfg| cfg.pane = PhonePane::Left);
        p.redraw(cx);
        assert!(p.rig.has(cx, "sheet-panel"));
        assert_eq!(p.layers(cx), 1);
        assert!(p.paused(cx), "a sheet pauses the queue again");
        p.rig.with(cx, |_, window, cx| window.press("escape", cx));
        assert_eq!(
            p.log.borrow().last().map(String::as_str),
            Some("sheet:Escape")
        );
    }

    /// A Menu open in the left pane, then a phone showing the centre: no layer, and the centre's
    /// clicks reach the centre; shown again, the menu is a layer again.
    #[gpui_kit::test]
    fn a_menu_in_a_pane_that_becomes_kept_leaves_the_stack(cx: &mut TestAppContext) {
        let p = popen(cx, 1280., 800., PCfg::default());
        p.set(cx, |cfg| cfg.menu_in_left = true);
        assert!(p.rig.has(cx, "probe-menu"));
        assert_eq!(p.layers(cx), 1);
        p.resize(cx, 390., 800.);
        p.redraw(cx);
        assert!(!p.rig.has(cx, "probe-menu"));
        assert_eq!(p.layers(cx), 0);
        p.rig.click(cx, "centre-button");
        p.rig.click(cx, "centre-button");
        assert_eq!(p.log.borrow().as_slice(), ["centre-click", "centre-click"]);
        p.set(cx, |cfg| cfg.pane = PhonePane::Left);
        p.redraw(cx);
        assert!(p.rig.has(cx, "probe-menu"));
        assert_eq!(p.layers(cx), 1);
    }
}
