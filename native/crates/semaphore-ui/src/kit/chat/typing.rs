//! `TypingLine`: who is typing, one quiet line under the message list
//! (`frontend/src/kit/chat/TypingLine.tsx`).

use super::one_line;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::chat::{TYPING_LINE_HEIGHT, typing_text};
use semaphore_design::lounge::{SPACE_MD, TEXT_SMALL};

/// Who is typing in the conversation (ChatPane's `typing`). A long name gives way with an
/// ellipsis; the line never wraps or grows. Nothing is drawn while no one is typing.
#[derive(IntoElement)]
pub struct TypingLine {
    names: Vec<SharedString>,
}

impl TypingLine {
    /// How tall the line is: a list under it keeps this much room below its last row.
    pub const HEIGHT: f32 = TYPING_LINE_HEIGHT;

    /// Who is typing, by name, the first to start first.
    pub fn new(names: impl IntoIterator<Item = impl Into<SharedString>>) -> Self {
        Self {
            names: names.into_iter().map(Into::into).collect(),
        }
    }
}

impl RenderOnce for TypingLine {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        if self.names.is_empty() {
            return Empty.into_any_element();
        }
        let words = typing_text(&self.names);
        div()
            .id("typing-line")
            .test_support()
            .role(Role::Status)
            .aria_label(words.clone())
            .flex()
            .items_center()
            .h(px(TYPING_LINE_HEIGHT))
            .min_w_0()
            .px(px(SPACE_MD))
            .text_color(cx.sem().role.text_secondary)
            .child(one_line(TEXT_SMALL, words).italic())
            .into_any_element()
    }
}
