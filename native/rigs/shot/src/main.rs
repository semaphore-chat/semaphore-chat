//! Renders stories to PNGs, with no display server, and drives them through scripted steps.
//!
//!   rig-shot <story> <width> <height> <out.png> [--theme <mode>-<accent>-<intensity>]
//!   rig-shot --script <file.steps> --out <dir>
//!   rig-shot --list
//!
//! Stories come from `semaphore_ui::stories`. Run it from `native/`, where it finds
//! `fixtures/scenarios`. See [`script`] for the step language.
//!
//! Linux only for real pixels: GPUI has a headless WGPU renderer there and none on Windows.

mod script;

use anyhow::{Context as _, Result, anyhow, bail};
use gpui_kit::component::Root;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use image::RgbaImage;
use script::{Emit, Step};
use semaphore_core::ConnectionState;
use semaphore_core::CoreEvent;
use semaphore_core::model::{Conversation, ListOp, MessageRow, UserView, ViewKey};
use semaphore_ui::kit::{UiAssets, emit_core_event, set_reduced_motion};
use semaphore_ui::shell::stories_impl::ActiveFixture;
use semaphore_ui::stories::{self, StoryEnv, StoryRoot};
use semaphore_ui::theme::{self, ThemeChoice};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// `wait idle` gives up after this many rounds. Reaching it means something redraws forever.
const IDLE_ROUNDS: usize = 50;

struct Rig {
    cx: HeadlessAppContext,
    window: Option<AnyWindowHandle>,
    env: StoryEnv,
}

impl Rig {
    fn new() -> Self {
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(UiAssets),
            gpui_kit::platform::current_headless_renderer,
        );
        cx.update(|cx| {
            gpui_kit::init(cx);
            theme::init(cx);
            // A screenshot must not depend on when it caught an animation.
            set_reduced_motion(true, cx);
        });
        Self {
            cx,
            window: None,
            env: StoryEnv {
                scenarios_dir: "fixtures/scenarios".into(),
            },
        }
    }

    fn open(&mut self, name: &str, width: f32, height: f32, choice: ThemeChoice) -> Result<()> {
        if let Some(window) = self.window.take() {
            self.cx
                .update_window(window, |_, window, _| window.remove_window())
                .context("closing the last story")?;
        }
        let Some(story) = stories::find(name) else {
            bail!("unknown story {name}; rig-shot --list shows them");
        };
        let env = &self.env;
        self.cx.update(|cx| theme::apply(choice, cx));
        let (handle, _) = self
            .cx
            .update(|cx| {
                gpui_kit::open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Default::default(),
                            size: size(px(width), px(height)),
                        })),
                        focus: false,
                        show: false,
                        ..Default::default()
                    },
                    cx,
                    |window, cx| {
                        let view = (story.build)(env, window, cx);
                        let root = cx.new(|_| StoryRoot { view });
                        // The kit's overlays (select lists, tooltips) draw from the window's root.
                        cx.new(|cx| Root::new(root, window, cx))
                    },
                )
            })
            .context("opening the offscreen window")?;
        self.window = Some(handle);
        self.update(|window, cx| window.render_frame(cx))
    }

    fn update(&mut self, action: impl FnOnce(&mut Window, &mut App)) -> Result<()> {
        let window = self.window.ok_or_else(|| anyhow!("no story is open"))?;
        self.cx
            .update_window(window, |_, window, cx| action(window, cx))
            .context("updating the window")
    }

    fn query<R: Default>(&mut self, read: impl FnOnce(&Window) -> R) -> Result<R> {
        let mut result = R::default();
        self.update(|window, _| result = read(window))?;
        Ok(result)
    }

    /// Prints the roles and names GPUI's accessibility layer has, and fails on a control with no name.
    fn audit(&mut self) -> Result<()> {
        let lines: Vec<(String, String, bool)> = self.query(|window| {
            window
                .elements()
                .iter()
                .map(|element| {
                    let role = element
                        .role()
                        .map(|role| format!("{role:?}"))
                        .unwrap_or_default();
                    let mut label = element.label().unwrap_or_default().to_owned();
                    if element.focused() == Some(true) {
                        label.push_str(" [focused]");
                    }
                    let nameless = !role.is_empty() && element.label().is_none();
                    (role, label, nameless)
                })
                .collect()
        })?;
        let nameless = lines.iter().filter(|(_, _, bad)| *bad).count();
        println!(
            "audit: {} elements, {nameless} with a role and no name",
            lines.len()
        );
        for (role, label, bad) in &lines {
            if *bad {
                println!("  nameless {role}");
            } else {
                println!("  {role}: {label}");
            }
        }
        if nameless > 0 {
            bail!("{nameless} controls have no accessible name");
        }
        Ok(())
    }

    /// Runs what's queued and draws a frame, for a step that needs the current layout.
    fn settle(&mut self) -> Result<()> {
        self.cx.run_until_parked();
        self.update(|window, cx| window.render_frame(cx))
    }

    /// Until nothing's queued and two frames in a row have the same pixels. GPUI has no public "is
    /// this window dirty", and pixels are what a screenshot cares about anyway.
    fn wait_idle(&mut self) -> Result<RgbaImage> {
        let window = self.window.ok_or_else(|| anyhow!("no story is open"))?;
        let mut last: Option<RgbaImage> = None;
        for _ in 0..IDLE_ROUNDS {
            self.settle()?;
            let image = self
                .cx
                .capture_screenshot(window)
                .context("offscreen rendering is unavailable")?;
            if last
                .as_ref()
                .is_some_and(|last| last.as_raw() == image.as_raw())
            {
                return Ok(image);
            }
            last = Some(image);
        }
        bail!("the window was still changing after {IDLE_ROUNDS} frames");
    }

    fn shot(&mut self, out: &Path) -> Result<()> {
        let image = self.wait_idle()?;
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        image
            .save(out)
            .with_context(|| format!("writing {}", out.display()))?;
        println!("{} {}x{}", out.display(), image.width(), image.height());
        Ok(())
    }

    fn emit(&mut self, emit: &Emit) -> Result<()> {
        let events: Vec<CoreEvent> = self.cx.update(|cx| events_for(emit, cx))?;
        self.cx.update(|cx| {
            for event in &events {
                emit_core_event(event, cx);
            }
        });
        Ok(())
    }

    fn run(&mut self, steps: &[Step], out_dir: &Path) -> Result<()> {
        for step in steps {
            match step {
                Step::Story {
                    name,
                    width,
                    height,
                    theme,
                } => {
                    let choice = ThemeChoice::parse(theme)
                        .ok_or_else(|| anyhow!("unknown theme {theme}"))?;
                    self.open(name, *width, *height, choice)?;
                }
                Step::Theme { name } => {
                    let choice =
                        ThemeChoice::parse(name).ok_or_else(|| anyhow!("unknown theme {name}"))?;
                    self.cx.update(|cx| theme::apply(choice, cx));
                }
                Step::Click { id, at } => {
                    self.settle()?;
                    let target = ElementId::Name(id.clone().into());
                    self.update(|window, cx| match at {
                        Some((x, y)) => window.click_at(target, point(px(*x), px(*y)), cx),
                        None => window.click(target, cx),
                    })?;
                }
                Step::Drag { from, to } => {
                    self.settle()?;
                    self.update(|window, cx| {
                        window.drag(point(px(from.0), px(from.1)), point(px(to.0), px(to.1)), cx);
                    })?;
                }
                Step::Press { key } => self.update(|window, cx| window.press(key, cx))?,
                Step::Type { text } => {
                    self.settle()?;
                    self.update(|window, cx| window.input(text, cx))?;
                }
                Step::Emit(emit) => self.emit(emit)?,
                Step::WaitIdle => {
                    self.wait_idle()?;
                }
                Step::Shot { name } => self.shot(&out_dir.join(format!("{name}.png")))?,
                Step::ExpectLabel { label } => {
                    self.settle()?;
                    let found = self.query(|window| !window.find_all_by_label(label).is_empty())?;
                    if !found {
                        bail!("expected an element named {label:?}");
                    }
                }
                Step::ExpectNoLabel { label } => {
                    self.settle()?;
                    let found = self.query(|window| !window.find_all_by_label(label).is_empty())?;
                    if found {
                        bail!("expected no element named {label:?}");
                    }
                }
                Step::ExpectFocused { label } => {
                    self.settle()?;
                    let focused = self.query(|window| {
                        window
                            .find_all_by_label(label)
                            .iter()
                            .any(|element| element.focused() == Some(true))
                    })?;
                    if !focused {
                        bail!("expected {label:?} to have keyboard focus");
                    }
                }
                Step::Audit => {
                    self.settle()?;
                    self.audit()?;
                }
            }
        }
        Ok(())
    }
}

/// The events core would send, after making any change to the fixture that it describes.
fn events_for(emit: &Emit, cx: &mut App) -> Result<Vec<CoreEvent>> {
    match emit {
        Emit::Connection { state } => Ok(vec![CoreEvent::ConnectionChanged {
            state: match state.as_str() {
                "connected" => ConnectionState::Connected,
                "disconnected" => ConnectionState::Disconnected,
                "suspended" => ConnectionState::Suspended,
                "offline" => ConnectionState::Offline,
                other => bail!("unknown connection state {other}"),
            },
        }]),
        Emit::Unread {
            channel,
            unread,
            mentions,
        } => {
            let source = active_fixture(cx)?;
            let mut fixture = source.0.0.borrow_mut();
            let community = fixture.first_community();
            let row = fixture
                .channel_named(&community, channel)
                .ok_or_else(|| anyhow!("no channel {channel}"))?;
            row.unread_count = *unread;
            row.mention_count = *mentions;
            Ok(vec![CoreEvent::ViewChanged {
                view: ViewKey::Channels {
                    community_id: community,
                },
            }])
        }
        Emit::Message {
            channel,
            author,
            text,
        } => {
            let source = active_fixture(cx)?;
            let mut fixture = source.0.0.borrow_mut();
            let community = fixture.first_community();
            let id = fixture
                .channel_named(&community, channel)
                .ok_or_else(|| anyhow!("no channel {channel}"))?
                .id
                .clone();
            let conversation = Conversation::Channel { id };
            let index = fixture
                .views
                .messages
                .iter()
                .find(|(key, _)| *key == conversation)
                .map_or(0, |(_, rows)| rows.len()) as u32;
            let row = MessageRow {
                seq: i64::from(index),
                author: UserView {
                    id: author.clone(),
                    username: author.clone(),
                    ..UserView::default()
                },
                display: text.clone(),
                ..MessageRow::default()
            };
            Ok(vec![CoreEvent::MessagesChanged {
                conversation,
                ops: vec![ListOp::Insert {
                    index,
                    rows: vec![row],
                }],
            }])
        }
        Emit::JoinVoice { channel } => {
            let source = active_fixture(cx)?;
            let mut fixture = source.0.0.borrow_mut();
            let community = fixture.first_community();
            let id = fixture
                .channel_named(&community, channel)
                .ok_or_else(|| anyhow!("no channel {channel}"))?
                .id
                .clone();
            fixture.connect_voice(&id);
            Ok(vec![CoreEvent::ViewChanged {
                view: ViewKey::Voice,
            }])
        }
    }
}

fn active_fixture(cx: &App) -> Result<ActiveFixtureHandle> {
    Ok(ActiveFixtureHandle(
        cx.try_global::<ActiveFixture>()
            .ok_or_else(|| anyhow!("this story has no fixture to change"))?
            .0
            .clone(),
    ))
}

struct ActiveFixtureHandle(std::rc::Rc<semaphore_ui::shell::fixtures::FixtureSource>);

fn take_flag(args: &mut Vec<String>, flag: &str) -> Result<Option<String>> {
    let Some(index) = args.iter().position(|arg| arg == flag) else {
        return Ok(None);
    };
    if index + 1 >= args.len() {
        bail!("{flag} needs a value");
    }
    args.remove(index);
    Ok(Some(args.remove(index)))
}

fn main() -> Result<()> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--list") {
        for story in stories::all() {
            println!("{}", story.name);
        }
        return Ok(());
    }
    if let Some(path) = take_flag(&mut args, "--script")? {
        let out_dir: PathBuf = take_flag(&mut args, "--out")?
            .context("--script needs --out <dir>")?
            .into();
        let source = std::fs::read_to_string(&path).with_context(|| path.clone())?;
        let steps = script::parse(&source).map_err(|error| anyhow!("{path}: {error}"))?;
        return Rig::new().run(&steps, &out_dir);
    }

    let theme = take_flag(&mut args, "--theme")?;
    let [story, width, height, out] = args.as_slice() else {
        bail!(
            "usage: rig-shot <story> <width> <height> <out.png> [--theme <name>] | rig-shot --script <file> --out <dir> | rig-shot --list"
        );
    };
    let width: f32 = width.parse().context("width")?;
    let height: f32 = height.parse().context("height")?;
    let choice = match theme {
        Some(name) => ThemeChoice::parse(&name).ok_or_else(|| anyhow!("unknown theme {name}"))?,
        None => ThemeChoice::default(),
    };
    let mut rig = Rig::new();
    rig.open(story, width, height, choice)?;
    rig.shot(Path::new(out))?;
    Ok(())
}
