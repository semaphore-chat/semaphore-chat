//! What every tab is drawn with: the page and its cards, rows, the reason a control is off, the
//! confirm dialog, the loading rows and a picked image's preview.

use crate::dms::face::user_face;
use crate::dms::names::user_name;
use crate::kit::{
    Alert, Button, ButtonTone, Dialog, IconButton, LinearProgress, Severity, Skeleton, Variant,
    spacing, text, with_tip,
};
use crate::panel::common::design_icon;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{DraftFile, ErrorView, UploadView, UserView};
use semaphore_design::Icon as DesignIcon;
use std::sync::Arc;

/// A div with an id, observable by the test rig.
pub(crate) type Observed = gpui_kit::base::ObservedElement<Stateful<Div>>;

/// Under this width (of the window) a tab draws its phone layout.
pub(crate) fn phone(window: &Window) -> bool {
    crate::panel::common::is_phone(window)
}

/// A tab's page: its heading (and actions at the right) over its scrolling body.
pub(crate) fn page(
    id: &'static str,
    title: impl Into<SharedString>,
    caption: Option<SharedString>,
    actions: Vec<AnyElement>,
    body: impl IntoElement,
    window: &Window,
    cx: &App,
) -> AnyElement {
    let sem = cx.sem();
    let title = title.into();
    let narrow = phone(window);
    let heading =
        div()
            .flex()
            .when(narrow, |heading| heading.flex_col().items_start())
            .when(!narrow, |heading| heading.items_start().justify_between())
            .gap(spacing(1.))
            .child(
                div()
                    .when(!narrow, |title| title.flex_1())
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(text(Variant::H6, title.clone()).text_color(sem.text_primary))
                    .children(caption.map(|caption| {
                        text(Variant::Body2, caption).text_color(sem.text_secondary)
                    })),
            )
            .child(div().flex().flex_wrap().gap(spacing(1.)).children(actions));
    div()
        .id(id)
        .test_support()
        .role(Role::Region)
        .aria_label(title)
        .size_full()
        .flex()
        .flex_col()
        .bg(sem.background_default)
        .child(
            div()
                .id(SharedString::from(format!("{id}-scroll")))
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(spacing(if narrow { 2. } else { 3. }))
                .flex()
                .flex_col()
                .gap(spacing(2.))
                .child(heading)
                .child(body),
        )
        .into_any_element()
}

/// MUI's `Card` with a title and a divider: one section of a tab.
pub(crate) fn card(title: impl Into<SharedString>, body: impl IntoElement, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .w_full()
        .flex()
        .flex_col()
        .rounded(px(8.))
        .border_1()
        .border_color(sem.divider)
        .bg(sem.paper)
        .child(
            div()
                .px(spacing(2.))
                .py(spacing(1.5))
                .border_b_1()
                .border_color(sem.divider)
                .child(text(Variant::Subtitle1, title).text_color(sem.text_primary)),
        )
        .child(
            div()
                .p(spacing(2.))
                .flex()
                .flex_col()
                .gap(spacing(1.))
                .child(body),
        )
}

/// A list row with the web's divider border.
pub(crate) fn row(id: impl Into<ElementId>, label: impl Into<SharedString>, cx: &App) -> Observed {
    let sem = cx.sem();
    div()
        .id(id)
        .test_support()
        .role(Role::ListItem)
        .aria_label(label.into())
        .w_full()
        .flex()
        .items_center()
        .gap(spacing(1.5))
        .px(spacing(1.5))
        .py(spacing(1.))
        .rounded(px(4.))
        .border_1()
        .border_color(sem.divider)
}

/// A list's container, for its accessible name.
pub(crate) fn list(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Observed {
    div()
        .id(id)
        .test_support()
        .role(Role::List)
        .aria_label(label.into())
        .w_full()
        .flex()
        .flex_col()
        .gap(spacing(1.))
}

/// Why a section is turned off: a lock and the reason, where a tooltip wouldn't reach a phone.
pub(crate) fn locked_note(
    id: impl Into<ElementId>,
    reason: impl Into<SharedString>,
    cx: &App,
) -> Observed {
    let sem = cx.sem();
    let reason = reason.into();
    div()
        .id(id)
        .test_support()
        .role(Role::Note)
        .aria_label(reason.clone())
        .flex()
        .items_center()
        .gap(spacing(1.))
        .child(design_icon(
            DesignIcon::LockOutlined,
            16.,
            sem.text_secondary,
        ))
        .child(
            text(Variant::Caption, reason)
                .flex_1()
                .min_w_0()
                .text_color(sem.text_secondary),
        )
}

/// An icon button that is off, with its reason as a tooltip, when `locked` says why.
#[allow(clippy::too_many_arguments)]
pub(crate) fn action_icon(
    id: impl Into<SharedString>,
    icon: DesignIcon,
    label: impl Into<SharedString>,
    locked: Option<String>,
    busy: bool,
    color: Option<Hsla>,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> AnyElement {
    let id = id.into();
    let label = label.into();
    let disabled = locked.is_some() || busy;
    let mut button = IconButton::new(id.clone(), icon, label)
        .small()
        .disabled(disabled);
    if let Some(color) = color {
        button = button.color(color);
    }
    if !disabled {
        button = button.on_click(on_click);
    }
    match locked {
        Some(reason) => with_tip(div().id(SharedString::from(format!("{id}-locked"))), reason)
            .test_support()
            .child(button)
            .into_any_element(),
        None => button.into_any_element(),
    }
}

/// A button that is off with its reason under it, when `locked` says why.
pub(crate) fn locked_button(
    button: Button,
    id: &'static str,
    locked: Option<String>,
    cx: &App,
) -> AnyElement {
    match locked {
        None => button.into_any_element(),
        Some(reason) => div()
            .flex()
            .flex_col()
            .items_end()
            .gap(px(4.))
            .child(button.disabled(true))
            .child(locked_note(id, reason, cx).max_w(px(320.)))
            .into_any_element(),
    }
}

/// The server's message for the last change, over the tab.
pub(crate) fn server_error(error: Option<&ErrorView>) -> Option<Alert> {
    error.map(|error| Alert::new(Severity::Error, error.message.clone()))
}

/// A file on its way up: its name and a bar.
pub(crate) fn upload_bar(id: &'static str, upload: Option<&UploadView>, cx: &App) -> Option<Div> {
    let upload = upload?;
    let sem = cx.sem();
    let value = (upload.size_bytes > 0)
        .then(|| (upload.sent_bytes as f32 / upload.size_bytes as f32 * 100.).clamp(0., 100.));
    Some(
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                text(Variant::Caption, format!("Uploading {}…", upload.name))
                    .text_color(sem.text_secondary),
            )
            .child(LinearProgress::new(
                id,
                value,
                format!("Uploading {}", upload.name),
            )),
    )
}

/// Skeleton rows while a list loads.
pub(crate) fn loading_rows(id: &'static str, label: &'static str, rows: usize) -> AnyElement {
    div()
        .id(id)
        .test_support()
        .role(Role::ProgressIndicator)
        .aria_label(label)
        .flex()
        .flex_col()
        .gap(spacing(1.))
        .children((0..rows).map(|index| {
            div()
                .flex()
                .items_center()
                .gap(spacing(2.))
                .px(spacing(1.5))
                .py(spacing(1.))
                .child(Skeleton::circle((id, index * 3), 32.))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(Skeleton::rect((id, index * 3 + 1), relative(0.5), 16.))
                        .child(Skeleton::rect((id, index * 3 + 2), relative(0.3), 12.)),
                )
        }))
        .into_any_element()
}

/// A muted line where a list would be.
pub(crate) fn empty_line(content: impl Into<SharedString>, cx: &App) -> Div {
    div().py(spacing(2.)).flex().justify_center().child(
        text(Variant::Body2, content)
            .text_color(cx.sem().text_secondary)
            .text_center(),
    )
}

/// A user's face, username and display name, as the member rows draw them.
pub(crate) fn user_line(user: &UserView, cx: &App) -> Div {
    let sem = cx.sem();
    let display = user
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != user.username);
    div()
        .flex_1()
        .min_w_0()
        .flex()
        .items_center()
        .gap(spacing(1.5))
        .child(user_face(user, 36., None, cx))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    text(Variant::Body1, user.username.clone())
                        .font_weight(FontWeight(500.))
                        .truncate()
                        .text_color(sem.text_primary),
                )
                .children(display.map(|name| {
                    text(Variant::Body2, name.to_owned())
                        .truncate()
                        .text_color(sem.text_secondary)
                })),
        )
}

/// A user's name for a dialog's sentence.
pub(crate) fn who(user: &UserView) -> String {
    user_name(user)
}

/// The web's `ConfirmDialog`: a sentence, Cancel, and the red action.
pub(crate) struct Confirm {
    pub id: &'static str,
    pub title: &'static str,
    pub message: String,
    pub confirm: &'static str,
    pub busy: bool,
}

impl Confirm {
    pub fn dialog(
        self,
        on_confirm: impl Fn(&mut Window, &mut App) + 'static,
        on_cancel: impl Fn(&mut Window, &mut App) + 'static,
        _cx: &App,
    ) -> Dialog {
        let on_cancel = std::rc::Rc::new(on_cancel);
        let close = on_cancel.clone();
        Dialog::new(self.title)
            .body(text(Variant::Body2, self.message))
            .action(
                Button::new(SharedString::from(format!("{}-cancel", self.id)), "Cancel")
                    .disabled(self.busy)
                    .on_click(move |_, window, cx| on_cancel(window, cx)),
            )
            .action(
                Button::new(
                    SharedString::from(format!("{}-confirm", self.id)),
                    self.confirm,
                )
                .contained()
                .tone(ButtonTone::Danger)
                .loading(self.busy)
                .on_click(move |_, window, cx| on_confirm(window, cx)),
            )
            .on_close(move |window, cx| close(window, cx))
    }
}

/// A chip in a colour of its own: the outlined `Chip color=…` of the web.
pub(crate) fn tone_chip(label: impl Into<SharedString>, color: Hsla) -> crate::kit::Chip {
    crate::kit::Chip::new(label).colors(color.opacity(0.12), color, color)
}

/// Monospace text, for shortcodes and invite codes.
pub(crate) fn mono(content: impl Into<SharedString>, cx: &App) -> Div {
    text(Variant::Body2, content)
        .font_family(crate::messages::palette::Fonts::pick(cx).code)
        .text_color(cx.sem().text_primary)
}

/// A field's error line.
pub(crate) fn field_error(message: impl Into<SharedString>, cx: &App) -> Div {
    text(Variant::Caption, message).text_color(cx.sem().error)
}

/// The picked bytes as something `img` decodes.
pub(crate) fn preview_of(file: &DraftFile) -> Option<ImageSource> {
    let format = match file.mime_type.as_str() {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        "image/gif" => ImageFormat::Gif,
        "image/webp" => ImageFormat::Webp,
        _ => return None,
    };
    Some(ImageSource::Image(Arc::new(Image::from_bytes(
        format,
        file.bytes.clone(),
    ))))
}

/// A stored file through the app's image resolver (`AvatarImages`), when it has the bytes.
pub(crate) fn stored_image(file_id: Option<&str>, cx: &App) -> Option<Img> {
    let file_id = file_id?;
    let images = cx.try_global::<crate::kit::AvatarImages>()?;
    let resource = (images.resolve)(file_id)?;
    Some(img(ImageSource::Resource(resource)).image_cache(&images.cache))
}
