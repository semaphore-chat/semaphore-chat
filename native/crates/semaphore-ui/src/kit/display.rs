//! What only shows something: Icon, Avatar, Badge, Chip, Progress, Skeleton, Alert, Snackbar.

use super::live::LiveElement;
use super::{Variant, icon_path, text};
use crate::theme::SemTheme;
use crate::theme::color::{darken, hsla_of, lighten};
use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::progress::{Progress as KitProgress, ProgressCircle};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::{Icon as IconName, Rgba as Token};
use std::time::Duration;

/// Whether anything may animate. `rig-shot` turns motion off so a screenshot can't catch a frame
/// mid-animation; the app should follow the OS setting.
#[derive(Default)]
struct Motion {
    reduced: bool,
}

impl Global for Motion {}

pub fn set_reduced_motion(reduced: bool, cx: &mut App) {
    cx.default_global::<Motion>().reduced = reduced;
}

pub fn reduced_motion(cx: &App) -> bool {
    cx.try_global::<Motion>()
        .is_some_and(|motion| motion.reduced)
}

/// A web icon, tinted. It inherits the text colour unless given one.
#[derive(IntoElement)]
pub struct Icon {
    icon: IconName,
    size: f32,
    color: Option<Hsla>,
}

impl Icon {
    pub fn new(icon: IconName) -> Self {
        Self {
            icon,
            size: 24.,
            color: None,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }
}

impl RenderOnce for Icon {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or_else(|| window.text_style().color);
        svg()
            .path(icon_path(self.icon))
            .size(px(self.size))
            .flex_shrink_0()
            .text_color(color)
    }
}

/// MuiAvatar: an image, or initials on a colour. No image source reaches the UI yet, so `image` is
/// what the file layer will fill; a voice or member row draws the fallback until then.
#[derive(IntoElement)]
pub struct Avatar {
    label: SharedString,
    size: f32,
    background: Option<Hsla>,
    foreground: Option<Hsla>,
    image: Option<ImageSource>,
    /// A file id to draw through the app's [`AvatarImages`], when it has one.
    file: Option<SharedString>,
    font_size: Option<f32>,
}

/// A file id to a resource, once its bytes are at hand.
pub type AvatarResolver = std::rc::Rc<dyn Fn(&str) -> Option<Resource>>;

/// Where avatar files come from in the app: a resource for a file id once its bytes are at hand
/// (`None` while they aren't, or never will be), and the bounded cache the decodes live in. Without
/// it, as in stories, avatars are initials.
pub struct AvatarImages {
    pub resolve: AvatarResolver,
    pub cache: Entity<crate::messages::LruImageCache>,
}

impl Global for AvatarImages {}

impl Avatar {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            size: 40.,
            background: None,
            foreground: None,
            image: None,
            file: None,
            font_size: None,
        }
    }

    /// The avatar's file, drawn over the initials once the app has it.
    pub fn file(mut self, file_id: Option<&str>) -> Self {
        self.file = file_id.map(|id| SharedString::from(id.to_owned()));
        self
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn background(mut self, color: Hsla) -> Self {
        self.background = Some(color);
        self
    }

    pub fn foreground(mut self, color: Hsla) -> Self {
        self.foreground = Some(color);
        self
    }

    /// A label size other than 40% of the side.
    pub fn text_size_override(mut self, size: f32) -> Self {
        self.font_size = Some(size);
        self
    }

    pub fn image(mut self, image: Option<ImageSource>) -> Self {
        self.image = image;
        self
    }
}

impl RenderOnce for Avatar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        // MUI's fallback: grey[400] in light mode, grey[600] in dark.
        let fallback = hsla_of(if sem.is_dark {
            sem.palette.grey_600
        } else {
            sem.palette.grey_400
        });
        let background = self.background.unwrap_or(fallback);
        let foreground = self
            .foreground
            .unwrap_or_else(|| hsla_of(sem.palette.common_white));
        // As the fixture's SVG avatars and the rail's `fontSize` do: 40% of the side.
        let font_size = self.font_size.unwrap_or((self.size * 0.4).round());
        let file = self.file.as_ref().and_then(|file_id| {
            let images = cx.try_global::<AvatarImages>()?;
            Some(((images.resolve)(file_id)?, images.cache.clone()))
        });
        let label = self.label.clone();
        div()
            .size(px(self.size))
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .rounded_full()
            .overflow_hidden()
            .bg(background)
            .text_color(foreground)
            .map(|avatar| match (self.image, file) {
                (Some(source), _) => {
                    avatar.child(img(source).size_full().object_fit(ObjectFit::Cover))
                }
                // Initials until the image is decoded, and if it never is.
                (None, Some((resource, cache))) => avatar.child(
                    img(ImageSource::Resource(resource))
                        .image_cache(&cache)
                        .size_full()
                        // The parent's clip is a rectangle: the image rounds itself.
                        .rounded_full()
                        .object_fit(ObjectFit::Cover)
                        .with_fallback(move || {
                            text(Variant::Body2, label.clone())
                                .text_size(px(font_size))
                                .font_weight(FontWeight(700.))
                                .into_any_element()
                        }),
                ),
                (None, None) => avatar.child(
                    text(Variant::Body2, self.label)
                        .text_size(px(font_size))
                        .line_height(px(font_size + 2.))
                        .font_weight(FontWeight(700.)),
                ),
            })
    }
}

/// MuiBadge in its `error` colour: a count, capped at `99+`, either alone or overlapping a child.
#[derive(IntoElement)]
pub struct Badge {
    count: u32,
    child: Option<AnyElement>,
    height: f32,
}

impl Badge {
    pub fn new(count: u32) -> Self {
        Self {
            count,
            child: None,
            height: 20.,
        }
    }

    /// The compact one on a channel row.
    pub fn compact(mut self) -> Self {
        self.height = 16.;
        self
    }

    /// Overlaps this child, at its top right. A count of zero then draws the child alone.
    pub fn on(mut self, child: impl IntoElement) -> Self {
        self.child = Some(child.into_any_element());
        self
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let height = self.height;
        let label: SharedString = if self.count > 99 {
            "99+".into()
        } else {
            self.count.to_string().into()
        };
        let pill = (self.count > 0).then(|| {
            div()
                .h(px(height))
                .min_w(px(height))
                .px(px(if height > 16. { 6. } else { 4. }))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(height / 2.))
                .bg(sem.error)
                .text_color(hsla_of(sem.palette.error_contrast_text))
                .child(
                    text(Variant::Xs, label)
                        .text_size(px(if height > 16. { 12. } else { 11. }))
                        .line_height(px(height))
                        .font_weight(FontWeight(500.)),
                )
        });
        match self.child {
            None => div().flex_shrink_0().children(pill),
            Some(child) => div().relative().flex_shrink_0().child(child).children(
                pill.map(|pill| div().absolute().top(px(-3.)).right(px(-6.)).child(pill)),
            ),
        }
    }
}

/// MuiChip with the theme's accent tint and AA-checked text.
#[derive(IntoElement)]
pub struct Chip {
    label: SharedString,
    icon: Option<AnyElement>,
    border: Option<Hsla>,
    text_color: Option<Hsla>,
    background: Option<Hsla>,
}

impl Chip {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            border: None,
            text_color: None,
            background: None,
        }
    }

    pub fn icon(mut self, icon: impl IntoElement) -> Self {
        self.icon = Some(icon.into_any_element());
        self
    }

    /// The connection banner's warning look.
    pub fn colors(mut self, background: Hsla, border: Hsla, text_color: Hsla) -> Self {
        self.background = Some(background);
        self.border = Some(border);
        self.text_color = Some(text_color);
        self
    }
}

impl RenderOnce for Chip {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let border = self.border.or(sem.chip_border);
        div()
            .h(px(24.))
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(4.))
            .pl(px(if self.icon.is_some() { 5. } else { 8. }))
            .pr(px(8.))
            .rounded(px(12.))
            .bg(self.background.unwrap_or(sem.chip_bg))
            .text_color(self.text_color.unwrap_or(sem.chip_text))
            .when_some(border, |chip, color| chip.border_1().border_color(color))
            .children(self.icon)
            .child(
                text(Variant::Xs, self.label)
                    .text_size(px(13.))
                    .line_height(px(18.)),
            )
    }
}

/// MuiLinearProgress: `value` is 0-100, or `None` while indeterminate.
#[derive(IntoElement)]
pub struct LinearProgress {
    id: ElementId,
    value: Option<f32>,
    label: SharedString,
}

impl LinearProgress {
    pub fn new(
        id: impl Into<ElementId>,
        value: Option<f32>,
        label: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            value,
            label: label.into(),
        }
    }
}

impl RenderOnce for LinearProgress {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let animate = self.value.is_none() && !reduced_motion(cx);
        KitProgress::new(self.id)
            .accessibility_label(self.label)
            .color(sem.progress_bar)
            .value(self.value.unwrap_or(40.))
            .loading(animate)
            .h(px(4.))
            .rounded(px(0.))
            .bg(sem.progress_track)
    }
}

/// MuiCircularProgress. With motion off it holds still at three quarters, so a screenshot is exact.
#[derive(IntoElement)]
pub struct Spinner {
    id: ElementId,
    size: f32,
    color: Option<Hsla>,
}

impl Spinner {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: 40.,
            color: None,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }
}

impl RenderOnce for Spinner {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or(cx.sem().control_on);
        let animate = !reduced_motion(cx);
        ProgressCircle::new(self.id)
            .accessibility_label("Loading")
            .color(color)
            .value(75.)
            .loading(animate)
            .size(px(self.size))
    }
}

/// MuiSkeleton: `text` and rounded rows, or a circle. Pulses unless motion is off.
#[derive(IntoElement)]
pub struct Skeleton {
    width: Length,
    height: f32,
    radius: f32,
    key: ElementId,
}

impl Skeleton {
    pub fn rect(key: impl Into<ElementId>, width: impl Into<Length>, height: f32) -> Self {
        Self {
            width: width.into(),
            height,
            radius: 4.,
            key: key.into(),
        }
    }

    pub fn circle(key: impl Into<ElementId>, size: f32) -> Self {
        Self {
            width: px(size).into(),
            height: size,
            radius: size,
            key: key.into(),
        }
    }
}

impl RenderOnce for Skeleton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        // MUI: `action.hover` at 0.11 in light mode and 0.13 in dark, on text.primary.
        let sem = cx.sem();
        let color = sem
            .text_primary
            .opacity(if sem.is_dark { 0.13 } else { 0.11 });
        let shape = div()
            .w(self.width)
            .h(px(self.height))
            .rounded(px(self.radius))
            .bg(color);
        if reduced_motion(cx) {
            return shape.into_any_element();
        }
        shape
            .with_animation(
                self.key,
                Animation::new(Duration::from_millis(1500))
                    .repeat()
                    .with_easing(pulsating_between(0.4, 1.)),
                |shape, delta| shape.opacity(delta),
            )
            .into_any_element()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Info,
    Success,
}

/// MuiAlert, `standard`: MUI darkens the severity's light tone by 0.9 in dark mode for the ground and
/// lightens it by 0.6 for the text, and the reverse in light mode.
#[derive(IntoElement)]
pub struct Alert {
    severity: Severity,
    message: SharedString,
}

impl Alert {
    pub fn new(severity: Severity, message: impl Into<SharedString>) -> Self {
        Self {
            severity,
            message: message.into(),
        }
    }
}

impl RenderOnce for Alert {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let tones = sem.palette;
        let (light, main, icon): (Token, Token, IconName) = match self.severity {
            Severity::Error => (tones.error_light, tones.error_main, IconName::ErrorOutline),
            Severity::Warning => (
                tones.warning_light,
                tones.warning_main,
                IconName::WarningAmber,
            ),
            Severity::Info => (tones.info_light, tones.info_main, IconName::InfoOutlined),
            Severity::Success => (
                tones.success_light,
                tones.success_main,
                IconName::CheckCircleOutline,
            ),
        };
        let (ground, foreground) = if sem.is_dark {
            (darken(light, 0.9), lighten(light, 0.6))
        } else {
            (lighten(light, 0.9), darken(light, 0.6))
        };
        // An alert, so a screen reader reads it out when it appears: "your session has expired".
        // The web's `Alert` (MUI) is `role="alert"`, which browsers treat as assertive live.
        div()
            .id("alert")
            .test_support()
            .role(Role::Alert)
            .aria_label(self.message.clone())
            .aria_live(Live::Assertive)
            .w_full()
            .flex()
            .gap(px(12.))
            .px(px(16.))
            .py(px(6.))
            .rounded(px(4.))
            .bg(hsla_of(ground))
            .text_color(hsla_of(foreground))
            .child(
                div()
                    .py(px(7.))
                    .child(Icon::new(icon).size(22.).color(hsla_of(main))),
            )
            .child(
                div()
                    .py(px(8.))
                    .flex_1()
                    .min_w_0()
                    .child(text(Variant::Body2, self.message)),
            )
    }
}

/// MuiSnackbarContent as the theme overrides it. The owner decides when it goes away.
#[derive(IntoElement)]
pub struct Snackbar {
    message: SharedString,
    action: Option<AnyElement>,
}

impl Snackbar {
    pub fn new(message: impl Into<SharedString>) -> Self {
        Self {
            message: message.into(),
            action: None,
        }
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl RenderOnce for Snackbar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .occlude()
            .min_w(px(288.))
            .max_w(px(560.))
            .min_h(px(48.))
            .flex()
            .items_center()
            .justify_between()
            .gap(px(8.))
            .px(px(16.))
            .py(px(6.))
            .rounded(px(4.))
            .border_1()
            .border_color(sem.snackbar_border)
            .bg(sem.snackbar_bg)
            .text_color(sem.snackbar_text)
            .shadow_lg()
            .child(text(Variant::Body2, self.message))
            .children(self.action)
    }
}
