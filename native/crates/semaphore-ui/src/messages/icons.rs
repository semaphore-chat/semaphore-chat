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
    ADD_REACTION = "add_reaction", "M18 9V7h-2V2.84C14.77 2.3 13.42 2 11.99 2 6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12c0-1.05-.17-2.05-.47-3zm-2.5-1c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5m-7 0c.83 0 1.5.67 1.5 1.5S9.33 11 8.5 11 7 10.33 7 9.5 7.67 8 8.5 8m3.5 9.5c-2.33 0-4.31-1.46-5.11-3.5h10.22c-.8 2.04-2.78 3.5-5.11 3.5M22 3h2v2h-2v2h-2V5h-2V3h2V1h2z";
    QUOTE = "format_quote", "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z";
    PIN = "push_pin", "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3";
    PIN_OUTLINED = "push_pin_outlined", "M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4zm3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1";
    EDIT = "edit", "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z";
    COPY = "content_copy", "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z";
    CHECK = "check", "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
    CANCEL = "cancel", "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z";
    MORE = "more_vert", "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2";
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
