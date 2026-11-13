//! UA1: instance settings (name, description, registration mode, default quota, max file size),
//! after `pages/admin/AdminSettingsPage.tsx`. The form checks what is typed as the server would
//! and sends only what changed, waiting on its change with `Pending`.
//!
//! The public API is the UI freeze's: `new`, the setters and `InstanceSettingsEvent`.

use crate::community_settings::common::{loading_rows, locked_button, page, server_error};
use crate::community_settings::rules::{Outcome, Pending, act, failure, needs, running};
use crate::kit::{
    Button, Paper, SelectField, TextField, Variant, floating_label, notched, select_state, spacing,
    text, text_state,
};
use crate::panel::common::error_block;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::IndexPath;
use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{InputState, Textarea, TextareaState};
use gpui_kit::component::select::SelectState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, InstanceAdminCaps, InstanceSettingsPatch, InstanceSettingsView,
    LoadState, RegistrationMode,
};

#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, PartialEq)]
pub enum InstanceSettingsEvent {
    /// "Save": `Core::update_instance_settings(patch)`; the form waits on its op.
    Save(InstanceSettingsPatch),
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

const GIB: u64 = 1_073_741_824;
const MIB: u64 = 1_048_576;
const NAME_MAX: usize = 100;
const DESCRIPTION_MAX: usize = 500;
/// `MIN_FILE_SIZE_BYTES` and `MAX_FILE_SIZE_BYTES`.
const FILE_MIN_MB: u64 = 1;
const FILE_MAX_MB: u64 = 1024;

const QUOTA_MIN_GB: u64 = 1;

/// 1024 as "1,024": a count in a message, with its thousands separator.
fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// The name's message in the field's own words: `None` when it is within core's bound.
fn name_error(chars: usize) -> Option<String> {
    (chars > NAME_MAX).then(|| format!("Name must be {NAME_MAX} characters or fewer"))
}

fn description_error(chars: usize) -> Option<String> {
    (chars > DESCRIPTION_MAX)
        .then(|| format!("Description must be {DESCRIPTION_MAX} characters or fewer"))
}

/// The quota field's message; `typed` is the whole GB it holds, `None` for anything else.
fn quota_error(typed: Option<u64>) -> Option<String> {
    match typed {
        Some(gb) if gb >= QUOTA_MIN_GB => None,
        _ => Some(format!("Quota must be at least {QUOTA_MIN_GB} GB")),
    }
}

/// The max file size field's message; `typed` is the whole MB it holds, `None` for anything else.
fn max_file_error(typed: Option<u64>) -> Option<String> {
    match typed {
        Some(mb) if mb > FILE_MAX_MB => Some(format!(
            "Max file size must be {} MB or less",
            grouped(FILE_MAX_MB)
        )),
        Some(mb) if mb >= FILE_MIN_MB => None,
        _ => Some(format!("Max file size must be at least {FILE_MIN_MB} MB")),
    }
}

const REGISTRATION_LABELS: [&str; 3] = ["Open", "Invite only", "Closed"];

const NAME_HELP: &str = "The name of your instance";
const DESCRIPTION_HELP: &str = "A brief description of your instance (optional)";
const QUOTA_HELP: &str = "Default storage quota for new users (at least 1 GB)";
const FILE_HELP: &str = "Maximum allowed file size for uploads (1 MB to 1 GB)";

fn registration_index(mode: RegistrationMode) -> usize {
    match mode {
        RegistrationMode::Open => 0,
        RegistrationMode::InviteOnly => 1,
        RegistrationMode::Closed => 2,
    }
}

fn registration_hint(mode: RegistrationMode) -> &'static str {
    match mode {
        RegistrationMode::Open => "Anyone can register",
        RegistrationMode::InviteOnly => "Requires an invite code to register",
        RegistrationMode::Closed => "Registration is disabled",
    }
}

/// Bytes as the whole GB the field shows (`bytesToGB`).
fn gb_text(bytes: u64) -> String {
    format!("{}", (bytes as f64 / GIB as f64).round() as u64)
}

/// Bytes as the whole MB the field shows (`bytesToMB`).
fn mb_text(bytes: u64) -> String {
    format!("{}", (bytes as f64 / MIB as f64).round() as u64)
}

/// A whole, nonnegative number, as the field takes one; `None` for anything else.
fn parse_whole(typed: &str) -> Option<u64> {
    let value: f64 = typed.trim().parse().ok()?;
    (value.is_finite() && value >= 0. && value.fract() == 0.).then_some(value as u64)
}

/// The server's checks on what the form sends (`update_body` in core), as inline messages.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Checks {
    name: Option<String>,
    description: Option<String>,
    quota: Option<String>,
    max_file: Option<String>,
    /// The quota and file size the fields name, when they are valid.
    quota_bytes: Option<u64>,
    max_bytes: Option<u64>,
}

impl Checks {
    fn any(&self) -> bool {
        self.name.is_some()
            || self.description.is_some()
            || self.quota.is_some()
            || self.max_file.is_some()
    }
}

/// What the fields were filled from: the server's settings.
#[derive(Clone, Default, PartialEq, Eq)]
struct Base {
    name: String,
    description: String,
    registration: RegistrationMode,
    default_quota_bytes: u64,
    max_file_bytes: u64,
}

impl Base {
    fn of(view: &InstanceSettingsView) -> Self {
        Self {
            name: view.name.clone(),
            description: view.description.clone().unwrap_or_default(),
            registration: view.registration,
            default_quota_bytes: view.default_quota_bytes,
            max_file_bytes: view.max_file_bytes,
        }
    }
}

pub struct InstanceSettingsPage {
    caps: InstanceAdminCaps,
    view: InstanceSettingsView,
    base: Option<Base>,
    pending: Option<Pending>,
    name: Entity<InputState>,
    description: Entity<TextareaState>,
    registration: Entity<SelectState<Vec<SharedString>>>,
    quota: Entity<InputState>,
    max_file: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<InstanceSettingsEvent> for InstanceSettingsPage {}

impl InstanceSettingsPage {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = text_state(window, cx, false);
        let description = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(3, 3)
                .placeholder("A brief description of your instance")
        });
        let quota = text_state(window, cx, false);
        let max_file = text_state(window, cx, false);
        let registration = select_state(
            REGISTRATION_LABELS
                .iter()
                .map(|label| SharedString::from(*label))
                .collect(),
            Some(registration_index(RegistrationMode::InviteOnly)),
            window,
            cx,
        );
        let _subscriptions = vec![
            cx.observe(&name, |_, _, cx| cx.notify()),
            cx.observe(&description, |_, _, cx| cx.notify()),
            cx.observe(&registration, |_, _, cx| cx.notify()),
            cx.observe(&quota, |_, _, cx| cx.notify()),
            cx.observe(&max_file, |_, _, cx| cx.notify()),
        ];
        Self {
            caps: InstanceAdminCaps::default(),
            view: InstanceSettingsView::default(),
            base: None,
            pending: None,
            name,
            description,
            registration,
            quota,
            max_file,
            _subscriptions,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::instance_settings()`. Fills the fields, unless the user has changed them, on the
    /// next render (the frozen setter has no window to put text into a field).
    pub fn set_view(&mut self, view: InstanceSettingsView, cx: &mut Context<Self>) {
        if let Some(pending) = self.pending.as_mut() {
            match pending.observe(&view.op) {
                Outcome::Waiting => {}
                Outcome::Failed | Outcome::Succeeded => self.pending = None,
            }
        }
        self.view = view;
        cx.notify();
    }

    /// This settings change, as core keys it: `UpdateInstanceSettings`, no target.
    fn action(&self) -> AdminAction {
        act(AdminActionKind::UpdateInstanceSettings, None)
    }

    /// A save is on its way, from the click until core records that it ended.
    fn busy(&self) -> bool {
        running(&self.view.op, &self.action()) || self.pending.is_some()
    }

    fn selected(&self, cx: &App) -> RegistrationMode {
        let label = self
            .registration
            .read(cx)
            .selected_value()
            .map(|label| label.to_string());
        match label.as_deref() {
            Some("Open") => RegistrationMode::Open,
            Some("Closed") => RegistrationMode::Closed,
            _ => RegistrationMode::InviteOnly,
        }
    }

    fn checks(&self, cx: &App) -> Checks {
        let name = self.name.read(cx).value().to_string();
        let description = self.description.read(cx).value().to_string();
        let quota_value = parse_whole(&self.quota.read(cx).value());
        let file_value = parse_whole(&self.max_file.read(cx).value());
        Checks {
            name: name_error(name.chars().count()),
            description: description_error(description.chars().count()),
            quota: quota_error(quota_value),
            max_file: max_file_error(file_value),
            quota_bytes: quota_value.map(|gb| gb.saturating_mul(GIB)),
            max_bytes: file_value.map(|mb| mb.saturating_mul(MIB)),
        }
    }

    /// Only what the fields name and the server's settings don't already have.
    fn patch(&self, checks: &Checks, cx: &App) -> InstanceSettingsPatch {
        let base = self.base.clone().unwrap_or_default();
        let name = self.name.read(cx).value().to_string();
        let description = self.description.read(cx).value().to_string();
        let registration = self.selected(cx);
        InstanceSettingsPatch {
            name: (name != base.name).then_some(name),
            description: (description != base.description).then_some(description),
            registration: (registration != base.registration).then_some(registration),
            default_quota_bytes: checks
                .quota_bytes
                .filter(|bytes| *bytes != base.default_quota_bytes),
            max_file_bytes: checks
                .max_bytes
                .filter(|bytes| *bytes != base.max_file_bytes),
        }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        if !self.caps.settings_write || self.busy() {
            return;
        }
        let checks = self.checks(cx);
        let patch = self.patch(&checks, cx);
        if !checks.any() && patch != InstanceSettingsPatch::default() {
            self.pending = Some(Pending::new(self.action(), &self.view.op));
            cx.emit(InstanceSettingsEvent::Save(patch));
        }
        cx.notify();
    }

    /// Puts the server's settings into the fields, unless the user has changed them. Runs on
    /// every render because `set_view` has no window.
    fn fill(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !matches!(self.view.state, LoadState::Ready) {
            return;
        }
        let base = Base::of(&self.view);
        if self.base.as_ref() == Some(&base) {
            return;
        }
        let name = self.name.read(cx).value().to_string();
        let description = self.description.read(cx).value().to_string();
        let quota = self.quota.read(cx).value().to_string();
        let max_file = self.max_file.read(cx).value().to_string();
        let registration = self.selected(cx);
        let untouched = self.base.as_ref().is_none_or(|was| {
            name == was.name
                && description == was.description
                && registration == was.registration
                && quota == gb_text(was.default_quota_bytes)
                && max_file == mb_text(was.max_file_bytes)
        });
        if untouched {
            let (name, description) = (base.name.clone(), base.description.clone());
            self.name
                .update(cx, |field, cx| field.set_value(name, window, cx));
            self.description
                .update(cx, |field, cx| field.set_value(description, window, cx));
            let index = registration_index(base.registration);
            self.registration.update(cx, |state, cx| {
                state.set_selected_index(Some(IndexPath::default().row(index)), window, cx)
            });
            let (quota, max_file) = (
                gb_text(base.default_quota_bytes),
                mb_text(base.max_file_bytes),
            );
            self.quota
                .update(cx, |field, cx| field.set_value(quota, window, cx));
            self.max_file
                .update(cx, |field, cx| field.set_value(max_file, window, cx));
        }
        self.base = Some(base);
    }

    /// Fills some of the fields, for stories and tests: `None` leaves one as it is.
    #[cfg(any(test, feature = "stories"))]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn preset(
        &mut self,
        name: Option<&str>,
        description: Option<&str>,
        registration: Option<RegistrationMode>,
        quota: Option<&str>,
        max_file: Option<&str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // The base must be the view's, so what is typed reads as a change.
        self.fill(window, cx);
        if let Some(name) = name {
            let name = name.to_owned();
            self.name
                .update(cx, |field, cx| field.set_value(name, window, cx));
        }
        if let Some(description) = description {
            let description = description.to_owned();
            self.description
                .update(cx, |field, cx| field.set_value(description, window, cx));
        }
        if let Some(registration) = registration {
            let index = registration_index(registration);
            self.registration.update(cx, |state, cx| {
                state.set_selected_index(Some(IndexPath::default().row(index)), window, cx)
            });
        }
        if let Some(quota) = quota {
            let quota = quota.to_owned();
            self.quota
                .update(cx, |field, cx| field.set_value(quota, window, cx));
        }
        if let Some(max_file) = max_file {
            let max_file = max_file.to_owned();
            self.max_file
                .update(cx, |field, cx| field.set_value(max_file, window, cx));
        }
        cx.notify();
    }

    fn form(&mut self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let busy = self.busy();
        let editable = self.caps.settings_write && !busy;
        let checks = self.checks(cx);
        let base = self.base.clone().unwrap_or_default();
        let name_typed = self.name.read(cx).value().to_string();
        let description_typed = self.description.read(cx).value().to_string();
        let quota_typed = self.quota.read(cx).value().to_string();
        let max_typed = self.max_file.read(cx).value().to_string();
        let name_error = checks.name.clone().filter(|_| name_typed != base.name);
        let description_error = checks
            .description
            .clone()
            .filter(|_| description_typed != base.description);
        let quota_error = checks
            .quota
            .clone()
            .filter(|_| quota_typed != gb_text(base.default_quota_bytes));
        let max_error = checks
            .max_file
            .clone()
            .filter(|_| max_typed != mb_text(base.max_file_bytes));
        let patch = self.patch(&checks, cx);
        let dirty = patch != InstanceSettingsPatch::default();
        let action = self.action();

        let name_field = TextField::new("admin-settings-name", &self.name, "Instance Name")
            .helper(name_error.clone().unwrap_or_else(|| NAME_HELP.to_owned()))
            .error(name_error.is_some())
            .disabled(!editable);

        let focused = self
            .description
            .read(cx)
            .focus_handle(cx)
            .is_focused(window);
        let border = if description_error.is_some() {
            sem.error
        } else if focused {
            sem.input_border_focused
        } else if !editable {
            sem.action_disabled_bg
        } else {
            sem.input_border
        };
        let label_color = if description_error.is_some() {
            sem.error
        } else if focused {
            sem.primary
        } else {
            sem.text_secondary
        };
        let description_help = description_error
            .clone()
            .unwrap_or_else(|| DESCRIPTION_HELP.to_owned());
        let description_field = div()
            .id("admin-settings-description")
            .test_support()
            .w_full()
            .flex()
            .flex_col()
            .child(notched(
                div()
                    .w_full()
                    .rounded(px(4.))
                    .border_1()
                    .when(focused || description_error.is_some(), |frame| {
                        frame.border_2()
                    })
                    .border_color(border)
                    .px(px(10.))
                    .pt(px(14.))
                    .pb(px(10.))
                    .child(
                        Textarea::new(&self.description)
                            .with_size(gpui_kit::component::Size::XSmall)
                            .text_size(px(16.))
                            .appearance(false)
                            .bordered(false)
                            .disabled(!editable)
                            .aria_label("Description")
                            .accessibility_id("admin-settings-description-input"),
                    ),
                floating_label("Description".into(), false, true, label_color, sem.paper),
            ))
            .child(
                div()
                    .px(px(14.))
                    .pt(px(3.))
                    .text_color(if description_error.is_some() {
                        sem.error
                    } else {
                        sem.text_secondary
                    })
                    .child(text(Variant::Caption, description_help)),
            );

        let mode = self.selected(cx);
        let registration = div()
            .w_full()
            .flex()
            .flex_col()
            .child(
                SelectField::new(
                    "admin-settings-registration",
                    &self.registration,
                    "Registration Mode",
                )
                .disabled(!editable),
            )
            .child(div().px(px(14.)).pt(px(3.)).child(
                text(Variant::Caption, registration_hint(mode)).text_color(sem.text_secondary),
            ));

        let quota_field = TextField::new(
            "admin-settings-quota",
            &self.quota,
            "Default Storage Quota (GB)",
        )
        .helper(quota_error.clone().unwrap_or_else(|| QUOTA_HELP.to_owned()))
        .error(quota_error.is_some())
        .disabled(!editable);

        let max_field = TextField::new(
            "admin-settings-max-file",
            &self.max_file,
            "Max File Size (MB)",
        )
        .helper(max_error.clone().unwrap_or_else(|| FILE_HELP.to_owned()))
        .error(max_error.is_some())
        .disabled(!editable);

        let save = Button::new("admin-settings-save", "Save")
            .contained()
            .disabled(!self.caps.settings_write || busy || !dirty || checks.any())
            .loading(busy)
            .on_click(cx.listener(|page, _, _, cx| page.submit(cx)));
        let save = locked_button(
            save,
            "admin-settings-locked",
            (!self.caps.settings_write).then(|| needs("Update instance settings")),
            cx,
        );
        let save_row = div().flex().justify_end().child(save);
        let save_row: AnyElement = if busy {
            div()
                .id("admin-settings-busy")
                .test_support()
                .flex()
                .justify_end()
                .child(save_row)
                .into_any_element()
        } else {
            save_row.into_any_element()
        };

        Paper::new()
            .radius(8.)
            .w_full()
            .p(spacing(2.))
            .child(
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap(spacing(2.5))
                    .child(name_field)
                    .child(description_field)
                    .child(registration)
                    .child(div().w_full().border_t_1().border_color(sem.divider))
                    .child(text(Variant::H6, "Storage Settings").text_color(sem.text_primary))
                    .child(quota_field)
                    .child(max_field)
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(save_row)
                            .children(server_error(failure(&self.view.op, &action))),
                    ),
            )
            .into_any_element()
    }
}

impl Render for InstanceSettingsPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.fill(window, cx);
        let body: AnyElement = match &self.view.state {
            LoadState::Loading => {
                loading_rows("admin-settings-loading", "Loading instance settings", 4)
            }
            LoadState::Failed { .. } => error_block(
                "admin-settings-retry",
                "Couldn't load the instance settings",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(InstanceSettingsEvent::Retry)),
                cx,
            ),
            LoadState::Ready => self.form(window, cx),
        };
        page(
            "admin-settings",
            "Instance Settings",
            Some("Configure your instance settings".into()),
            Vec::new(),
            div().w_full().max_w(px(600.)).child(body),
            window,
            cx,
        )
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
