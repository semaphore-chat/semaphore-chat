//! The web client's Material icons this list draws, as U2 exports them (`semaphore-design/assets`,
//! Apache-2.0). Inline because the kit's default asset bundle has few of them, and the bytes can go
//! straight to `paint_svg`. When U2 is merged these become its `Icon`s; nothing else changes.

use gpui_kit::*;

#[derive(Clone, Copy, Debug)]
pub struct Glyph {
    /// What GPUI's atlas caches the rendered mask under.
    key: &'static str,
    svg: &'static [u8],
}

macro_rules! glyphs {
    ($($name:ident = $key:literal, $path:literal;)*) => {
        $(pub const $name: Glyph = Glyph {
            key: concat!("messages/", $key),
            svg: concat!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d=""#, $path, r#""/></svg>"#)
                .as_bytes(),
        };)*
    };
}

glyphs! {
    SCHEDULE = "schedule", "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z";
    DOWNLOAD = "download", "M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z";
    AUDIO_FILE = "audio_file", "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm2 11h-3v3.75c0 1.24-1.01 2.25-2.25 2.25S8.5 17.99 8.5 16.75s1.01-2.25 2.25-2.25c.46 0 .89.14 1.25.38V11h4zm-3-4V3.5L18.5 9z";
    FILE = "insert_drive_file", "M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm7 7V3.5L18.5 9z";
    PLAY = "play_arrow", "M8 5v14l11-7z";
    THREAD = "chat_bubble_outline", "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 14H6l-2 2V4h16z";
    REPLAY = "replay", "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8";
    DELETE = "delete_outline", "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM8 9h8v10H8zm7.5-5-1-1h-5l-1 1H5v2h14V4z";
    FORUM = "forum", "M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1m-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1";
}

/// Paints a glyph inside `bounds`.
pub fn paint_glyph(
    glyph: Glyph,
    bounds: Bounds<Pixels>,
    color: Hsla,
    window: &mut Window,
    cx: &App,
) {
    window
        .paint_svg(
            bounds,
            glyph.key.into(),
            Some(glyph.svg),
            TransformationMatrix::unit(),
            color,
            cx,
        )
        .ok();
}

/// A glyph as an element of fixed size.
pub fn glyph(glyph: Glyph, side: f32, color: Hsla) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| paint_glyph(glyph, bounds, color, window, cx),
    )
    .size(px(side))
    .flex_none()
}
