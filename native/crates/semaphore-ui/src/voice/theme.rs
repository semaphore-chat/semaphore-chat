//! The web client's dark palette, by hand, until U2's generated tokens and U8's theme land. Each is
//! named for where it comes from in `frontend/src/theme/themeConfig.ts`.

use gpui_kit::*;

pub fn page() -> Hsla {
    rgb(0x111318).into()
}
pub fn paper() -> Hsla {
    rgb(0x1a1d24).into()
}
pub fn grey_900() -> Hsla {
    rgb(0x212121).into()
}
pub fn grey_100() -> Hsla {
    rgb(0xf5f5f5).into()
}
pub fn grey_400() -> Hsla {
    rgb(0xbdbdbd).into()
}
pub fn positive() -> Hsla {
    rgb(0x22c55e).into()
}
pub fn primary() -> Hsla {
    rgb(0x0d9488).into()
}
pub fn error_main() -> Hsla {
    rgb(0xef4444).into()
}
pub fn warning() -> Hsla {
    rgb(0xffa726).into()
}
pub fn white() -> Hsla {
    rgb(0xffffff).into()
}
pub fn text_secondary() -> Hsla {
    rgba(0xffffffb3).into()
}
pub fn text_disabled() -> Hsla {
    rgba(0xffffff80).into()
}
pub fn divider() -> Hsla {
    rgba(0xffffff1f).into()
}
pub fn action_hover() -> Hsla {
    rgba(0xffffff14).into()
}
pub fn disabled_background() -> Hsla {
    rgba(0xffffff1f).into()
}

pub fn alpha(color: Hsla, value: f32) -> Hsla {
    Hsla { a: value, ..color }
}

/// `RADIUS_UNIT`, what an MUI `Card` gets from the theme's shape.
pub const TILE_RADIUS: Pixels = px(4.);
