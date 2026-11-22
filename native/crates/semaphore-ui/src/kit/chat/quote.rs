//! `MessageQuote`: the message a reply answers (`frontend/src/kit/chat/MessageQuote.tsx`).

use super::one_line;
use crate::kit::Action;
use crate::kit::look::{focus_handle, focus_ring, shows_focus};
use crate::kit::surface::{Surface, tint_base_token};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    BORDER_SELECTED, RADIUS_SM, SPACE_2XS, SPACE_SM, STATE_HOVER, TEXT_BODY_STRONG, TEXT_SMALL,
};
use std::rc::Rc;

/// What a deleted original shows.
pub const DELETED_LINE: &str = "Original message was deleted";

/// The message a reply answers, above the reply's words (MessageRow's `quote`): the author and
/// one line. With `on_open` it is a button that shows that message ("Reply to aiko: ok that
/// run…"). A deleted original says so and opens nothing.
#[derive(IntoElement)]
pub struct MessageQuote {
    id: ElementId,
    author: SharedString,
    line: SharedString,
    deleted: bool,
    on: Option<Surface>,
    on_open: Option<Action>,
}

impl MessageQuote {
    pub fn new(
        id: impl Into<ElementId>,
        author: impl Into<SharedString>,
        line: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            author: author.into(),
            line: line.into(),
            deleted: false,
            on: None,
            on_open: None,
        }
    }

    /// The message replied to was deleted: no author or words, and nothing to open.
    pub fn deleted(mut self, deleted: bool) -> Self {
        self.deleted = deleted;
        self
    }

    /// Shows the message replied to (a jump in the list).
    pub fn on_open(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_open = Some(Rc::new(handler));
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// The quote's accessible name, plain or pressable.
pub(crate) fn quote_name(author: &str, line: &str, deleted: bool) -> String {
    if deleted {
        format!("Reply to a deleted message: {DELETED_LINE}")
    } else {
        format!("Reply to {author}: {line}")
    }
}

fn look<E: Styled>(el: E, rail: Hsla, ink: Hsla) -> E {
    el.flex()
        .items_baseline()
        .gap(px(SPACE_SM))
        .min_w_0()
        .max_w_full()
        .px(px(SPACE_SM))
        .py(px(SPACE_2XS))
        .border_l(px(BORDER_SELECTED))
        .border_color(rail)
        .rounded_tr(px(RADIUS_SM))
        .rounded_br(px(RADIUS_SM))
        .font_family(TEXT_SMALL.family)
        .text_size(px(TEXT_SMALL.size))
        .line_height(px(TEXT_SMALL.line_height))
        .text_color(ink)
}

impl RenderOnce for MessageQuote {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let p = sem.roles;
        let on = Surface::or_current(self.on, cx);
        let rail = if self.deleted {
            sem.role.hairline
        } else {
            sem.role.accent
        };
        let name = quote_name(&self.author, &self.line, self.deleted);
        let author = (!self.deleted).then(|| {
            one_line(TEXT_SMALL, self.author.clone())
                .flex_shrink_0()
                .max_w(relative(0.5))
                .font_weight(FontWeight(TEXT_BODY_STRONG.weight as f32))
                .text_color(sem.role.text)
        });
        let line = if self.deleted {
            one_line(TEXT_SMALL, DELETED_LINE).italic()
        } else {
            one_line(TEXT_SMALL, self.line.clone())
        }
        .flex_1();
        match self.on_open.filter(|_| !self.deleted) {
            Some(handler) => {
                let focus = focus_handle(&self.id, window, cx);
                let ring = shows_focus(&focus, window);
                let hover = hsla_of(blend(p.text, tint_base_token(&p, on), STATE_HOVER));
                look(
                    base::Button::new(self.id)
                        .track_focus(&focus)
                        .accessibility_label(name)
                        .relative()
                        .justify_start()
                        .cursor_pointer()
                        .hover(move |style| style.bg(hover))
                        .on_click(move |_, window, cx| handler(window, cx)),
                    rail,
                    sem.role.text_secondary,
                )
                .when(ring, |quote| quote.child(focus_ring(&p, RADIUS_SM, 0.)))
                .children(author)
                .child(line)
                .into_any_element()
            }
            None => look(
                div()
                    .id(self.id)
                    .test_support()
                    .role(Role::Group)
                    .aria_label(name),
                rail,
                sem.role.text_secondary,
            )
            .children(author)
            .child(line)
            .into_any_element(),
        }
    }
}
