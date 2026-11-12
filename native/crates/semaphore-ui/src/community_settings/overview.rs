//! The overview tab, after `CommunitySettingsForm` and `CommunityFormContent`: the banner, the
//! avatar, the name and the description, saved with "Update Community"; then deleting the
//! community behind its typed name (a native addition: the web has no delete).

use super::common::{
    card, field_error, locked_button, locked_note, page, phone, preview_of, server_error,
    stored_image, upload_bar,
};
use super::rules::{
    DESCRIPTION_MAX, Outcome, Pending, act, check_community_name, check_description, check_image,
    confirms_name, failure, js_len, needs, running, state_of,
};
use crate::kit::{
    Alert, Button, ButtonSize, Dialog, Severity, TextField, Variant, floating_label, notched,
    spacing, text, text_state,
};
use crate::panel::common::design_icon;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{InputState, Textarea, TextareaState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, CommunityCaps, CommunityPatch, CommunitySettingsView, DraftFile,
    ImageChange, LoadState,
};
use semaphore_design::Icon as DesignIcon;

/// Which of the community's pictures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CommunityImage {
    Avatar,
    Banner,
}

impl CommunityImage {
    fn key(self) -> &'static str {
        match self {
            Self::Avatar => "avatar",
            Self::Banner => "banner",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverviewEvent {
    /// "Change" on a picture: the owner opens the system's picker for an image and answers with
    /// `set_picked` (or `set_pick_error`).
    PickImage { slot: CommunityImage },
    /// "Update Community" with a valid form: `Core::update_community(id, patch)`. Only what changed
    /// is set.
    Save { patch: Box<CommunityPatch> },
    /// The typed name matched: `Core::delete_community(id)`. Core then drops the community
    /// (`CoreEvent::CommunityRemoved`) and the owner leaves.
    Delete,
    /// The community failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

struct Picked {
    file: DraftFile,
    preview: Option<ImageSource>,
}

/// What the fields were filled from.
#[derive(Clone, PartialEq, Eq)]
struct Base {
    name: String,
    description: String,
}

pub struct OverviewTab {
    view: CommunitySettingsView,
    caps: CommunityCaps,
    pending: Option<Pending>,
    base: Option<Base>,
    name: Entity<InputState>,
    description: Entity<TextareaState>,
    avatar: Option<Picked>,
    banner: Option<Picked>,
    remove_avatar: bool,
    remove_banner: bool,
    pick_errors: Vec<(CommunityImage, String)>,
    max_file_bytes: Option<u64>,
    /// "Update Community" was pressed once: field errors show from then on.
    tried: bool,
    saved: bool,
    deleting: bool,
    delete_typed: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<OverviewEvent> for OverviewTab {}

impl OverviewTab {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = text_state(window, cx, false);
        let description = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(3, 8)
                .placeholder("What is this community about?")
        });
        let delete_typed = text_state(window, cx, false);
        let _subscriptions = vec![
            cx.observe(&name, |this, _, cx| {
                this.saved = false;
                cx.notify()
            }),
            cx.observe(&description, |this, _, cx| {
                this.saved = false;
                cx.notify()
            }),
            cx.observe(&delete_typed, |_, _, cx| cx.notify()),
        ];
        Self {
            view: CommunitySettingsView::default(),
            caps: CommunityCaps::default(),
            pending: None,
            base: None,
            name,
            description,
            avatar: None,
            banner: None,
            remove_avatar: false,
            remove_banner: false,
            pick_errors: Vec::new(),
            max_file_bytes: None,
            tried: false,
            saved: false,
            deleting: false,
            delete_typed,
            _subscriptions,
        }
    }

    pub fn set_caps(&mut self, caps: CommunityCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::community_settings`. Fills the fields, unless the user has changed them.
    pub fn set_view(
        &mut self,
        view: CommunitySettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(pending) = self.pending.as_mut() {
            match pending.observe(&view.op) {
                Outcome::Waiting => {}
                Outcome::Failed => self.pending = None,
                Outcome::Succeeded => {
                    if pending.action.kind == AdminActionKind::UpdateCommunity {
                        self.avatar = None;
                        self.banner = None;
                        self.remove_avatar = false;
                        self.remove_banner = false;
                        self.tried = false;
                        self.saved = true;
                    }
                    self.pending = None;
                }
            }
        }
        if matches!(view.state, LoadState::Ready) {
            let base = Base {
                name: view.name.clone(),
                description: view.description.clone().unwrap_or_default(),
            };
            if self.base.as_ref() != Some(&base) {
                let untouched = self.base.as_ref().is_none_or(|was| {
                    self.name.read(cx).value() == was.name
                        && self.description.read(cx).value() == was.description
                });
                if untouched {
                    let (name, description) = (base.name.clone(), base.description.clone());
                    self.name
                        .update(cx, |field, cx| field.set_value(name, window, cx));
                    self.description
                        .update(cx, |field, cx| field.set_value(description, window, cx));
                }
                self.base = Some(base);
            }
        }
        self.view = view;
        cx.notify();
    }

    /// The file the system's picker gave for `slot`. One the server won't take shows its error.
    pub fn set_picked(&mut self, slot: CommunityImage, file: DraftFile, cx: &mut Context<Self>) {
        self.pick_errors.retain(|(at, _)| *at != slot);
        if let Err(message) = check_image(&file, self.max_file_bytes) {
            self.pick_errors.push((slot, message));
            cx.notify();
            return;
        }
        let picked = Picked {
            preview: preview_of(&file),
            file,
        };
        match slot {
            CommunityImage::Avatar => {
                self.avatar = Some(picked);
                self.remove_avatar = false;
            }
            CommunityImage::Banner => {
                self.banner = Some(picked);
                self.remove_banner = false;
            }
        }
        self.saved = false;
        cx.notify();
    }

    /// The picker couldn't read the file.
    pub fn set_pick_error(
        &mut self,
        slot: CommunityImage,
        message: String,
        cx: &mut Context<Self>,
    ) {
        self.pick_errors.retain(|(at, _)| *at != slot);
        self.pick_errors.push((slot, message));
        cx.notify();
    }

    /// `ServerInfo::max_file_bytes`.
    pub fn set_max_file_bytes(&mut self, max: Option<u64>, cx: &mut Context<Self>) {
        self.max_file_bytes = max;
        cx.notify();
    }

    /// Fills the fields, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn preset(
        &mut self,
        name: &str,
        description: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (name, description) = (name.to_owned(), description.to_owned());
        self.name
            .update(cx, |field, cx| field.set_value(name, window, cx));
        self.description
            .update(cx, |field, cx| field.set_value(description, window, cx));
        cx.notify();
    }

    /// A picture other than the picked bytes' own, for stories (which have no encoded images).
    #[cfg(feature = "stories")]
    pub(crate) fn set_preview(
        &mut self,
        slot: CommunityImage,
        file: DraftFile,
        preview: ImageSource,
    ) {
        let picked = Some(Picked {
            file,
            preview: Some(preview),
        });
        match slot {
            CommunityImage::Avatar => self.avatar = picked,
            CommunityImage::Banner => self.banner = picked,
        }
    }
    /// As if "Update Community" was pressed once: field errors show. For stories.
    #[cfg(feature = "stories")]
    pub(crate) fn set_tried(&mut self, tried: bool) {
        self.tried = tried;
    }

    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn open_delete(&mut self, typed: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.deleting = true;
        let typed = typed.to_owned();
        self.delete_typed
            .update(cx, |field, cx| field.set_value(typed, window, cx));
    }

    /// This community's change of `kind`, as core keys it.
    fn action(&self, kind: AdminActionKind) -> AdminAction {
        act(kind, Some(&self.view.community_id))
    }

    /// An update or the delete is on its way.
    fn busy(&self) -> bool {
        running(
            &self.view.op,
            &self.action(AdminActionKind::UpdateCommunity),
        ) || running(
            &self.view.op,
            &self.action(AdminActionKind::DeleteCommunity),
        )
    }

    fn patch(&self, cx: &App) -> CommunityPatch {
        let base = self.base.clone().unwrap_or(Base {
            name: String::new(),
            description: String::new(),
        });
        let name = self.name.read(cx).value().trim().to_owned();
        let description = self.description.read(cx).value().trim().to_owned();
        let image = |picked: &Option<Picked>, remove: bool| match picked {
            Some(picked) => Some(ImageChange::Set {
                file: picked.file.clone(),
            }),
            None if remove => Some(ImageChange::Remove),
            None => None,
        };
        CommunityPatch {
            name: (name != base.name.trim()).then_some(name),
            description: (description != base.description.trim()).then_some(description),
            avatar: image(&self.avatar, self.remove_avatar),
            banner: image(&self.banner, self.remove_banner),
        }
    }

    fn errors(&self, cx: &App) -> (Option<String>, Option<String>) {
        (
            check_community_name(&self.name.read(cx).value()).err(),
            check_description(&self.description.read(cx).value()).err(),
        )
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if self.busy() || !self.caps.update_community {
            return;
        }
        self.tried = true;
        let (name_error, description_error) = self.errors(cx);
        let patch = self.patch(cx);
        if name_error.is_none() && description_error.is_none() && patch != CommunityPatch::default()
        {
            self.pending = Some(Pending::new(
                self.action(AdminActionKind::UpdateCommunity),
                &self.view.op,
            ));
            self.saved = false;
            cx.emit(OverviewEvent::Save {
                patch: Box::new(patch),
            });
        }
        cx.notify();
    }

    fn confirm_delete(&mut self, cx: &mut Context<Self>) {
        if !self.caps.delete_community
            || !confirms_name(&self.delete_typed.read(cx).value(), &self.view.name)
        {
            return;
        }
        self.pending = Some(Pending::new(
            self.action(AdminActionKind::DeleteCommunity),
            &self.view.op,
        ));
        cx.emit(OverviewEvent::Delete);
        cx.notify();
    }

    fn remove(&mut self, slot: CommunityImage, cx: &mut Context<Self>) {
        self.pick_errors.retain(|(at, _)| *at != slot);
        match slot {
            CommunityImage::Avatar => {
                self.avatar = None;
                self.remove_avatar = true;
            }
            CommunityImage::Banner => {
                self.banner = None;
                self.remove_banner = true;
            }
        }
        self.saved = false;
        cx.notify();
    }

    fn stored(&self, slot: CommunityImage) -> Option<&str> {
        match slot {
            CommunityImage::Avatar if !self.remove_avatar => self.view.avatar_file_id.as_deref(),
            CommunityImage::Banner if !self.remove_banner => self.view.banner_file_id.as_deref(),
            _ => None,
        }
    }

    fn picked(&self, slot: CommunityImage) -> Option<&Picked> {
        match slot {
            CommunityImage::Avatar => self.avatar.as_ref(),
            CommunityImage::Banner => self.banner.as_ref(),
        }
    }

    fn picker_buttons(&self, slot: CommunityImage, editable: bool, cx: &mut Context<Self>) -> Div {
        let has = self.picked(slot).is_some() || self.stored(slot).is_some();
        let key = slot.key();
        div()
            .flex()
            .flex_wrap()
            .gap(spacing(1.))
            .child(
                Button::new(
                    SharedString::from(format!("community-{key}-change")),
                    "Change",
                )
                .outlined()
                .size(ButtonSize::Small)
                .start_icon(DesignIcon::Upload)
                .disabled(!editable)
                .on_click(
                    cx.listener(move |_, _, _, cx| cx.emit(OverviewEvent::PickImage { slot })),
                ),
            )
            .when(has, |row| {
                row.child(
                    Button::new(
                        SharedString::from(format!("community-{key}-remove")),
                        "Remove",
                    )
                    .size(ButtonSize::Small)
                    .start_icon(DesignIcon::Delete)
                    .disabled(!editable)
                    .on_click(cx.listener(move |tab, _, _, cx| tab.remove(slot, cx))),
                )
            })
    }

    fn pick_error(&self, slot: CommunityImage, cx: &App) -> Option<super::common::Observed> {
        let message = self
            .pick_errors
            .iter()
            .find(|(at, _)| *at == slot)
            .map(|(_, message)| message.clone())?;
        Some(
            div()
                .id(SharedString::from(format!(
                    "community-{}-error",
                    slot.key()
                )))
                .test_support()
                .role(Role::Alert)
                .child(field_error(message, cx)),
        )
    }

    fn pictures(&self, editable: bool, narrow: bool, cx: &mut Context<Self>) -> Div {
        let sem = cx.sem().clone();
        let banner_preview = self.banner.as_ref().and_then(|p| p.preview.clone());
        let banner_img = banner_preview
            .map(img)
            .or_else(|| stored_image(self.stored(CommunityImage::Banner), cx));
        let has_banner = banner_img.is_some();
        let banner = div()
            .id("community-banner")
            .relative()
            .w_full()
            .h(px(if narrow { 110. } else { 140. }))
            .rounded(px(8.))
            .overflow_hidden()
            .bg(sem.primary)
            .children(banner_img.map(|image| {
                image
                    .absolute()
                    .inset_0()
                    .size_full()
                    .object_fit(ObjectFit::Cover)
            }))
            .when(!has_banner && editable, |frame| {
                frame.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .gap(spacing(0.5))
                        .text_color(sem.primary_contrast)
                        .child(design_icon(DesignIcon::Upload, 28., sem.primary_contrast))
                        .child(text(Variant::Body2, "Upload a banner image"))
                        .child(
                            text(Variant::Caption, "Recommended: 1200x400px")
                                .text_color(sem.primary_contrast.opacity(0.8)),
                        ),
                )
            });
        let name = self.name.read(cx).value().trim().to_owned();
        let initials: String = name
            .split_whitespace()
            .filter_map(|word| word.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase();
        let avatar_preview = self.avatar.as_ref().and_then(|p| p.preview.clone());
        let avatar_img = avatar_preview
            .map(img)
            .or_else(|| stored_image(self.stored(CommunityImage::Avatar), cx));
        let avatar = div()
            .id("community-avatar")
            .size(px(88.))
            .flex_shrink_0()
            .rounded_full()
            .overflow_hidden()
            .bg(sem.primary)
            .flex()
            .items_center()
            .justify_center()
            .text_color(sem.primary_contrast)
            .map(|frame| match avatar_img {
                Some(image) => frame.child(
                    image
                        .size_full()
                        .rounded_full()
                        .object_fit(ObjectFit::Cover),
                ),
                None => frame.child(
                    text(
                        Variant::H5,
                        if initials.is_empty() {
                            "?".to_owned()
                        } else {
                            initials
                        },
                    )
                    .font_weight(FontWeight(700.)),
                ),
            });
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .child(text(Variant::Subtitle2, "Banner").text_color(sem.text_secondary))
            .child(banner)
            .child(self.picker_buttons(CommunityImage::Banner, editable, cx))
            .children(self.pick_error(CommunityImage::Banner, cx))
            .child(
                div()
                    .mt(spacing(1.))
                    .flex()
                    .items_center()
                    .gap(spacing(2.))
                    .child(avatar)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(
                                text(Variant::Body2, "Community icon")
                                    .text_color(sem.text_secondary),
                            )
                            .child(self.picker_buttons(CommunityImage::Avatar, editable, cx))
                            .children(self.pick_error(CommunityImage::Avatar, cx)),
                    ),
            )
    }

    fn description_field(
        &self,
        error: Option<String>,
        editable: bool,
        window: &Window,
        cx: &App,
    ) -> Div {
        let sem = cx.sem();
        let focused = self
            .description
            .read(cx)
            .focus_handle(cx)
            .is_focused(window);
        let count = js_len(self.description.read(cx).value().trim());
        let border = if error.is_some() {
            sem.error
        } else if focused {
            sem.input_border_focused
        } else if !editable {
            sem.action_disabled_bg
        } else {
            sem.input_border
        };
        let label_color = if error.is_some() {
            sem.error
        } else if focused {
            sem.primary
        } else {
            sem.text_secondary
        };
        let helper = error
            .clone()
            .unwrap_or_else(|| format!("{count}/{DESCRIPTION_MAX} characters"));
        div()
            .w_full()
            .flex()
            .flex_col()
            .child(notched(
                div()
                    .w_full()
                    .rounded(px(4.))
                    .border_1()
                    .when(focused || error.is_some(), |frame| frame.border_2())
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
                            .accessibility_id("community-description-input"),
                    ),
                floating_label("Description".into(), false, true, label_color, sem.paper),
            ))
            .child(
                div()
                    .px(px(14.))
                    .pt(px(3.))
                    .text_color(if error.is_some() {
                        sem.error
                    } else {
                        sem.text_secondary
                    })
                    .child(text(Variant::Caption, helper)),
            )
    }

    fn delete_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let sem = cx.sem().clone();
        let delete = self.action(AdminActionKind::DeleteCommunity);
        let busy = running(&self.view.op, &delete);
        let matched = confirms_name(&self.delete_typed.read(cx).value(), &self.view.name);
        let error = server_error(failure(&self.view.op, &delete));
        let cancel = cx.weak_entity();
        let close = cx.weak_entity();
        let confirm = cx.weak_entity();
        Dialog::new("Delete Community")
            .width(480.)
            .body(
                div()
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(error)
                    .child(text(
                        Variant::Body2,
                        format!(
                            "This permanently deletes \u{201c}{}\u{201d} for everyone: its channels, messages, roles and files. This can't be undone.",
                            self.view.name
                        ),
                    ))
                    .child(
                        text(Variant::Body2, "Type the community's name to confirm.")
                            .text_color(sem.text_primary),
                    )
                    .child(
                        TextField::new("community-delete-typed", &self.delete_typed, "Community name")
                            .disabled(busy),
                    ),
            )
            .action(
                Button::new("community-delete-cancel", "Cancel")
                    .disabled(busy)
                    .on_click(move |_, _, cx| {
                        cancel
                            .update(cx, |this, cx| {
                                this.deleting = false;
                                cx.notify();
                            })
                            .ok();
                    }),
            )
            .action(
                Button::new("community-delete-confirm", "Delete Community")
                    .outlined()
                    .color(sem.error)
                    .disabled(!matched)
                    .loading(busy)
                    .on_click(move |_, _, cx| {
                        confirm
                            .update(cx, |this, cx| this.confirm_delete(cx))
                            .ok();
                    }),
            )
            .on_close(move |_, cx| {
                close
                    .update(cx, |this, cx| {
                        if !this.busy() {
                            this.deleting = false;
                            cx.notify();
                        }
                    })
                    .ok();
            })
    }
}

impl Render for OverviewTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = phone(window);
        let body: AnyElement = match &self.view.state {
            LoadState::Loading => {
                super::common::loading_rows("community-overview-loading", "Loading community", 4)
            }
            LoadState::Failed { .. } => crate::panel::common::error_block(
                "community-overview-retry",
                "Failed to load community",
                "Please try again.",
                cx.listener(|_, _, _, cx| cx.emit(OverviewEvent::Retry)),
                cx,
            ),
            LoadState::Ready => self.form(narrow, window, cx),
        };
        let dialog = (self.deleting && matches!(self.view.state, LoadState::Ready))
            .then(|| self.delete_dialog(cx));
        div()
            .relative()
            .size_full()
            .child(page(
                "community-overview",
                "Overview",
                None,
                Vec::new(),
                div().w_full().max_w(px(640.)).child(body),
                window,
                cx,
            ))
            .children(dialog)
    }
}

impl OverviewTab {
    fn form(&mut self, narrow: bool, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let sem = cx.sem().clone();
        let editable = self.caps.update_community && !self.busy();
        let update = state_of(
            &self.view.op,
            &self.action(AdminActionKind::UpdateCommunity),
        );
        let updating = update.is_some_and(|state| state.busy || state.upload.is_some());
        let upload = update.and_then(|state| state.upload.clone());
        let update_error = update
            .filter(|state| !state.busy)
            .and_then(|state| state.error.clone());
        let (name_error, description_error) = self.errors(cx);
        let show = |error: Option<String>| error.filter(|_| self.tried);
        let name_error = show(name_error);
        let description_error = show(description_error);
        let dirty = self.patch(cx) != CommunityPatch::default();
        let save_label = if upload.is_some() {
            "Uploading files..."
        } else if updating {
            "Updating..."
        } else {
            "Update Community"
        };
        let save = Button::new("community-save", save_label)
            .contained()
            .disabled(
                !editable
                    || !dirty
                    || (self.tried && (name_error.is_some() || description_error.is_some())),
            )
            .on_click(cx.listener(|tab, _, _, cx| tab.submit(cx)));
        let save = locked_button(
            save,
            "community-save-locked",
            (!self.caps.update_community).then(|| needs("Edit community")),
            cx,
        );
        let mut name_field = TextField::new("community-name", &self.name, "Community Name")
            .required(true)
            .disabled(!editable)
            .error(name_error.is_some());
        if let Some(error) = name_error.clone() {
            name_field = name_field.helper(error);
        }
        let notices = div()
            .flex()
            .flex_col()
            .gap(spacing(1.))
            .when(!self.caps.update_community, |col| {
                col.child(Alert::new(
                    Severity::Warning,
                    "You don't have permission to update community settings.",
                ))
            })
            .children(server_error(update_error.as_ref()))
            .when(self.saved, |col| {
                col.child(Alert::new(Severity::Success, "Community updated."))
            });
        let settings = card(
            "Community",
            div()
                .flex()
                .flex_col()
                .gap(spacing(2.5))
                .child(self.pictures(editable, narrow, cx))
                .child(name_field)
                .child(self.description_field(description_error, editable, window, cx))
                .children(upload_bar("community-upload", upload.as_ref(), cx))
                .child(div().flex().justify_end().child(save)),
            cx,
        );
        let delete_locked = (!self.caps.delete_community).then(|| needs("Delete community"));
        let delete = Button::new("community-delete", "Delete Community")
            .outlined()
            .color(sem.error)
            .start_icon(DesignIcon::DeleteOutline)
            .disabled(delete_locked.is_some() || self.busy())
            .on_click(cx.listener(|tab, _, window, cx| {
                tab.deleting = true;
                tab.delete_typed
                    .update(cx, |field, cx| field.set_value("", window, cx));
                cx.notify();
            }));
        let danger = div()
            .w_full()
            .flex()
            .flex_col()
            .rounded(px(8.))
            .border_1()
            .border_color(sem.error.opacity(0.5))
            .bg(sem.paper)
            .p(spacing(2.))
            .gap(spacing(1.5))
            .child(text(Variant::Subtitle1, "Danger zone").text_color(sem.error))
            .child(
                text(
                    Variant::Body2,
                    "Deleting the community removes it, its channels and its messages for everyone. This can't be undone.",
                )
                .text_color(sem.text_secondary),
            )
            .child(div().flex().child(delete))
            .children(delete_locked.map(|reason| locked_note("community-delete-locked", reason, cx)));
        div()
            .flex()
            .flex_col()
            .gap(spacing(3.))
            .child(notices)
            .child(settings)
            .child(danger)
            .into_any_element()
    }
}
