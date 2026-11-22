//! `ListSeparator`: a break in a list of messages (`frontend/src/kit/lists/ListSeparator.tsx`).

use crate::kit::surface::{Surface, stand_out_fill};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    BORDER_HAIRLINE, RADIUS_FULL, SPACE_MD, SPACE_SM, SPACE_XS, TEXT_BODY_STRONG, TEXT_META,
    TEXT_TAG,
};

/// Where a new day starts, or where the unread messages start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListSeparatorVariant {
    /// A centred tag that starts a day ("Today", "Monday 3 March").
    Day,
    /// An accent line with its tag at the end, above the first message not read yet ("New").
    Unread,
}

/// A break in a list of messages: a separator named by its label, so a screen reader moving
/// through the list hears "Today" or "New".
#[derive(IntoElement)]
pub struct ListSeparator {
    id: ElementId,
    variant: ListSeparatorVariant,
    label: SharedString,
    on: Option<Surface>,
}

impl ListSeparator {
    pub fn new(
        id: impl Into<ElementId>,
        variant: ListSeparatorVariant,
        label: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            variant,
            label: label.into(),
            on: None,
        }
    }

    pub fn day(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self::new(id, ListSeparatorVariant::Day, label)
    }

    pub fn unread(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self::new(id, ListSeparatorVariant::Unread, label)
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

impl RenderOnce for ListSeparator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let on = Surface::or_current(self.on, cx);
        let day = self.variant == ListSeparatorVariant::Day;
        let style = if day { TEXT_META } else { TEXT_TAG };
        let tag = crate::kit::overlays::type_text(style, self.label.clone())
            .flex_initial()
            .min_w_0()
            .overflow_hidden()
            .whitespace_nowrap()
            .text_ellipsis()
            .px(px(SPACE_MD))
            .when(day, |tag| tag.py(px(SPACE_XS)))
            .rounded(px(RADIUS_FULL))
            .font_weight(FontWeight(TEXT_BODY_STRONG.weight as f32))
            .map(|tag| {
                if day {
                    tag.bg(stand_out_fill(&sem, on))
                        .text_color(sem.role.text_secondary)
                } else {
                    tag.bg(sem.role.accent).text_color(sem.role.on_accent)
                }
            });
        div()
            .id(self.id)
            .test_support()
            .role(Role::Splitter)
            .aria_label(self.label)
            .flex()
            .items_center()
            .gap(px(SPACE_SM))
            .min_w_0()
            .w_full()
            .px(px(SPACE_MD))
            .py(px(SPACE_SM))
            .map(|row| {
                if day {
                    row.justify_center()
                } else {
                    row.justify_end()
                }
            })
            .when(!day, |row| {
                row.child(div().flex_1().h(px(BORDER_HAIRLINE)).bg(sem.role.accent))
            })
            .child(tag)
    }
}
