//! Core's events on the UI thread. `CoreEvent` arrives at an `EventSink` on any thread; the app
//! brings it to the main thread and calls [`emit_core_event`], and so does `rig-shot`'s `emit` step.
//! Views subscribe with [`on_core_event`], so a story and the real client take the same path.

use gpui_kit::{App, Context, Global, WeakEntity};
use semaphore_core::CoreEvent;
use std::rc::Rc;

type Listener = Rc<dyn Fn(&CoreEvent, &mut App) -> bool>;

#[derive(Default)]
struct Bus {
    listeners: Vec<Listener>,
}

impl Global for Bus {}

/// Sends the event to every live subscriber, in subscription order.
pub fn emit_core_event(event: &CoreEvent, cx: &mut App) {
    let listeners = cx.default_global::<Bus>().listeners.clone();
    let mut alive = Vec::with_capacity(listeners.len());
    for listener in listeners {
        if listener(event, cx) {
            alive.push(listener);
        }
    }
    cx.default_global::<Bus>().listeners = alive;
}

/// Calls `handler` on `view` for each event, until the view is dropped.
pub fn on_core_event<V: 'static>(
    view: WeakEntity<V>,
    handler: impl Fn(&mut V, &CoreEvent, &mut Context<V>) + 'static,
    cx: &mut App,
) {
    let listener: Listener = Rc::new(move |event, cx| {
        view.update(cx, |view, cx| {
            handler(view, event, cx);
            cx.notify();
        })
        .is_ok()
    });
    cx.default_global::<Bus>().listeners.push(listener);
}
