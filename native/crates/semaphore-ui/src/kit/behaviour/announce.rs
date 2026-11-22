//! The announcer: what a screen reader reads that nothing on screen announces (a route change,
//! "Joined Squad Up"). The native side of the web's `useAnnounce` (K4, #805).
//!
//! The host keeps one [`Speaker`] per politeness and [`super::BehaviourRoot`] draws its last
//! announcement as a visually hidden live node. Each announcement is a new node (the speaker's
//! number is in its id), so the same text twice is read twice. AccessKit announces a live node as
//! it appears: AT-SPI and UIA read its name, macOS reads its value, so the node carries both.
//!
//! GPUI does not hide the page from assistive technology while a modal is open (there is no
//! `aria-modal` there), so one pair of nodes at the root is heard from inside a Dialog or Sheet
//! too: the web needs a slot per layer, the native host does not.

use super::BehaviourHost;
use crate::kit::live::{HIDDEN_SIZE, LiveElement as _, Speaker};
use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
pub use semaphore_design::behaviour::toast_queue::Politeness;

/// The host's two live regions.
#[derive(Debug, Default)]
pub struct Announcer {
    polite: Speaker,
    assertive: Speaker,
}

impl Announcer {
    /// Says `text`; `false` for nothing to say.
    pub fn say(&mut self, text: impl Into<String>, politeness: Politeness) -> bool {
        match politeness {
            Politeness::Polite => self.polite.say(text),
            Politeness::Assertive => self.assertive.say(text),
        }
    }

    pub fn polite(&self) -> &Speaker {
        &self.polite
    }

    pub fn assertive(&self) -> &Speaker {
        &self.assertive
    }

    /// The live nodes to draw, or nothing before the first announcement.
    pub(crate) fn nodes(&self) -> Option<AnyElement> {
        let polite = self.polite.last().cloned();
        let assertive = self.assertive.last().cloned();
        if polite.is_none() && assertive.is_none() {
            return None;
        }
        let node = |region: &'static str, said: crate::kit::Said, live: Live| {
            let role = if live == Live::Assertive {
                Role::Alert
            } else {
                Role::Status
            };
            div()
                .id((region, said.seq))
                .test_support()
                .role(role)
                .aria_label(SharedString::from(said.text.clone()))
                .aria_value(SharedString::from(said.text))
                .aria_live(live)
                .w(HIDDEN_SIZE)
                .h(HIDDEN_SIZE)
                .overflow_hidden()
        };
        Some(
            div()
                .id("kit-announcer")
                .flex()
                .children(polite.map(|said| node("kit-announce-polite", said, Live::Polite)))
                .children(
                    assertive.map(|said| node("kit-announce-assertive", said, Live::Assertive)),
                )
                .into_any_element(),
        )
    }
}

/// Has screen readers read `text`: `Polite` waits for a pause, `Assertive` interrupts. Through the
/// window's host, so it is heard from inside a Dialog or Sheet too; without a host it does nothing.
/// Call it from an event handler, never while rendering (each call is a new announcement).
pub fn announce(
    text: impl Into<String>,
    politeness: Politeness,
    window: &mut Window,
    cx: &mut App,
) {
    let Some(host) = BehaviourHost::of(window, cx) else {
        return;
    };
    if host.update(cx, |host, _| host.announcer.say(text, politeness)) {
        window.refresh();
    }
}
