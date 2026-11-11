//! `UserSearchAutocomplete`: a search field over the server's user search, the users it found,
//! and the ones picked. Used by the create DM dialog (several) and the add friend form (one).
//!
//! `PickerModel` holds what was typed, asked and found, with no GPUI in it. The search goes out
//! 300 ms after typing stops (`useDebounce(inputValue.trim(), 300)`); the owner answers with
//! `UserPicker::set_results` for that query, and results for any other query are dropped.

use super::face::user_face;
use super::names::user_name;
use crate::kit::{Spinner, TextField, Variant, spacing, text};
use crate::panel::common::{design_icon, icon_button};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::UserView;
use semaphore_design::Icon as DesignIcon;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

pub(crate) const DEBOUNCE: Duration = Duration::from_millis(300);
/// What the web asks for: `limit: 25`.
pub const SEARCH_LIMIT: u32 = 25;

/// What the search found for the query it was asked with.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) enum Found {
    /// Nothing typed: "Type to search...".
    #[default]
    Idle,
    Loading,
    Failed(String),
    Ready(Vec<UserView>),
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PickerModel {
    pub multiple: bool,
    text: String,
    /// The query the latest search went out with.
    asked: Option<String>,
    found: Found,
    picked: Vec<UserView>,
    excluded: HashSet<String>,
}

impl PickerModel {
    pub fn new(multiple: bool) -> Self {
        Self {
            multiple,
            ..Self::default()
        }
    }

    /// The field changed. True when a search should go out once the debounce runs out.
    pub fn set_text(&mut self, text: &str) -> bool {
        let trimmed = text.trim().to_owned();
        if trimmed == self.text && !trimmed.is_empty() {
            // Only spaces changed: the same search stands.
            return false;
        }
        self.text = trimmed.clone();
        if trimmed.is_empty() {
            self.asked = None;
            self.found = Found::Idle;
            return false;
        }
        self.found = Found::Loading;
        true
    }

    /// The debounce ran out: the query to search for, unless it already went out.
    pub fn debounce_elapsed(&mut self) -> Option<String> {
        if self.text.is_empty() || self.asked.as_deref() == Some(self.text.as_str()) {
            return None;
        }
        self.asked = Some(self.text.clone());
        Some(self.text.clone())
    }

    /// Results for `query`. False, and dropped, unless it is the query asked last.
    pub fn accept(&mut self, query: &str, results: Result<Vec<UserView>, String>) -> bool {
        if self.asked.as_deref() != Some(query) || self.text != query {
            return false;
        }
        self.found = match results {
            Ok(users) => Found::Ready(users),
            Err(message) => Found::Failed(message),
        };
        true
    }

    /// As if `query` was typed, asked and answered: for stories.
    #[cfg(feature = "stories")]
    pub fn preset(&mut self, query: &str, found: Found) {
        self.text = query.trim().to_owned();
        self.asked = Some(self.text.clone());
        self.found = found;
    }

    pub fn set_excluded(&mut self, ids: impl IntoIterator<Item = String>) {
        self.excluded = ids.into_iter().collect();
        self.picked.retain(|user| !self.excluded.contains(&user.id));
    }

    pub fn found(&self) -> &Found {
        &self.found
    }

    /// The users to offer: found ones, less the excluded and (when several can be picked) the
    /// picked.
    pub fn options(&self) -> Vec<UserView> {
        let Found::Ready(users) = &self.found else {
            return Vec::new();
        };
        let mut seen = HashSet::new();
        users
            .iter()
            .filter(|user| !self.excluded.contains(&user.id))
            .filter(|user| !self.multiple || !self.picked.iter().any(|p| p.id == user.id))
            .filter(|user| seen.insert(user.id.clone()))
            .cloned()
            .collect()
    }

    /// Picks `user`: added to the picked ones, or in place of the one picked before.
    pub fn pick(&mut self, user: UserView) {
        if self.excluded.contains(&user.id) {
            return;
        }
        if !self.multiple {
            self.picked = vec![user];
        } else if !self.picked.iter().any(|p| p.id == user.id) {
            self.picked.push(user);
        }
    }

    pub fn unpick(&mut self, user_id: &str) {
        self.picked.retain(|user| user.id != user_id);
    }

    pub fn picked(&self) -> &[UserView] {
        &self.picked
    }

    pub fn clear(&mut self) {
        self.text.clear();
        self.asked = None;
        self.found = Found::Idle;
        self.picked.clear();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserPickerEvent {
    /// Debounced. The owner calls `Core::search_users(query, Some(SEARCH_LIMIT))` and answers
    /// with `set_results` for this same query.
    Search { query: String },
    /// The picked users changed.
    Changed,
}

/// The search field, the picked users as chips, and what the search found.
pub struct UserPicker {
    id: &'static str,
    label: SharedString,
    pub(crate) model: PickerModel,
    field: Entity<InputState>,
    debounce: Option<Task<()>>,
    /// A chip by a found user ("Friends", "Request Sent"), as the add friend form shows.
    tags: HashMap<String, SharedString>,
    disabled: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<UserPickerEvent> for UserPicker {}

impl UserPicker {
    /// `id` prefixes its element ids; `multiple`: pick several.
    pub fn new(
        id: &'static str,
        label: impl Into<SharedString>,
        multiple: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx));
        let subscriptions = vec![cx.subscribe_in(&field, window, Self::on_field_event)];
        Self {
            id,
            label: label.into(),
            model: PickerModel::new(multiple),
            field,
            debounce: None,
            tags: HashMap::new(),
            disabled: false,
            _subscriptions: subscriptions,
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
            let text = field.read(cx).value().to_string();
            self.query_changed(&text, cx);
        }
    }

    /// The field's text changed: (re)start the debounce, or settle at once on an empty query.
    pub(crate) fn query_changed(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.model.set_text(text) {
            self.debounce = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(DEBOUNCE).await;
                this.update(cx, |this, cx| {
                    this.debounce = None;
                    if let Some(query) = this.model.debounce_elapsed() {
                        cx.emit(UserPickerEvent::Search { query });
                    }
                    cx.notify();
                })
                .ok();
            }));
        } else if text.trim().is_empty() {
            self.debounce = None;
        }
        // Otherwise the same query stands, and so does its debounce: a field reports one change
        // per keystroke, and may read the whole text for each of them.
        cx.notify();
    }

    /// What `Core::search_users` returned for `query`, or its error's message.
    pub fn set_results(
        &mut self,
        query: &str,
        results: Result<Vec<UserView>, String>,
        cx: &mut Context<Self>,
    ) {
        if self.model.accept(query, results) {
            cx.notify();
        }
    }

    /// Users never offered: this user, and the members a conversation already has.
    pub fn set_excluded(&mut self, user_ids: Vec<String>, cx: &mut Context<Self>) {
        self.model.set_excluded(user_ids);
        cx.notify();
    }

    /// Shows `query` in the field with `found` under it, as if searched: for stories.
    #[cfg(feature = "stories")]
    pub(crate) fn preset(
        &mut self,
        query: &str,
        found: Found,
        picked: Vec<UserView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.field.update(cx, |field, cx| {
            field.set_value(query.to_owned(), window, cx)
        });
        self.model.preset(query, found);
        for user in picked {
            self.model.pick(user);
        }
        self.debounce = None;
        cx.notify();
    }

    pub(crate) fn set_tags(&mut self, tags: HashMap<String, SharedString>, cx: &mut Context<Self>) {
        self.tags = tags;
        cx.notify();
    }

    pub(crate) fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        self.disabled = disabled;
        cx.notify();
    }

    pub fn picked(&self) -> &[UserView] {
        self.model.picked()
    }

    pub(crate) fn pick(&mut self, user: UserView, cx: &mut Context<Self>) {
        self.model.pick(user);
        cx.emit(UserPickerEvent::Changed);
        cx.notify();
    }

    pub(crate) fn unpick(&mut self, user_id: &str, cx: &mut Context<Self>) {
        self.model.unpick(user_id);
        cx.emit(UserPickerEvent::Changed);
        cx.notify();
    }

    /// Empties the field and the picks, as the dialog does once it is done.
    pub fn clear(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.model.clear();
        self.debounce = None;
        self.field
            .update(cx, |field, cx| field.set_value("", window, cx));
        cx.notify();
    }

    pub fn focus_field(&self, window: &mut Window, cx: &mut App) {
        self.field.update(cx, |field, cx| field.focus(window, cx));
    }

    fn chip(&self, user: &UserView, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let name = user_name(user);
        let id = user.id.clone();
        let remove = icon_button(
            ElementId::Name(format!("{}-unpick-{}", self.id, user.id).into()),
            DesignIcon::Cancel,
            format!("Remove {name}"),
            false,
            sem.text_secondary,
            cx,
        )
        .size(px(22.))
        .disabled(self.disabled)
        .on_click(cx.listener(move |picker, _, _, cx| picker.unpick(&id, cx)));
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .max_w_full()
            .min_w_0()
            .h(px(32.))
            .pl(px(4.))
            .pr(px(2.))
            .rounded(px(16.))
            .bg(sem.chip_bg)
            .text_color(sem.chip_text)
            .child(user_face(user, 24., None, cx))
            .child(text(Variant::Body2, name).min_w_0().truncate())
            .child(remove)
    }

    fn option_row(&self, user: &UserView, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let (hover, primary, secondary) = (sem.action_hover, sem.text_primary, sem.text_secondary);
        let (chip_bg, chip_text) = (sem.chip_bg, sem.chip_text);
        let name = user_name(user);
        let tag = self.tags.get(&user.id).cloned();
        let picked = !self.model.multiple && self.model.picked().iter().any(|p| p.id == user.id);
        let selected = sem.action_selected;
        let chosen = user.clone();
        let mut label = format!("{name}, @{}", user.username);
        if let Some(tag) = &tag {
            label.push_str(&format!(", {tag}"));
        }
        // A user with a tag is already a friend or has a request pending: not offered again.
        let locked = self.disabled || tag.is_some();
        base::Button::new(ElementId::Name(
            format!("{}-user-{}", self.id, user.id).into(),
        ))
        .accessibility_label(label)
        .disabled(locked)
        .when(tag.is_some(), |row| row.opacity(0.7))
        .w_full()
        .min_h(px(48.))
        .flex()
        .items_center()
        .gap(spacing(1.5))
        .px(spacing(2.))
        .py(px(6.))
        .cursor_pointer()
        .when(picked, |row| row.bg(selected))
        .hover(move |style| style.bg(hover))
        .focus_visible(move |style| style.bg(hover))
        .child(user_face(user, 32., None, cx))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(text(Variant::Body1, name).text_color(primary).truncate())
                .child(
                    text(Variant::Caption, format!("@{}", user.username))
                        .text_color(secondary)
                        .truncate(),
                ),
        )
        .children(tag.map(|tag| {
            div()
                .flex_shrink_0()
                .px(px(8.))
                .h(px(24.))
                .flex()
                .items_center()
                .rounded(px(12.))
                .bg(chip_bg)
                .text_color(chip_text)
                .child(text(Variant::Caption, tag))
        }))
        .when(!locked, |row| {
            row.on_click(cx.listener(move |picker, _, _, cx| picker.pick(chosen.clone(), cx)))
        })
    }
}

impl Render for UserPicker {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let chips: Vec<AnyElement> = if self.model.multiple {
            self.model
                .picked()
                .to_vec()
                .iter()
                .map(|user| self.chip(user, cx).into_any_element())
                .collect()
        } else {
            Vec::new()
        };
        let status = |line: &str| {
            text(Variant::Body2, line.to_owned())
                .px(spacing(2.))
                .py(spacing(1.5))
                .text_color(sem.text_secondary)
                .into_any_element()
        };
        let options = self.model.options();
        let body: AnyElement = match self.model.found() {
            Found::Idle => status("Type to search..."),
            Found::Loading => div()
                .id(SharedString::from(format!("{}-loading", self.id)))
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Searching users")
                .flex()
                .items_center()
                .gap(spacing(1.))
                .px(spacing(2.))
                .py(spacing(1.5))
                .child(Spinner::new(SharedString::from(format!("{}-spinner", self.id))).size(18.))
                .child(text(Variant::Body2, "Searching...").text_color(sem.text_secondary))
                .into_any_element(),
            Found::Failed(message) => div()
                .id(SharedString::from(format!("{}-failed", self.id)))
                .role(Role::Alert)
                .flex()
                .items_center()
                .gap(spacing(1.))
                .px(spacing(2.))
                .py(spacing(1.5))
                .child(design_icon(DesignIcon::ErrorOutline, 18., sem.error))
                .child(
                    text(Variant::Body2, format!("Couldn't search users: {message}"))
                        .min_w_0()
                        .text_color(sem.error),
                )
                .into_any_element(),
            Found::Ready(_) if options.is_empty() => status("No users found"),
            Found::Ready(_) => div()
                .flex()
                .flex_col()
                .children(
                    options
                        .iter()
                        .map(|user| self.option_row(user, cx).into_any_element())
                        .collect::<Vec<_>>(),
                )
                .into_any_element(),
        };
        div()
            .id(SharedString::from(format!("{}-picker", self.id)))
            .test_support()
            .w_full()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .when(!chips.is_empty(), |picker| {
                picker.child(
                    div()
                        .id(SharedString::from(format!("{}-picked", self.id)))
                        .test_support()
                        .role(Role::List)
                        .aria_label("Picked users")
                        .mb(px(4.))
                        .flex()
                        .flex_wrap()
                        .gap(px(6.))
                        .children(chips),
                )
            })
            .child(
                TextField::new(
                    SharedString::from(format!("{}-field", self.id)),
                    &self.field,
                    self.label.clone(),
                )
                .placeholder("Type to search users...")
                .disabled(self.disabled),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{}-results", self.id)))
                    .test_support()
                    .role(Role::List)
                    .aria_label("Users found")
                    .w_full()
                    .max_h(px(240.))
                    .overflow_y_scroll()
                    .rounded(px(4.))
                    .border_1()
                    .border_color(sem.divider)
                    .child(body),
            )
    }
}
