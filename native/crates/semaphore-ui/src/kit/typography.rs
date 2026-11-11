//! Typography variants, from `theme/tokens.ts` and `generateTheme`'s `typography`.

use crate::theme::{FONT_FAMILY, SemTheme};
use gpui_kit::*;
use semaphore_design::type_scale as size;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    H5,
    H6,
    Subtitle1,
    Subtitle2,
    Body1,
    Body2,
    Button,
    Caption,
    Overline,
    MessageBody,
    ListItem,
    Meta,
    SectionLabel,
    /// `scale.xs` at weight 400: chips and compact labels.
    Xs,
}

impl Variant {
    /// Size in px, weight, and line height as a multiple of the size.
    pub fn metrics(self) -> (f32, f32, f32) {
        match self {
            Variant::H5 => (size::SIZE_3XL, 400., 1.334),
            Variant::H6 => (size::SIZE_2XL, 500., 1.6),
            Variant::Subtitle1 => (size::SIZE_LG, 400., 1.75),
            Variant::Subtitle2 => (size::SIZE_BASE, 500., 1.57),
            Variant::Body1 => (size::SIZE_LG, 400., 1.5),
            Variant::Body2 => (size::SIZE_BASE, 400., 1.43),
            Variant::Button => (size::SIZE_BASE, 500., 1.75),
            Variant::Caption => (size::SIZE_SM, 400., 1.66),
            Variant::Overline => (size::SIZE_SM, 400., 2.66),
            Variant::MessageBody => (size::SIZE_LG, 400., 1.5),
            Variant::ListItem => (size::SIZE_BASE, 500., 1.43),
            Variant::Meta => (size::SIZE_SM, 400., 1.5),
            Variant::SectionLabel => (size::SIZE_SM, 700., 1.5),
            Variant::Xs => (size::SIZE_XS, 400., 1.5),
        }
    }

    fn uppercase(self) -> bool {
        matches!(
            self,
            Variant::Button | Variant::Overline | Variant::SectionLabel
        )
    }
}

/// One run of text in a variant. It inherits its colour; style the returned `Div` to change that.
/// GPUI has no letter-spacing, so `sectionLabel` loses its 0.04em: a platform difference.
pub fn text(variant: Variant, content: impl Into<SharedString>) -> Div {
    let content: SharedString = content.into();
    let (size, weight, line_height) = variant.metrics();
    let shown: SharedString = if variant.uppercase() {
        content.to_uppercase().into()
    } else {
        content
    };
    div()
        .font_family(FONT_FAMILY)
        .text_size(px(size))
        .font_weight(FontWeight(weight))
        .line_height(px((size * line_height).round()))
        .child(shown)
}

/// A MuiLink: accent text that responds to the pointer, with a text accessibility role.
pub fn link(
    id: impl Into<ElementId>,
    content: impl Into<SharedString>,
    cx: &App,
    on_click: impl Fn(&mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let sem = cx.sem();
    let hover = sem.link_hover;
    let content: SharedString = content.into();
    gpui_kit::base::Button::new(id)
        .role(Role::Link)
        .accessibility_label(content.clone())
        .cursor_pointer()
        .text_color(sem.link)
        .hover(move |style| style.text_color(hover))
        .focus_visible(move |style| style.text_color(hover).underline())
        .on_click(move |_, window, cx| on_click(window, cx))
        .child(text(Variant::Body2, content))
}
