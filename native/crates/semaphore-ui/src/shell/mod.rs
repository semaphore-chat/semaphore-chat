//! The app shell. A placeholder until U8 builds the real one.

use gpui_kit::component::button::*;
use gpui_kit::component::*;
use gpui_kit::*;
use semaphore_core::ConnectionState;

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

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    use crate::stories::Story;
    fn view(connection: ConnectionState, cx: &mut App) -> AnyView {
        cx.new(|_| Shell { connection }).into()
    }
    vec![
        Story::new("shell-connected", |_, _, cx| {
            view(ConnectionState::Connected, cx)
        }),
        Story::new("shell-offline", |_, _, cx| {
            view(ConnectionState::Offline, cx)
        }),
    ]
}
