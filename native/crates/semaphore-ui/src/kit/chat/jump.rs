//! `JumpToLatest`: the floating control over a message list (`frontend/src/kit/chat/JumpToLatest.tsx`).

use crate::kit::look::{focus_handle, outer_focus_ring, shows_focus};
use crate::kit::overlays::{ShadowKind, shadow};
use crate::kit::{Action, Icon, IconSize, Spinner};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::LoungeIcon;
use semaphore_design::chat::jump_text;
use semaphore_design::lounge::{
    BORDER_HAIRLINE, CONTROL_MD, RADIUS_FULL, SPACE_LG, SPACE_MD, SPACE_SM, STATE_HOVER,
    STATE_HOVER_ON_FILL, STATE_PRESSED, STATE_PRESSED_ON_FILL, TEXT_BODY_STRONG,
};
use std::rc::Rc;

/// "Jump to latest", shown while the reader is scrolled away from the newest message. With
/// `new_count` it says how many arrived meanwhile ("3 new") in the accent. It places itself
/// centred above the bottom edge of its positioned container (the list region), over the rows.
#[derive(IntoElement)]
pub struct JumpToLatest {
    id: ElementId,
    new_count: u64,
    busy: bool,
    on_jump: Action,
}

impl JumpToLatest {
    pub fn new(
        id: impl Into<ElementId>,
        on_jump: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            new_count: 0,
            busy: false,
            on_jump: Rc::new(on_jump),
        }
    }

    /// Messages that arrived while the reader was away: "N new" (above 99, "99+ new").
    pub fn new_count(mut self, count: u64) -> Self {
        self.new_count = count;
        self
    }

    /// Loading the latest messages: busy, presses ignored, focus stays.
    pub fn busy(mut self, busy: bool) -> Self {
        self.busy = busy;
        self
    }
}

impl RenderOnce for JumpToLatest {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let p = sem.roles;
        let words = jump_text(self.new_count);
        let rest = if words.counted { p.accent } else { p.surface };
        let (hover_amount, pressed_amount) = if words.counted {
            (STATE_HOVER_ON_FILL, STATE_PRESSED_ON_FILL)
        } else {
            (STATE_HOVER, STATE_PRESSED)
        };
        let hover = hsla_of(blend(p.text, rest, hover_amount));
        let pressed = hsla_of(blend(p.text, rest, pressed_amount));
        let ink = if words.counted {
            sem.role.on_accent
        } else {
            sem.role.text
        };
        let focus = focus_handle(&self.id, window, cx);
        let ring = shows_focus(&focus, window);
        let busy = self.busy;
        let on_jump = self.on_jump;
        let button = base::Button::new(self.id)
            .track_focus(&focus)
            .accessibility_label(words.name)
            .when(busy, |button| button.aria_description("busy"))
            .relative()
            .flex()
            .items_center()
            .gap(px(SPACE_SM))
            .h(px(CONTROL_MD))
            .max_w_full()
            .pl(px(SPACE_MD))
            .pr(px(SPACE_LG))
            .rounded(px(RADIUS_FULL))
            .when(!words.counted, |button| {
                button
                    .border(px(BORDER_HAIRLINE))
                    .border_color(sem.role.hairline)
            })
            .bg(hsla_of(rest))
            .text_color(ink)
            .shadow(shadow(&sem, ShadowKind::Island))
            .font_family(TEXT_BODY_STRONG.family)
            .text_size(px(TEXT_BODY_STRONG.size))
            .line_height(px(TEXT_BODY_STRONG.line_height))
            .font_weight(FontWeight(TEXT_BODY_STRONG.weight as f32))
            .whitespace_nowrap()
            .when(!busy, |button| {
                button
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .active(move |style| style.bg(pressed))
            })
            .on_click(move |_, window, cx| {
                if !busy {
                    on_jump(window, cx);
                }
            })
            .when(ring, |button| {
                button.child(outer_focus_ring(&p, RADIUS_FULL))
            })
            .child(if busy {
                Spinner::new("jump-spinner")
                    .size(IconSize::Md)
                    .color(ink)
                    .into_any_element()
            } else {
                Icon::lounge(LoungeIcon::ChevronDown)
                    .color(ink)
                    .into_any_element()
            })
            .child(
                div()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .child(words.text),
            );
        div()
            .absolute()
            .left_0()
            .right_0()
            .bottom(px(SPACE_LG))
            .px(px(SPACE_LG))
            .flex()
            .justify_center()
            .child(button)
    }
}
