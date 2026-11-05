//! GPUI views. Each one renders plain data handed to it, so the screenshot rig can draw
//! any of them as a story with no server behind it.

use gpui_kit::component::button::*;
use gpui_kit::component::*;
use gpui_kit::*;
use semaphore_core::ConnectionState;

/// The app shell. A placeholder until real views exist.
pub struct Shell {
    pub connection: ConnectionState,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let status = match self.connection {
            ConnectionState::Connected => "Connected",
            ConnectionState::Disconnected => "Disconnected",
            ConnectionState::Suspended => "Suspended",
            ConnectionState::Offline => "Offline",
        };
        div()
            .v_flex()
            .gap_2()
            .size_full()
            .items_center()
            .justify_center()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child("Semaphore Chat")
            .child(status)
            .child(Button::new("retry").primary().label("Reconnect"))
    }
}
