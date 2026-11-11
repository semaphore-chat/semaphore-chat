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

use anyhow::{Context as _, Result, anyhow, bail};
use gpui_kit::component::Root;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use rig_shot::driver::Driver;
use rig_shot::script::{self, Emit, Step};
use semaphore_core::ConnectionState;
use semaphore_core::CoreEvent;
use semaphore_core::model::{Conversation, ListOp, MessageRow, UserView, ViewKey};
use semaphore_ui::kit::{UiAssets, emit_core_event, set_reduced_motion};
use semaphore_ui::shell::stories_impl::ActiveFixture;
use semaphore_ui::stories::{self, StoryEnv, StoryRoot};
use semaphore_ui::theme::{self, ThemeChoice};
use std::path::{Path, PathBuf};
use std::sync::Arc;

struct Rig {
    driver: Driver,
    env: StoryEnv,
}

impl Rig {
    fn new() -> Self {
        let mut driver = Driver::new(Arc::new(UiAssets));
        driver.cx.update(|cx| {
            gpui_kit::init(cx);
            theme::init(cx);
            // A screenshot must not depend on when it caught an animation.
            set_reduced_motion(true, cx);
        });
        Self {
            driver,
            env: StoryEnv {
                scenarios_dir: "fixtures/scenarios".into(),
            },
        }
    }

    fn open(&mut self, name: &str, width: f32, height: f32, choice: ThemeChoice) -> Result<()> {
        if let Some(window) = self.driver.window.take() {
            self.driver
                .cx
                .update_window(window, |_, window, _| window.remove_window())
                .context("closing the last story")?;
        }
        let Some(story) = stories::find(name) else {
            bail!("unknown story {name}; rig-shot --list shows them");
        };
        let env = &self.env;
        self.driver.cx.update(|cx| theme::apply(choice, cx));
        let (handle, _) = self
            .driver
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
        self.driver.window = Some(handle);
        self.driver.update(|window, cx| window.render_frame(cx))
    }

    fn emit(&mut self, emit: &Emit) -> Result<()> {
        let events: Vec<CoreEvent> = self.driver.cx.update(|cx| events_for(emit, cx))?;
        self.driver.cx.update(|cx| {
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
                    self.driver.cx.update(|cx| theme::apply(choice, cx));
                }
                Step::Emit(emit) => self.emit(emit)?,
                other => {
                    self.driver.run_generic(other, out_dir)?;
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
    rig.driver.shot(Path::new(out))?;
    Ok(())
}
