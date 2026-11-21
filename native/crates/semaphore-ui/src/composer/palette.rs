//! The composer's colours, read from the theme ([`Sem`]), and the icons it draws.

use crate::theme::Sem;
use gpui_kit::*;
use semaphore_design::Icon;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

pub const BODY_FONT: &str = crate::theme::FONT_FAMILY;

/// MUI's outlined small field: 16 px on a 23 px line, padded to 40 px for one line.
pub const FIELD_TEXT: f32 = 16.;
pub const FIELD_LINE: f32 = 23.;
pub const FIELD_PAD_X: f32 = 14.;
pub const FIELD_PAD_Y: f32 = 8.5;
pub const ICON_BUTTON: f32 = 40.;
/// The web caps a draft at 40% of the chat column; the window stands in for the column here.
pub const DRAFT_MAX_FRACTION: f32 = 0.4;
/// `DEVICE_BREAKPOINTS.PHONE`: narrower than this, the slim layout.
pub const NARROW_BELOW: f32 = 600.;
/// `isMobile`: narrower than this, the dropdown takes the composer's width.
pub const MENU_FULL_WIDTH_BELOW: f32 = 768.;

#[derive(Clone, Copy, Debug)]
pub struct Palette {
    pub background: Hsla,
    pub paper: Hsla,
    pub paper_border: Hsla,
    pub text: Hsla,
    pub text_secondary: Hsla,
    pub divider: Hsla,
    pub hover: Hsla,
    pub selected: Hsla,
    pub icon: Hsla,
    pub icon_disabled: Hsla,
    pub primary: Hsla,
    pub primary_hover: Hsla,
    pub warning: Hsla,
    pub success: Hsla,
    pub error: Hsla,
    /// MUI's `Avatar` with no image, in dark mode.
    pub avatar_bg: Hsla,
}

pub fn with_alpha(color: Hsla, a: f32) -> Hsla {
    Hsla { a, ..color }
}

impl Palette {
    /// The default theme's colours, for a composer drawn before it reads the theme.
    pub fn dark() -> Self {
        Self::from_sem(&Sem::default())
    }

    /// The theme's colours, under the names the composer was written against.
    pub fn from_sem(sem: &Sem) -> Self {
        Self {
            background: sem.background_default,
            paper: sem.paper,
            paper_border: sem.paper_border,
            text: sem.text_primary,
            text_secondary: sem.text_secondary,
            divider: sem.divider,
            hover: sem.action_hover,
            selected: sem.action_selected,
            icon: sem.action_active,
            icon_disabled: sem.action_disabled,
            primary: sem.primary,
            primary_hover: sem.icon_button_hover,
            warning: sem.warning,
            success: sem.success,
            error: sem.error,
            avatar_bg: crate::theme::color::hsla_of(sem.palette.grey_600),
        }
    }
}

/// U2's exported SVGs carry no namespace, which the renderer requires. Added once per icon, and
/// kept, because GPUI takes the bytes on every paint and only reads them on an atlas miss.
fn svg_bytes(icon: Icon) -> &'static [u8] {
    static CACHE: LazyLock<Mutex<HashMap<Icon, &'static [u8]>>> = LazyLock::new(Default::default);
    let mut cache = CACHE.lock().unwrap_or_else(|poison| poison.into_inner());
    cache.entry(icon).or_insert_with(|| {
        let svg = String::from_utf8_lossy(icon.svg()).replacen(
            "<svg ",
            r#"<svg xmlns="http://www.w3.org/2000/svg" "#,
            1,
        );
        Box::leak(svg.into_bytes().into_boxed_slice())
    })
}

/// An icon as an element of fixed size.
pub fn icon(icon: Icon, side: f32, color: Hsla) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            window
                .paint_svg(
                    bounds,
                    icon.asset_path().into(),
                    Some(svg_bytes(icon)),
                    TransformationMatrix::unit(),
                    color,
                    cx,
                )
                .ok();
        },
    )
    .size(px(side))
    .flex_none()
}

/// Registers a plain element with the kit's test queries, as kit controls do themselves. Without
/// `test-support` this is the element unchanged.
pub fn observed<E: gpui_kit::base::TestSupportExt>(element: E) -> impl IntoElement {
    element.test_support()
}
