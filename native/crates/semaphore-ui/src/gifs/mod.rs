//! UG: the GIF picker (featured and search, a grid of previews, the one-click "Allow" notice while
//! "Load images from other sites" is off), after `components/Message/GifPicker.tsx`. The
//! composer's GIF button is this lane's too.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `GifPickerEvent`) is what the app
//! wiring lane builds against while UG draws the screen; change it only with the coordinator.
//!
//! The picker is 320x420 on a desktop, as the web's popover, and fills what it's given on a phone
//! (the web's bottom sheet). The search waits 300 ms before it asks (`useDebounce`), a preview click
//! or Enter on the keyboard's cell picks, and Escape closes; arrows move through the grid while the
//! search field has the caret, as they do in the emoji picker.
//!
//! The picker never loads a picture itself: every preview goes through the `MediaSource` the app
//! sets, which fetches only while third-party pictures are allowed.

mod nav;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use crate::kit::{Button, ButtonSize, Spinner, Variant, spacing, text};
use crate::messages::{CacheKind, Media, MediaState};
use crate::panel::common::{design_icon, icon_button, is_phone};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{
    Enter, Escape, Input, InputEvent, InputState, MoveDown, MoveLeft, MoveRight, MoveUp,
};
use gpui_kit::prelude::*;
use gpui_kit::*;
use nav::{COLUMNS, NavKey};
use semaphore_core::model::{GifResultsView, GifView, LoadState};
use semaphore_design::Icon as DesignIcon;
use std::time::Duration;

/// `SEARCH_DEBOUNCE_MS`: `useDebounce(query, 300)` on the web.
const SEARCH_DEBOUNCE: Duration = Duration::from_millis(300);
/// The web popover's size.
const WIDTH: f32 = 320.;
const HEIGHT: f32 = 420.;
/// `SCROLL_LOAD_THRESHOLD_PX`: ask for the next page this close to the bottom.
const LOAD_THRESHOLD: f32 = 80.;
/// MUI's `grid gap: "4px"`.
const GAP: f32 = 4.;

#[derive(Debug, Clone, PartialEq)]
pub enum GifPickerEvent {
    /// The search changed (debounced 300 ms): the owner reads `Core::gifs(query)`.
    Query(String),
    /// `Core::load_more_gifs(query)`.
    LoadMore,
    /// The notice's "Allow": `Core::set_third_party_media(true)` (the app also saves it).
    Allow,
    /// A GIF was picked: the owner sends `gif.url` as the whole message.
    Pick(GifView),
    Close,
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// The sentence while third-party pictures are off.
const NOTICE: &str = "GIFs load from Giphy, which sees your address.";
/// The lines under the notice's button: two sentences, so neither width breaks the path.
const NOTICE_HINT: &str = "This also loads link-preview images.";
const NOTICE_HINT_2: &str = "You can turn it off in Settings > Desktop app.";

pub struct GifPicker {
    view: GifResultsView,
    images: Option<Media>,
    field: Entity<InputState>,
    /// The field's text as typed, for the 300 ms wait.
    typed: String,
    /// The last `Query` sent (trimmed), so the same text is not asked for twice.
    sent: String,
    debounce: Option<Task<()>>,
    /// The keyboard's result, and the one Enter picks.
    active: usize,
    /// The next page was asked for by scrolling; reset when it arrives.
    more_asked: bool,
    scroll: ScrollHandle,
    focus: FocusHandle,
    /// `focus_search` came while the notice hid the field: the caret goes there once it shows.
    field_wanted: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<GifPickerEvent> for GifPicker {}

impl GifPicker {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx).placeholder("Search GIFs..."));
        let subscriptions = vec![cx.subscribe_in(&field, window, Self::on_field_event)];
        // The web's `autoFocus`: the search is where the typing goes.
        field.update(cx, |field, cx| field.focus(window, cx));
        Self {
            view: GifResultsView::default(),
            images: None,
            field,
            typed: String::new(),
            sent: String::new(),
            debounce: None,
            active: 0,
            more_asked: false,
            scroll: ScrollHandle::new(),
            focus: cx.focus_handle(),
            field_wanted: false,
            _subscriptions: subscriptions,
        }
    }

    /// Where previews come from (`MediaSource::gif`, keyed by `preview_url`): the app's, which
    /// fetches only while third-party pictures are allowed.
    pub fn set_media(
        &mut self,
        media: std::rc::Rc<dyn crate::messages::MediaSource>,
        cx: &mut Context<Self>,
    ) {
        self.images = Some(Media::new(media, cx));
        cx.notify();
    }

    /// `Core::gifs(query)`.
    pub fn set_view(&mut self, view: GifResultsView, cx: &mut Context<Self>) {
        let requery = view.query != self.view.query;
        self.view = view;
        let count = self.view.results.len();
        if requery {
            self.active = 0;
            self.scroll.scroll_to_item(0);
        } else {
            self.active = self.active.min(count.saturating_sub(1));
        }
        if !self.view.loading_more {
            self.more_asked = false;
        }
        cx.notify();
    }

    /// Puts the caret in the search field (the web's `autoFocus`): call it when the picker opens
    /// and after a host update that shows the field again (the notice's "Allow"). While the field
    /// isn't shown (the notice), the picker's own root takes focus so Escape still reaches it.
    pub fn focus_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.view.needs_permission {
            self.field_wanted = true;
            self.focus.focus(window, cx);
        } else {
            self.field_wanted = false;
            self.field.update(cx, |field, cx| field.focus(window, cx));
        }
    }

    fn on_field_event(
        &mut self,
        field: &Entity<InputState>,
        event: &InputEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let InputEvent::Change = event {
            let typed = field.read(cx).value().to_string();
            self.typed_changed(typed, cx);
        }
    }

    /// A changed search waits 300 ms, then asks for what was last typed, as `useDebounce` does.
    fn typed_changed(&mut self, typed: String, cx: &mut Context<Self>) {
        self.debounce = None;
        self.typed = typed;
        if self.typed.trim() == self.sent {
            return;
        }
        self.debounce = Some(cx.spawn(async move |picker, cx| {
            cx.background_executor().timer(SEARCH_DEBOUNCE).await;
            picker
                .update(cx, |picker, cx| {
                    picker.debounce = None;
                    let query = picker.typed.trim().to_owned();
                    if query != picker.sent {
                        picker.sent = query.clone();
                        picker.active = 0;
                        picker.scroll.scroll_to_item(0);
                        cx.emit(GifPickerEvent::Query(query));
                    }
                    cx.notify();
                })
                .ok();
        }));
        cx.notify();
    }

    fn pick(&mut self, index: usize, cx: &mut Context<Self>) {
        if let Some(gif) = self.view.results.get(index) {
            cx.emit(GifPickerEvent::Pick(gif.clone()));
        }
    }

    fn navigate(&mut self, key: NavKey, cx: &mut Context<Self>) -> bool {
        let count = self.view.results.len();
        if count == 0 {
            return false;
        }
        let next = nav::next(key, self.active, count);
        if next != self.active {
            self.active = next;
            self.scroll.scroll_to_item(next / COLUMNS);
            cx.notify();
        }
        true
    }

    fn nav_action(&mut self, key: NavKey, cx: &mut Context<Self>) {
        if self.navigate(key, cx) {
            cx.stop_propagation();
        }
    }

    fn pick_active(&mut self, cx: &mut Context<Self>) -> bool {
        if self.view.results.is_empty() {
            return false;
        }
        self.pick(self.active, cx);
        true
    }

    fn on_up(&mut self, _: &MoveUp, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Up, cx);
    }

    fn on_down(&mut self, _: &MoveDown, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Down, cx);
    }

    fn on_left(&mut self, _: &MoveLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Left, cx);
    }

    fn on_right(&mut self, _: &MoveRight, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Right, cx);
    }

    fn on_enter(&mut self, _: &Enter, _: &mut Window, cx: &mut Context<Self>) {
        if self.pick_active(cx) {
            cx.stop_propagation();
        }
    }

    fn on_escape(&mut self, _: &Escape, _: &mut Window, cx: &mut Context<Self>) {
        cx.emit(GifPickerEvent::Close);
        cx.stop_propagation();
    }

    /// Keys while the picker itself has focus (the field's keys arrive as its actions above).
    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.field.read(cx).focus_handle(cx).is_focused(window) {
            return;
        }
        let key = event.keystroke.key.as_str();
        if let Some(nav) = NavKey::from_key(key) {
            self.nav_action(nav, cx);
        } else if key == "enter" {
            if self.pick_active(cx) {
                cx.stop_propagation();
            }
        } else if key == "escape" {
            cx.emit(GifPickerEvent::Close);
            cx.stop_propagation();
        }
    }

    /// Near the bottom: ask for the next page once, until it arrives.
    fn on_scroll(&mut self, _: &ScrollEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.view.more || self.view.loading_more || self.more_asked {
            return;
        }
        let left = self.scroll.max_offset().y - self.scroll.offset().y;
        if left < px(LOAD_THRESHOLD) {
            self.more_asked = true;
            cx.emit(GifPickerEvent::LoadMore);
        }
    }

    fn search_field(
        &self,
        touch: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let focused = self.field.read(cx).focus_handle(cx).is_focused(window);
        let (fill, primary, disabled, secondary) = (
            sem.action_hover,
            sem.primary,
            sem.text_disabled,
            sem.text_secondary,
        );
        div()
            .id("gif-search")
            .h(px(if touch { 44. } else { 36. }))
            .w_full()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(px(12.))
            .rounded(px(8.))
            .bg(fill)
            .border_1()
            .border_color(if focused {
                primary
            } else {
                transparent_black()
            })
            .child(design_icon(DesignIcon::Search, 20., disabled))
            .child(
                div().flex_1().min_w_0().child(
                    Input::new(&self.field)
                        .aria_label("Search GIFs")
                        .appearance(false)
                        .px_0()
                        .text_size(px(14.)),
                ),
            )
            .when(!self.typed.is_empty(), |frame| {
                frame.child(
                    icon_button(
                        "gif-search-clear",
                        DesignIcon::Clear,
                        "Clear search",
                        false,
                        secondary,
                        cx,
                    )
                    .size(px(26.))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.field
                            .update(cx, |field, cx| field.set_value("", window, cx));
                        this.typed_changed(String::new(), cx);
                        this.focus_search(window, cx);
                    })),
                )
            })
    }

    fn header(
        &self,
        touch: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let (divider, secondary, primary_text) =
            (sem.divider, sem.text_secondary, sem.text_primary);
        let searching = !self.view.needs_permission;
        div()
            .flex_shrink_0()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(px(12.))
            .pt(px(12.))
            .pb(spacing(1.))
            .border_b_1()
            .border_color(divider)
            .when(searching, |row| {
                row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(self.search_field(touch, window, cx)),
                )
            })
            .when(!searching, |row| {
                row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(text(Variant::Subtitle1, "GIFs").text_color(primary_text)),
                )
            })
            .child(
                icon_button(
                    "gif-close",
                    DesignIcon::Close,
                    "Close GIFs",
                    touch,
                    secondary,
                    cx,
                )
                .on_click(cx.listener(|_, _, _, cx| cx.emit(GifPickerEvent::Close))),
            )
    }

    fn preview(
        &self,
        index: usize,
        gif: &GifView,
        active: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem();
        let (placeholder, primary, disabled) = (sem.action_hover, sem.primary, sem.text_disabled);
        let ratio = if gif.width > 0 && gif.height > 0 {
            gif.width as f32 / gif.height as f32
        } else {
            1.
        };
        let picture = match self.images.as_ref().map(|images| {
            images.resolve(
                images.source.gif(&gif.preview_url),
                CacheKind::Images,
                window,
                cx,
            )
        }) {
            Some(MediaState::Ready(image)) => img(image)
                .size_full()
                .object_fit(ObjectFit::Cover)
                .into_any_element(),
            Some(MediaState::Loading) | None => div().into_any_element(),
            Some(MediaState::Failed) => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .child(design_icon(DesignIcon::GifBoxOutlined, 20., disabled))
                .into_any_element(),
        };
        let label = if gif.title.is_empty() {
            "GIF".to_owned()
        } else {
            gif.title.clone()
        };
        base::Button::new(ElementId::Name(format!("gif-{}", gif.id).into()))
            .accessibility_label(label)
            .selected(active)
            .flex_1()
            .min_w_0()
            .aspect_ratio(ratio)
            .flex()
            .flex_col()
            .rounded(px(6.))
            .overflow_hidden()
            .bg(placeholder)
            .border_2()
            .border_color(if active { primary } else { transparent_black() })
            .cursor_pointer()
            .hover(move |style| style.opacity(0.85))
            .child(picture)
            .on_click(cx.listener(move |this, _, _, cx| this.pick(index, cx)))
            .into_any_element()
    }

    fn notice(&self, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem();
        let (primary, secondary, disabled) =
            (sem.text_primary, sem.text_secondary, sem.text_disabled);
        div()
            .id("gif-permission")
            .test_support()
            .role(Role::Status)
            .aria_label(NOTICE)
            .flex_1()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(spacing(1.5))
            .px(spacing(1.5))
            .py(spacing(3.))
            .child(design_icon(DesignIcon::GifBoxOutlined, 40., disabled))
            .child(
                text(Variant::Body2, NOTICE)
                    .text_color(primary)
                    .text_center(),
            )
            .child(
                Button::new("gif-allow", "Allow")
                    .contained()
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.focus_search(window, cx);
                        cx.emit(GifPickerEvent::Allow)
                    })),
            )
            .child(
                // Two lines, so neither width breaks the Settings path in the middle.
                div()
                    .flex()
                    .flex_col()
                    .text_color(secondary)
                    .child(text(Variant::Caption, NOTICE_HINT).text_center())
                    .child(text(Variant::Caption, NOTICE_HINT_2).text_center()),
            )
            .into_any_element()
    }

    fn loading(&self) -> AnyElement {
        div()
            .id("gif-loading")
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .py(spacing(4.))
            .child(Spinner::new("gif-loading-spinner").size(28.))
            .into_any_element()
    }

    fn failed(
        &self,
        error: &semaphore_core::model::ErrorView,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        div()
            .id("gif-failed")
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .justify_center()
            .child(crate::panel::common::error_block(
                "gif-retry",
                "Couldn't load GIFs",
                error.message.clone(),
                cx.listener(|this, _, window, cx| {
                    this.focus_search(window, cx);
                    cx.emit(GifPickerEvent::Retry)
                }),
                cx,
            ))
            .into_any_element()
    }

    fn empty(&self, cx: &mut Context<Self>) -> AnyElement {
        let disabled = cx.sem().text_disabled;
        div()
            .id("gif-empty")
            .test_support()
            .role(Role::Status)
            .aria_label("No GIFs found")
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .py(spacing(4.))
            .child(text(Variant::Body2, "No GIFs found").text_color(disabled))
            .into_any_element()
    }

    /// The results: the rows themselves are the scroller's children, so `scroll_to_item` finds the
    /// keyboard's row. "Load more" or its spinner waits in the footer, always in reach.
    fn results(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let active = self.active;
        let mut children: Vec<AnyElement> = Vec::new();
        for (row, gifs) in self.view.results.chunks(COLUMNS).enumerate() {
            let mut cells: Vec<AnyElement> = gifs
                .iter()
                .enumerate()
                .map(|(column, gif)| {
                    let index = row * COLUMNS + column;
                    self.preview(index, gif, index == active, window, cx)
                })
                .collect();
            // A short last row keeps the columns, as the emoji grid's does.
            if gifs.len() < COLUMNS {
                cells.push(div().flex_1().min_w_0().into_any_element());
            }
            children.push(
                div()
                    .flex_shrink_0()
                    .w_full()
                    .flex()
                    .gap(px(GAP))
                    .children(cells)
                    .into_any_element(),
            );
        }
        div()
            .id("gif-grid")
            .test_support()
            .role(Role::Group)
            .aria_label("GIFs")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .on_scroll(cx.listener(Self::on_scroll))
            .flex()
            .flex_col()
            .gap(px(GAP))
            .px(spacing(1.))
            .py(spacing(1.))
            .children(children)
            .into_any_element()
    }

    fn body(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if self.view.needs_permission {
            return self.notice(cx);
        }
        match &self.view.state {
            LoadState::Loading => self.loading(),
            LoadState::Failed { error } => {
                let error = error.clone();
                self.failed(&error, cx)
            }
            LoadState::Ready if self.view.results.is_empty() => self.empty(cx),
            LoadState::Ready => self.results(window, cx),
        }
    }
}

impl Focusable for GifPicker {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for GifPicker {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        if self.field_wanted && !self.view.needs_permission {
            self.focus_search(window, cx);
        }
        let header = self.header(touch, window, cx);
        let body = self.body(window, cx);
        let sem = cx.sem();
        let (paper, divider, primary, secondary) =
            (sem.paper, sem.divider, sem.primary, sem.text_secondary);
        div()
            .id("gif-picker")
            .test_support()
            .role(Role::Dialog)
            .aria_label("GIF picker")
            .track_focus(&self.focus)
            .key_context("GifPicker")
            .capture_action(cx.listener(Self::on_up))
            .capture_action(cx.listener(Self::on_down))
            .capture_action(cx.listener(Self::on_left))
            .capture_action(cx.listener(Self::on_right))
            .capture_action(cx.listener(Self::on_enter))
            .capture_action(cx.listener(Self::on_escape))
            .on_key_down(cx.listener(Self::on_key_down))
            .when(touch, |picker| picker.size_full())
            .when(!touch, |picker| picker.w(px(WIDTH)).h(px(HEIGHT)))
            .flex()
            .flex_col()
            .bg(paper)
            .child(header)
            .child(body)
            .child(
                div()
                    .flex_shrink_0()
                    .px(px(12.))
                    .py(spacing(0.5))
                    .border_t_1()
                    .border_color(divider)
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(div().flex().items_center().when(
                        self.view.more || self.view.loading_more,
                        |next| {
                            next.child(if self.view.loading_more {
                                Spinner::new("gif-more-spinner")
                                    .size(20.)
                                    .into_any_element()
                            } else {
                                Button::new("gif-more", "Load more")
                                    .size(ButtonSize::Small)
                                    .color(primary)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.focus_search(window, cx);
                                        cx.emit(GifPickerEvent::LoadMore)
                                    }))
                                    .into_any_element()
                            })
                        },
                    ))
                    .child(text(Variant::Caption, "Powered by GIPHY").text_color(secondary)),
            )
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
