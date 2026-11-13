//! A real window with a message list, for the desktop probe's AT-SPI announcement check.
//!
//! The probe starts it under Xvfb on a private session bus, reads `READY` (the window has drawn),
//! turns accessibility on (`org.a11y.Status.IsEnabled`), and watches the accessibility bus for
//! `org.a11y.atspi.Event.Object.Announcement`. This rig scrolls away from the bottom, inserts one
//! message from another user and one of the reader's own, and waits for the 2 s batch to be read
//! out. It prints one line, `ANNOUNCE result=... text=... seq=...`, and exits 0 on a pass.
//!
//! A message list is the real one (`semaphore_ui::messages::MessageList`), fed `ListOp`s the way
//! core feeds the app.

use gpui_kit::*;
use semaphore_core::model::{ListOp, MessageRow, UserView};
use semaphore_ui::messages::{
    ListData, ListOptions, ListStatus, MessageList, NoMedia, TimeFormat, init,
    with_list_frame_policy,
};
use std::cell::Cell;
use std::io::Write as _;
use std::rc::Rc;
use std::time::{Duration, Instant};

const PATIENCE: Duration = Duration::from_secs(20);
/// Rows to start with: enough that the top is well away from the live edge.
const ROWS: i64 = 60;

struct Rig {
    list: Entity<MessageList>,
    frames: Rc<Cell<u32>>,
    ready: Rc<Cell<bool>>,
}

impl Render for Rig {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.frames.set(self.frames.get() + 1);
        if !self.ready.get() && self.frames.get() >= 3 {
            self.ready.set(true);
            println!("READY");
            let _ = std::io::stdout().flush();
        }
        window.request_animation_frame();
        div().size_full().child(self.list.clone())
    }
}

fn user(id: &str, username: &str, display_name: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display_name.map(str::to_owned),
        avatar_file_id: None,
    }
}

fn row(seq: i64, author: UserView, text: &str, mine: bool) -> MessageRow {
    MessageRow {
        seq,
        id: Some(format!("m{seq}")),
        author,
        sent_at_ms: 1_793_895_120_000 + seq * 1_000,
        display: text.into(),
        mine,
        ..MessageRow::default()
    }
}

/// Polls `check` until it holds or `PATIENCE` runs out.
async fn until(cx: &mut AsyncApp, mut check: impl FnMut(&mut AsyncApp) -> bool) -> bool {
    let deadline = Instant::now() + PATIENCE;
    loop {
        if check(cx) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        cx.background_executor()
            .timer(Duration::from_millis(20))
            .await;
    }
}

fn finish(result: Result<(), String>) -> ! {
    match result {
        Ok(()) => std::process::exit(0),
        Err(why) => {
            println!("ANNOUNCE result=fail why={why:?}");
            std::process::exit(1);
        }
    }
}

fn main() {
    gpui_kit::application().run(|cx| {
        gpui_kit::init(cx);
        init(cx);
        let rows = (1..=ROWS)
            .map(|seq| {
                row(
                    seq,
                    user("u-ben", "ben", None),
                    &format!("message {seq}"),
                    false,
                )
            })
            .collect();
        let frames = Rc::new(Cell::new(0u32));
        let ready = Rc::new(Cell::new(false));
        let view_frames = frames.clone();
        let run_frames = frames.clone();
        let view_ready = ready.clone();
        let options = with_list_frame_policy(WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: Default::default(),
                size: size(px(900.), px(700.)),
            })),
            app_id: Some("app.semaphorechat.rig-announce".into()),
            ..Default::default()
        });
        let list = cx.new(|cx| {
            MessageList::new(
                ListData {
                    me_id: "u-me".into(),
                    rows,
                    replies: Default::default(),
                    status: ListStatus::Ready,
                },
                Rc::new(NoMedia),
                ListOptions {
                    time: TimeFormat::fixed(1_793_895_120_000),
                    scrollbar: false,
                    ..ListOptions::default()
                },
                cx,
            )
        });
        let window_list = list.clone();
        let handle = match cx.open_window(options, move |_, cx| {
            cx.new(|_| Rig {
                list: window_list,
                frames: view_frames,
                ready: view_ready,
            })
        }) {
            Ok(handle) => handle,
            Err(error) => {
                println!("ANNOUNCE result=skip why={:?}", error.to_string());
                std::process::exit(3);
            }
        };
        cx.spawn(async move |cx| {
            let result = run(cx, handle.into(), list, run_frames).await;
            finish(result)
        })
        .detach();
    });
}

async fn run(
    cx: &mut AsyncApp,
    window: AnyWindowHandle,
    list: Entity<MessageList>,
    frames: Rc<Cell<u32>>,
) -> Result<(), String> {
    if !until(cx, |_| frames.get() >= 3).await {
        return Err(format!("the window never drew ({} frames)", frames.get()));
    }
    // The probe turns accessibility on once it has read READY; the adapter activates in its own
    // time. The first frame with accessibility on sends the whole tree.
    if !until(cx, |cx| {
        window
            .update(cx, |_, window, _| window.is_a11y_active())
            .unwrap_or(false)
    })
    .await
    {
        return Err("accessibility never became active".into());
    }
    let at = frames.get();
    if !until(cx, |_| frames.get() >= at + 2).await {
        return Err("no frame after accessibility became active".into());
    }
    list.update(cx, |list, cx| {
        list.scroll_to_seq(1, 0.);
        cx.notify();
    });
    let at = frames.get();
    if !until(cx, |_| frames.get() >= at + 2).await {
        return Err("no frame after scrolling away".into());
    }
    if list.read_with(cx, |list, _| list.is_following_tail()) {
        return Err("still following the tail".into());
    }
    let len = list.read_with(cx, |list, _| list.row_count());
    list.update(cx, |list, cx| {
        list.apply(
            ListOp::Insert {
                index: len as u32,
                rows: vec![row(
                    ROWS + 1,
                    user("u-alice", "alice", Some("Alice")),
                    "hello from Alice",
                    false,
                )],
            },
            cx,
        );
        list.apply(
            ListOp::Insert {
                index: (len + 1) as u32,
                rows: vec![row(
                    ROWS + 2,
                    user("u-me", "me", None),
                    "my own message",
                    true,
                )],
            },
            cx,
        );
    });
    if !until(cx, |cx| {
        list.read_with(cx, |list, _| list.announcement().is_some())
    })
    .await
    {
        return Err("nothing was announced within the batch window".into());
    }
    let said = list
        .read_with(cx, |list, _| list.announcement().cloned())
        .ok_or("no announcement")?;
    // One more frame, so the live node is in a tree update for the adapter to announce.
    let at = frames.get();
    if !until(cx, |_| frames.get() >= at + 2).await {
        return Err("no frame after the announcement".into());
    }
    println!("ANNOUNCE result=pass text={:?} seq={}", said.text, said.seq);
    Ok(())
}
