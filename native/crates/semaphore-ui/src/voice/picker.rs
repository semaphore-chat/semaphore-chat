//! Our own screen and window picker, for platforms whose system has none to offer us (X11,
//! Windows). On Wayland the xdg portal's dialog picks instead, and this never shows.
//!
//! The owner keeps a [`PickerModel`] and redraws [`source_picker`] from it; the picker only says what
//! was clicked.

use super::theme::{self, alpha};
use crate::kit::{Button, Dialog, Spinner, Variant, text};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::platform::{CaptureKind, CaptureSource, Thumbnail};
use std::rc::Rc;
use std::sync::Arc;

/// The size thumbnails are asked for, on their long side.
pub const THUMBNAIL_PX: u32 = 320;

const TILE_W: f32 = 184.;
const TILE_IMAGE_H: f32 = 104.;

/// A source as the picker draws it: its thumbnail decoded once, not on every frame.
#[derive(Clone)]
pub struct PickerSource {
    pub id: String,
    pub name: String,
    pub kind: CaptureKind,
    pub image: Option<Arc<RenderImage>>,
}

impl PickerSource {
    pub fn from_capture(source: &CaptureSource) -> Self {
        Self {
            id: source.id.clone(),
            name: source.name.clone(),
            kind: source.kind,
            image: source.thumbnail.as_ref().and_then(thumbnail_image),
        }
    }
}

/// GPUI's `RenderImage` frames are BGRA already, as thumbnails are.
pub fn thumbnail_image(thumbnail: &Thumbnail) -> Option<Arc<RenderImage>> {
    let buffer =
        image::RgbaImage::from_raw(thumbnail.width, thumbnail.height, thumbnail.bgra.clone())?;
    Some(Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])))
}

#[derive(Clone)]
pub enum PickerState {
    /// Listing sources and taking thumbnails, which can take a moment.
    Loading,
    Ready(Vec<PickerSource>),
    Failed(String),
}

#[derive(Clone)]
pub struct PickerModel {
    pub state: PickerState,
    pub tab: CaptureKind,
    pub selected: Option<String>,
}

impl PickerModel {
    pub fn loading() -> Self {
        Self {
            state: PickerState::Loading,
            tab: CaptureKind::Screen,
            selected: None,
        }
    }

    /// The sources arrived. Opens on screens, or on windows when there are no screens.
    pub fn ready(sources: Vec<PickerSource>) -> Self {
        let tab = if sources.is_empty() || sources.iter().any(|s| s.kind == CaptureKind::Screen) {
            CaptureKind::Screen
        } else {
            CaptureKind::Window
        };
        Self {
            state: PickerState::Ready(sources),
            tab,
            selected: None,
        }
    }

    pub fn failed(why: String) -> Self {
        Self {
            state: PickerState::Failed(why),
            tab: CaptureKind::Screen,
            selected: None,
        }
    }

    pub fn count(&self, kind: CaptureKind) -> usize {
        match &self.state {
            PickerState::Ready(sources) => sources.iter().filter(|s| s.kind == kind).count(),
            _ => 0,
        }
    }

    /// The sources on the open tab.
    pub fn shown(&self) -> Vec<&PickerSource> {
        match &self.state {
            PickerState::Ready(sources) => sources.iter().filter(|s| s.kind == self.tab).collect(),
            _ => Vec::new(),
        }
    }

    /// Switches tab. A selection on the other tab is dropped, so Share never shares something
    /// that isn't on screen.
    pub fn set_tab(&mut self, tab: CaptureKind) {
        if self.tab != tab {
            self.tab = tab;
            self.selected = None;
        }
    }

    /// Selects a source on the open tab; anything else is ignored.
    pub fn select(&mut self, id: &str) {
        if self.shown().iter().any(|s| s.id == id) {
            self.selected = Some(id.to_owned());
        }
    }
}

type Handler<T> = Rc<dyn Fn(T, &mut Window, &mut App)>;
type Action = Rc<dyn Fn(&mut Window, &mut App)>;

/// What the picker's clicks do. The owner updates its `PickerModel` and redraws.
pub struct PickerActions {
    pub on_tab: Handler<CaptureKind>,
    pub on_select: Handler<String>,
    pub on_share: Handler<String>,
    pub on_cancel: Action,
}

fn tile(
    source: &PickerSource,
    selected: bool,
    on_select: Handler<String>,
) -> impl IntoElement + use<> {
    let id = source.id.clone();
    let element_id: SharedString = format!("picker-source-{}", source.id).into();
    let picture = div()
        .w(px(TILE_W))
        .h(px(TILE_IMAGE_H))
        .rounded(px(6.))
        .overflow_hidden()
        .bg(theme::grey_900())
        .flex()
        .items_center()
        .justify_center()
        .child(match &source.image {
            Some(image) => img(ImageSource::Render(image.clone()))
                .size_full()
                .object_fit(ObjectFit::Contain)
                .into_any_element(),
            None => text(Variant::Body2, "No preview")
                .text_color(theme::text_secondary())
                .into_any_element(),
        });
    div()
        .id(ElementId::Name(element_id))
        .w(px(TILE_W + 8.))
        .p(px(2.))
        .rounded(px(8.))
        .border_2()
        .border_color(if selected {
            theme::primary()
        } else {
            alpha(theme::primary(), 0.)
        })
        .when(selected, |tile| tile.bg(alpha(theme::primary(), 0.12)))
        .cursor_pointer()
        .hover(|style| style.bg(theme::action_hover()))
        .flex()
        .flex_col()
        .gap(px(4.))
        .role(Role::Button)
        .aria_label(source.name.clone())
        .test_support()
        .on_click(move |_, window, cx| on_select(id.clone(), window, cx))
        .child(picture)
        .child(
            div()
                .px(px(4.))
                .pb(px(2.))
                .text_sm()
                .text_color(theme::white())
                .truncate()
                .child(source.name.clone()),
        )
}

pub fn source_picker(model: &PickerModel, actions: PickerActions) -> impl IntoElement + use<> {
    let PickerActions {
        on_tab,
        on_select,
        on_share,
        on_cancel,
    } = actions;
    let tab_button = |kind: CaptureKind, id: &'static str, name: &str| {
        let on_tab = on_tab.clone();
        let label = format!("{name} ({})", model.count(kind));
        let button = Button::new(id, label).on_click(move |_, window, cx| on_tab(kind, window, cx));
        if model.tab == kind {
            button.contained()
        } else {
            button
        }
    };
    let tabs = div()
        .flex()
        .gap(px(8.))
        .pb(px(12.))
        .child(tab_button(
            CaptureKind::Screen,
            "picker-tab-screens",
            "Screens",
        ))
        .child(tab_button(
            CaptureKind::Window,
            "picker-tab-windows",
            "Windows",
        ));

    let body = match &model.state {
        PickerState::Loading => div()
            .h(px(200.))
            .flex()
            .items_center()
            .justify_center()
            .child(Spinner::new("picker-loading"))
            .into_any_element(),
        PickerState::Failed(why) => div()
            .h(px(120.))
            .flex()
            .items_center()
            .justify_center()
            .child(
                text(
                    Variant::Body2,
                    format!("Couldn't list what to share: {why}"),
                )
                .text_color(theme::error_main()),
            )
            .into_any_element(),
        PickerState::Ready(_) => {
            let shown = model.shown();
            if shown.is_empty() {
                div()
                    .h(px(120.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(text(
                        Variant::Body2,
                        match model.tab {
                            CaptureKind::Screen => "No screens to share",
                            CaptureKind::Window => "No windows to share",
                        },
                    ))
                    .into_any_element()
            } else {
                div()
                    .id("picker-sources")
                    .max_h(px(360.))
                    .overflow_y_scroll()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .children(shown.into_iter().map(|source| {
                        tile(
                            source,
                            model.selected.as_deref() == Some(source.id.as_str()),
                            on_select.clone(),
                        )
                    }))
                    .into_any_element()
            }
        }
    };

    let selected = model.selected.clone();
    let cancel = on_cancel.clone();
    Dialog::new("Share your screen")
        .width(640.)
        .body(div().flex().flex_col().child(tabs).child(body))
        .action(
            Button::new("picker-cancel", "Cancel")
                .on_click(move |_, window, cx| cancel(window, cx)),
        )
        .action(
            Button::new("picker-share", "Share")
                .contained()
                .disabled(selected.is_none())
                .on_click(move |_, window, cx| {
                    if let Some(id) = &selected {
                        on_share(id.clone(), window, cx);
                    }
                }),
        )
        .on_close(move |window, cx| on_cancel(window, cx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    fn source(id: &str, kind: CaptureKind) -> PickerSource {
        PickerSource {
            id: id.into(),
            name: id.into(),
            kind,
            image: None,
        }
    }

    #[test]
    fn opens_on_screens_or_on_windows_when_there_are_none() {
        let both = PickerModel::ready(vec![
            source("w1", CaptureKind::Window),
            source("s1", CaptureKind::Screen),
        ]);
        assert_eq!(both.tab, CaptureKind::Screen);
        assert_eq!(both.shown().len(), 1);
        assert_eq!(both.count(CaptureKind::Window), 1);
        let windows = PickerModel::ready(vec![source("w1", CaptureKind::Window)]);
        assert_eq!(windows.tab, CaptureKind::Window);
    }

    #[test]
    fn a_selection_is_only_ever_on_the_open_tab() {
        let mut model = PickerModel::ready(vec![
            source("s1", CaptureKind::Screen),
            source("w1", CaptureKind::Window),
        ]);
        model.select("w1");
        assert_eq!(model.selected, None, "not on this tab");
        model.select("s1");
        assert_eq!(model.selected.as_deref(), Some("s1"));
        model.set_tab(CaptureKind::Window);
        assert_eq!(model.selected, None, "switching tab drops it");
        model.select("w1");
        assert_eq!(model.selected.as_deref(), Some("w1"));
    }

    #[test]
    fn thumbnails_keep_their_bytes() {
        let thumbnail = Thumbnail {
            width: 2,
            height: 1,
            bgra: vec![1, 2, 3, 255, 4, 5, 6, 255],
        };
        let image = thumbnail_image(&thumbnail).expect("sized right");
        assert_eq!(image.as_bytes(0), Some(&thumbnail.bgra[..]));
        let wrong = Thumbnail {
            width: 3,
            ..thumbnail
        };
        assert!(thumbnail_image(&wrong).is_none());
    }
}
