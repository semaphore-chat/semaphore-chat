//! `AttachmentTile`: a file sent with a message (`frontend/src/kit/chat/AttachmentTile.tsx`).
//!
//! The queued and uploading states (Remove, progress, an upload error with Retry) come with the
//! Composer (B7 part 3).

use super::{child_id, one_line};
use crate::kit::look::{focus_handle, focus_ring, shows_focus};
use crate::kit::surface::{Surface, stand_out_fill, tint_base_token};
use crate::kit::{Action, Icon, IconSize, Spinner};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::LoungeIcon;
use semaphore_design::chat::{BoxSize, IMAGE_MAX, IMAGE_MIN_SIDE, image_box};
use semaphore_design::lounge::{
    AVATAR_MD, CONTROL_LG, CONTROL_MD, ICON_LG, RADIUS_FULL, RADIUS_MD, RADIUS_SM, SPACE_MD,
    SPACE_SM, SPACE_XS, STATE_HOVER, TEXT_BODY, TEXT_SMALL,
};
use std::cell::Cell;
use std::rc::Rc;

/// What a tile is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    /// A picture, drawn in a box of its known size.
    Image,
    /// The same box with its still and Play; it plays in place.
    Video,
    /// A row with Play; it plays in place.
    Audio,
    /// A row with the file's name and size.
    File,
}

/// What the player element needs to fill the tile: the box it is drawn in, and its corners.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlayerSlot {
    /// The box: a video's sized box, or for audio the row's width and one control's height.
    pub size: BoxSize,
    /// The corner radius the tile clips the player to.
    pub radius: Pixels,
}

type PlayerBuilder = Box<dyn FnOnce(PlayerSlot) -> AnyElement>;

/// A file sent with a message (MessageRow's `attachments`). An image is drawn in a box sized from
/// its width and height before the picture arrives, so a late picture never moves the list;
/// pressing it opens the image. A video gets the same box with its still and Play, and an audio
/// file a row with Play: nothing plays until it is pressed, and once the screen gives the player
/// (`player`) the tile becomes it, in the same place. Any other file is a row with its name and
/// size; pressing it downloads the file. Without `on_open` the tile is not pressable (a queued
/// file).
#[derive(IntoElement)]
pub struct AttachmentTile {
    id: ElementId,
    kind: AttachmentKind,
    name: SharedString,
    detail: Option<SharedString>,
    src: Option<ImageSource>,
    poster: Option<ImageSource>,
    width: Option<f64>,
    height: Option<f64>,
    busy: bool,
    on: Option<Surface>,
    on_open: Option<Action>,
    on_load_error: Option<Action>,
    player: Option<PlayerBuilder>,
}

impl AttachmentTile {
    pub fn new(
        id: impl Into<ElementId>,
        kind: AttachmentKind,
        name: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            kind,
            name: name.into(),
            detail: None,
            src: None,
            poster: None,
            width: None,
            height: None,
            busy: false,
            on: None,
            on_open: None,
            on_load_error: None,
            player: None,
        }
    }

    /// The size, written for people ("2.4 MB").
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// The picture: an image's preview, or on a file a small thumbnail in place of the paperclip.
    /// Until it is known the box shows a quiet fill.
    pub fn src(mut self, src: ImageSource) -> Self {
        self.src = Some(src);
        self
    }

    /// A video's still, under Play.
    pub fn poster(mut self, poster: ImageSource) -> Self {
        self.poster = Some(poster);
        self
    }

    /// The image's or video's own size in pixels: the box is sized from it.
    pub fn size(mut self, width: f64, height: f64) -> Self {
        self.width = Some(width);
        self.height = Some(height);
        self
    }

    /// Opens the image, asks for a video's or audio's player, or downloads the file.
    pub fn on_open(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_open = Some(Rc::new(handler));
        self
    }

    /// The open, the download or the player is on its way: busy, presses ignored.
    pub fn busy(mut self, busy: bool) -> Self {
        self.busy = busy;
        self
    }

    /// The picture could not be drawn (the tile shows the name instead). Called once.
    pub fn on_load_error(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_load_error = Some(Rc::new(handler));
        self
    }

    /// The video or audio player, once the screen has it: the tile becomes the player, built in
    /// the slot's box (the pattern of MediaTile's `video`). Ignored on an image or a file.
    pub fn player(mut self, build: impl FnOnce(PlayerSlot) -> AnyElement + 'static) -> Self {
        self.player = Some(Box::new(build));
        self
    }

    /// The web's `remote` (load without a Referer). A native image request sends no Referer, so
    /// it changes nothing; kept so the screen can pass what the web passes.
    pub fn remote(self, _remote: bool) -> Self {
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// "name, 2.4 MB", or the name alone.
fn sized(name: &str, detail: Option<&str>) -> String {
    match detail {
        Some(detail) if !detail.is_empty() => format!("{name}, {detail}"),
        _ => name.to_owned(),
    }
}

/// A tile's accessible name.
pub(crate) fn tile_name(
    kind: AttachmentKind,
    name: &str,
    detail: Option<&str>,
    pressable: bool,
) -> String {
    let sized = sized(name, detail);
    if !pressable {
        return sized;
    }
    match kind {
        AttachmentKind::Image => format!("Open image {name}"),
        AttachmentKind::Video => format!("Play video {sized}"),
        AttachmentKind::Audio => format!("Play audio {sized}"),
        AttachmentKind::File => format!("Download {sized}"),
    }
}

/// Calls `on_load_error` once per tile when the picture's fallback first draws.
#[derive(IntoElement)]
struct LoadFailed {
    seen: Rc<Cell<bool>>,
    on_load_error: Option<Action>,
    child: AnyElement,
}

impl RenderOnce for LoadFailed {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        if !self.seen.replace(true)
            && let Some(handler) = self.on_load_error
        {
            handler(window, cx);
        }
        self.child
    }
}

impl RenderOnce for AttachmentTile {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let p = sem.roles;
        let on = Surface::or_current(self.on, cx);
        let fill = stand_out_fill(&sem, on);
        let secondary = sem.role.text_secondary;
        let pressable = self.on_open.is_some();
        let name = tile_name(self.kind, &self.name, self.detail.as_deref(), pressable);
        let file_text = |name: SharedString, detail: Option<SharedString>| {
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(one_line(TEXT_BODY, name))
                .children(detail.map(|detail| one_line(TEXT_SMALL, detail).text_color(secondary)))
        };
        let row_look = |el: Div| {
            el.flex()
                .items_center()
                .gap(px(SPACE_MD))
                .w_full()
                .max_w(px(IMAGE_MAX.width))
                .px(px(SPACE_MD))
                .py(px(SPACE_SM))
                .rounded(px(RADIUS_MD))
                .bg(fill)
                .text_color(sem.role.text)
        };
        let leading = |src: Option<ImageSource>, icon: LoungeIcon| match src {
            Some(src) => img(src)
                .flex_shrink_0()
                .size(px(AVATAR_MD))
                .rounded(px(RADIUS_SM))
                .object_fit(ObjectFit::Cover)
                .into_any_element(),
            None => Icon::lounge(icon).color(secondary).into_any_element(),
        };

        // A queued file: its thumbnail or the paperclip, its name and size; nothing to press.
        let Some(on_open) = self.on_open else {
            return row_look(div())
                .id(self.id)
                .test_support()
                .role(Role::Group)
                .aria_label(name)
                .child(leading(self.src, LoungeIcon::Paperclip))
                .child(file_text(self.name, self.detail))
                .into_any_element();
        };

        let media = matches!(self.kind, AttachmentKind::Video | AttachmentKind::Audio);
        if media && let Some(build) = self.player {
            let player_id = self.id.clone();
            return match self.kind {
                AttachmentKind::Video => {
                    let size = image_box(self.width, self.height);
                    let slot = PlayerSlot {
                        size,
                        radius: px(RADIUS_MD),
                    };
                    sized_box(div().id(player_id), size)
                        .rounded(px(RADIUS_MD))
                        .bg(fill)
                        .child(build(slot))
                        .into_any_element()
                }
                _ => {
                    let slot = PlayerSlot {
                        size: BoxSize {
                            width: IMAGE_MAX.width - 2. * SPACE_MD,
                            height: CONTROL_MD,
                        },
                        radius: px(RADIUS_SM),
                    };
                    row_look(div())
                        .id(player_id)
                        .test_support()
                        .role(Role::Group)
                        .aria_label(sized(&self.name, self.detail.as_deref()))
                        .flex_col()
                        .items_stretch()
                        .gap(px(SPACE_SM))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(SPACE_MD))
                                .min_w_0()
                                .child(Icon::lounge(LoungeIcon::Music).color(secondary))
                                .child(file_text(self.name, self.detail)),
                        )
                        .child(div().h(px(CONTROL_MD)).child(build(slot)))
                        .into_any_element()
                }
            };
        }

        let focus = focus_handle(&self.id, window, cx);
        let ring = shows_focus(&focus, window);
        let busy = self.busy;
        let hover = hsla_of(blend(p.text, tint_base_token(&p, on), STATE_HOVER));
        let button = base::Button::new(self.id.clone())
            .track_focus(&focus)
            .accessibility_label(name)
            .when(busy, |button| button.aria_description("busy"))
            .relative()
            .cursor_pointer()
            .on_click(move |_, window, cx| {
                if !busy {
                    on_open(window, cx);
                }
            });
        let spinner = |size: IconSize| Spinner::new(child_id(&self.id, "spinner")).size(size);
        let centred = || {
            div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
        };

        match self.kind {
            AttachmentKind::Image | AttachmentKind::Video => {
                let size = image_box(self.width, self.height);
                let video = self.kind == AttachmentKind::Video;
                let failed_name = self.name.clone();
                let seen = window
                    .use_keyed_state(child_id(&self.id, "failed"), cx, |_, _| {
                        Rc::new(Cell::new(false))
                    })
                    .read(cx)
                    .clone();
                let on_load_error = self.on_load_error;
                let picture = if video { self.poster } else { self.src }.map(|source| {
                    img(source)
                        .size_full()
                        .object_fit(ObjectFit::Contain)
                        .with_fallback(move || {
                            let shown = (!video).then(|| {
                                div()
                                    .size_full()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .gap(px(SPACE_XS))
                                    .p(px(SPACE_SM))
                                    .text_color(secondary)
                                    .child(
                                        Icon::lounge(LoungeIcon::Image)
                                            .size(IconSize::Sm.px())
                                            .color(secondary),
                                    )
                                    .child(
                                        crate::kit::overlays::type_text(
                                            TEXT_SMALL,
                                            failed_name.clone(),
                                        )
                                        .min_w_0()
                                        .text_center(),
                                    )
                            });
                            LoadFailed {
                                seen: seen.clone(),
                                on_load_error: on_load_error.clone(),
                                child: div().size_full().children(shown).into_any_element(),
                            }
                            .into_any_element()
                        })
                });
                let overlay = if video {
                    Some(
                        centred().child(
                            div()
                                .size(px(CONTROL_LG))
                                .rounded(px(RADIUS_FULL))
                                .flex()
                                .items_center()
                                .justify_center()
                                .bg(sem.role.accent)
                                .text_color(sem.role.on_accent)
                                .child(if busy {
                                    spinner(IconSize::Md)
                                        .color(sem.role.on_accent)
                                        .into_any_element()
                                } else {
                                    Icon::lounge(LoungeIcon::Play)
                                        .size(ICON_LG)
                                        .color(sem.role.on_accent)
                                        .into_any_element()
                                }),
                        ),
                    )
                } else {
                    busy.then(|| centred().child(spinner(IconSize::Md)))
                };
                sized_box(button, size)
                    .rounded(px(RADIUS_MD))
                    .bg(fill)
                    .children(picture)
                    .children(overlay)
                    .when(ring, |tile| tile.child(focus_ring(&p, RADIUS_MD, 0.)))
                    .into_any_element()
            }
            AttachmentKind::Audio | AttachmentKind::File => {
                let audio = self.kind == AttachmentKind::Audio;
                let trailing = if busy {
                    Some(spinner(IconSize::Sm).into_any_element())
                } else if audio {
                    Some(
                        Icon::lounge(LoungeIcon::Play)
                            .color(secondary)
                            .into_any_element(),
                    )
                } else {
                    None
                };
                let src = if audio { None } else { self.src };
                button
                    .w_full()
                    .max_w(px(IMAGE_MAX.width))
                    .rounded(px(RADIUS_MD))
                    .child(
                        row_look(div())
                            .hover(move |style| style.bg(hover))
                            .child(leading(
                                src,
                                if audio {
                                    LoungeIcon::Music
                                } else {
                                    LoungeIcon::Paperclip
                                },
                            ))
                            .child(file_text(self.name, self.detail))
                            .children(trailing),
                    )
                    .when(ring, |tile| tile.child(focus_ring(&p, RADIUS_MD, 0.)))
                    .into_any_element()
            }
        }
    }
}

/// The image box: its width, shrinking with a narrow column but keeping its shape, never a side
/// under the minimum. The picture is clipped to it.
fn sized_box<E: Styled>(el: E, size: BoxSize) -> E {
    el.w(px(size.width))
        .max_w_full()
        .aspect_ratio(size.width / size.height)
        .min_h(px(IMAGE_MIN_SIDE))
        .overflow_hidden()
}
