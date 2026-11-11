//! The web client's colours and the icons the composer draws. Local until U8's theme lands: its
//! `Palette::dark` becomes a read from the theme and nothing else changes.

use gpui_kit::*;
use semaphore_design::{Accent, Icon, Intensity, Mode, Rgba as Token, tokens};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

pub const BODY_FONT: &str = "Roboto";

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

fn hsla(token: Token) -> Hsla {
    rgba(token.0).into()
}

pub fn with_alpha(color: Hsla, a: f32) -> Hsla {
    Hsla { a, ..color }
}

impl Palette {
    /// `generateTheme('dark', 'teal', 'minimal')`, the web's defaults.
    pub fn dark() -> Self {
        let t = tokens(Mode::Dark, Accent::Teal, Intensity::Minimal);
        let primary = hsla(t.primary_main);
        Self {
            background: hsla(t.background_default),
            paper: hsla(t.background_paper),
            paper_border: with_alpha(primary, 0.08),
            text: hsla(t.text_primary),
            text_secondary: hsla(t.text_secondary),
            divider: hsla(t.divider),
            hover: hsla(t.action_hover),
            selected: hsla(t.action_selected),
            icon: hsla(t.action_active),
            icon_disabled: hsla(t.action_disabled),
            primary,
            primary_hover: with_alpha(primary, 0.1),
            warning: hsla(t.warning_main),
            success: hsla(t.success_main),
            error: hsla(t.error_main),
            avatar_bg: hsla(t.grey_600),
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
