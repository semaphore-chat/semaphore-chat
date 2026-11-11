//! Material icons, the same paths the web client's `@mui/icons-material` draws (MIT). As strings
//! rather than assets, because rig-shot and the app register the kit's default icon bundle, which
//! has none of these, and `paint_svg` takes the bytes directly.

use gpui_kit::*;

#[derive(Clone, Copy)]
pub struct VoiceIcon {
    key: &'static str,
    svg: &'static str,
}

pub const MIC: VoiceIcon = VoiceIcon {
    key: "voice-icon/Mic",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3m5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72z"/></svg>"##,
};

pub const MIC_OFF: VoiceIcon = VoiceIcon {
    key: "voice-icon/MicOff",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28m-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18zM4.27 3 3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73z"/></svg>"##,
};

pub const HEADSET: VoiceIcon = VoiceIcon {
    key: "voice-icon/Headset",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9"/></svg>"##,
};

pub const HEADSET_OFF: VoiceIcon = VoiceIcon {
    key: "voice-icon/HeadsetOff",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M12 4c3.87 0 7 3.13 7 7v2h-2.92L21 17.92V11c0-4.97-4.03-9-9-9-1.95 0-3.76.62-5.23 1.68l1.44 1.44C9.3 4.41 10.6 4 12 4M2.27 1.72 1 3l3.33 3.32C3.49 7.68 3 9.29 3 11v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-1.17.29-2.26.79-3.22L15 17v4h3c.3 0 .59-.06.86-.14L21 23l1.27-1.27z"/></svg>"##,
};

/// For when publishing a camera lands.
#[allow(dead_code)]
pub const VIDEOCAM: VoiceIcon = VoiceIcon {
    key: "voice-icon/Videocam",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11z"/></svg>"##,
};

pub const VIDEOCAM_OFF: VoiceIcon = VoiceIcon {
    key: "voice-icon/VideocamOff",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="m21 6.5-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18zM3.27 2 2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73z"/></svg>"##,
};

pub const SCREEN_SHARE: VoiceIcon = VoiceIcon {
    key: "voice-icon/ScreenShare",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73z"/></svg>"##,
};

/// For when publishing a screen lands.
#[allow(dead_code)]
pub const STOP_SCREEN_SHARE: VoiceIcon = VoiceIcon {
    key: "voice-icon/StopScreenShare",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="m21.22 18.02 2 2H24v-2zm.77-2 .01-10c0-1.11-.9-2-2-2H7.22l5.23 5.23c.18-.04.36-.07.55-.1V7.02l4 3.73-1.58 1.47 5.54 5.54c.61-.33 1.03-.99 1.03-1.74M2.39 1.73 1.11 3l1.54 1.54c-.4.36-.65.89-.65 1.48v10c0 1.1.89 2 2 2H0v2h18.13l2.71 2.71 1.27-1.27zM7 15.02c.31-1.48.92-2.95 2.07-4.06l1.59 1.59c-1.54.38-2.7 1.18-3.66 2.47"/></svg>"##,
};

pub const CALL_END: VoiceIcon = VoiceIcon {
    key: "voice-icon/CallEnd",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7s.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71s-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9"/></svg>"##,
};

pub const SETTINGS: VoiceIcon = VoiceIcon {
    key: "voice-icon/Settings",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6"/></svg>"##,
};

pub const VOLUME_UP: VoiceIcon = VoiceIcon {
    key: "voice-icon/VolumeUp",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M3 9v6h4l5 5V4L7 9zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77"/></svg>"##,
};

pub const MORE_HORIZ: VoiceIcon = VoiceIcon {
    key: "voice-icon/MoreHoriz",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2"/></svg>"##,
};

/// W4: Capture replay (the web's `MovieCreation`).
pub const MOVIE_CREATION: VoiceIcon = VoiceIcon {
    key: "voice-icon/MovieCreation",
    svg: r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="m18 4 2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4z"/></svg>"##,
};

/// What lies outside a rounded corner, one per corner, for a video clipped to a square tile.
const CORNERS: [(&str, &str); 4] = [
    (
        "voice-corner/tl",
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#fff" d="M0 0H8A8 8 0 0 0 0 8Z"/></svg>"##,
    ),
    (
        "voice-corner/tr",
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#fff" d="M8 0H0A8 8 0 0 1 8 8Z"/></svg>"##,
    ),
    (
        "voice-corner/br",
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#fff" d="M8 8H0A8 8 0 0 0 8 0Z"/></svg>"##,
    ),
    (
        "voice-corner/bl",
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#fff" d="M0 8H8A8 8 0 0 1 0 0Z"/></svg>"##,
    ),
];

pub fn paint_corners(
    bounds: Bounds<Pixels>,
    radius: Pixels,
    color: Hsla,
    window: &mut Window,
    cx: &App,
) {
    let (left, top) = (bounds.origin.x, bounds.origin.y);
    let right = left + bounds.size.width - radius;
    let bottom = top + bounds.size.height - radius;
    let origins = [
        point(left, top),
        point(right, top),
        point(right, bottom),
        point(left, bottom),
    ];
    for ((key, svg), origin) in CORNERS.iter().zip(origins) {
        let _ = window.paint_svg(
            Bounds {
                origin,
                size: size(radius, radius),
            },
            (*key).into(),
            Some(svg.as_bytes()),
            TransformationMatrix::default(),
            color,
            cx,
        );
    }
}

pub fn icon(icon: VoiceIcon, size: Pixels, color: Hsla) -> Canvas<()> {
    canvas(
        |_, _, _| (),
        move |bounds, _, window, cx| {
            let _ = window.paint_svg(
                bounds,
                icon.key.into(),
                Some(icon.svg.as_bytes()),
                TransformationMatrix::default(),
                color,
                cx,
            );
        },
    )
    .size(size)
    .flex_shrink_0()
}
