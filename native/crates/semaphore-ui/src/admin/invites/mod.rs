//! UA4: instance invites: the list, creating one for some communities (uses, expiry), copying its
//! link and deleting it, after `pages/AdminInvitePage.tsx` and the W5 invites tab.
//!
//! What this user may do comes from core's `InstanceAdminCaps` (`invites_read`, `invites_create`,
//! `invites_delete`): a control it doesn't allow shows disabled with the reason, never hidden. The
//! rows, their status and the changes' progress and failures are core's (`AdminInvitesView::op`);
//! the page only draws them and says what was pressed. Copying is the owner's: the page emits the
//! link and shows "Copied" until another invite is copied.

#[cfg(any(test, feature = "stories"))]
mod fixtures;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use crate::community_settings::common::{
    Confirm, action_icon, card, empty_line, field_error, list, loading_rows, locked_button,
    locked_note, mono, page, phone, row, tone_chip, who,
};
use crate::community_settings::rules::{
    ExpiryPreset, InviteStatus, Outcome, Pending, act, date_label, failure, invite_status,
    invite_url, needs, parse_max_uses, running, uses_label,
};
use crate::kit::{
    Alert, Button, ButtonSize, Checkbox, Chip, Dialog, Severity, TextField, Variant, spacing, text,
    text_state,
};
use crate::messages::TimeFormat;
use crate::panel::PanelClock;
use crate::panel::common::{design_icon, error_block};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::InputState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, AdminInvitesView, CommunityRow, InstanceAdminCaps,
    InstanceInviteDraft, InstanceInviteRow, InviteRow, LoadState,
};
use semaphore_design::Icon as DesignIcon;

/// How many of an invite's communities a row names before it says "+N".
const CHIPS_SHOWN: usize = 3;
/// The longest community name a chip draws whole: a chip has no ellipsis of its own, and a
/// community's name runs to 100 characters.
const CHIP_NAME_MAX: usize = 40;
/// The height the create dialog's community list scrolls within, so the dialog fits a phone.
const COMMUNITIES_HEIGHT: f32 = 200.;

/// A community's name as a chip shows it: whole under [`CHIP_NAME_MAX`], else cut with an ellipsis.
fn chip_name(name: &str) -> String {
    match name.char_indices().nth(CHIP_NAME_MAX) {
        Some((end, _)) => format!("{}\u{2026}", &name[..end]),
        None => name.to_owned(),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum InstanceInvitesEvent {
    /// "Create": `Core::create_instance_invite(draft)`.
    Create(InstanceInviteDraft),
    /// Confirmed: `Core::delete_instance_invite(code)`.
    Delete { code: String },
    /// "Copy link": the owner writes `url` to the clipboard.
    CopyLink { url: String },
    /// The read failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct InstanceInvitesPage {
    caps: InstanceAdminCaps,
    view: AdminInvitesView,
    communities: Vec<CommunityRow>,
    link_base: String,
    clock: PanelClock,
    time: TimeFormat,
    /// The creates sent, each followed until core records its end.
    pending: Vec<Pending>,
    creating: bool,
    /// "Create" was pressed once: the form's errors show from then on.
    tried: bool,
    max_uses: Entity<InputState>,
    expiry: ExpiryPreset,
    picked: Vec<String>,
    copied: Option<String>,
    /// The invite whose delete confirm is open.
    deleting: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<InstanceInvitesEvent> for InstanceInvitesPage {}

impl InstanceInvitesPage {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let max_uses = text_state(window, cx, false);
        let _subscriptions = vec![cx.observe(&max_uses, |_, _, cx| cx.notify())];
        Self {
            caps: InstanceAdminCaps::default(),
            view: AdminInvitesView::default(),
            communities: Vec::new(),
            link_base: String::new(),
            clock: PanelClock::default(),
            time: TimeFormat::default(),
            pending: Vec::new(),
            creating: false,
            tried: false,
            max_uses,
            expiry: ExpiryPreset::Never,
            picked: Vec::new(),
            copied: None,
            deleting: None,
            _subscriptions,
        }
    }

    /// What this user may do on the instance (`InstancePermissionsView::admin`).
    pub fn set_caps(&mut self, caps: InstanceAdminCaps, cx: &mut Context<Self>) {
        self.caps = caps;
        cx.notify();
    }

    /// `Core::admin_invites()`.
    pub fn set_view(&mut self, view: AdminInvitesView, cx: &mut Context<Self>) {
        let mut created = false;
        self.pending
            .retain_mut(|pending| match pending.observe(&view.op) {
                Outcome::Waiting => true,
                // A refusal stays in the op, where the dialog's form reads it.
                Outcome::Failed => false,
                Outcome::Succeeded => {
                    created |= pending.action.kind == AdminActionKind::CreateInstanceInvite;
                    false
                }
            });
        if created {
            self.creating = false;
        }
        self.view = view;
        cx.notify();
    }

    /// The communities an invite can add people to (`Core::communities()`).
    pub fn set_communities(&mut self, communities: Vec<CommunityRow>, cx: &mut Context<Self>) {
        self.communities = communities;
        cx.notify();
    }

    /// The server the links point at: `https://chat.example.com`.
    pub fn set_link_base(&mut self, link_base: String, cx: &mut Context<Self>) {
        self.link_base = link_base;
        cx.notify();
    }

    /// What expiry is measured from.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    /// The zone dates are written in.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// The create dialog open, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn open_create(
        &mut self,
        max_uses: &str,
        expiry: ExpiryPreset,
        tried: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_form(window, cx);
        self.tried = tried;
        self.expiry = expiry;
        let max_uses = max_uses.to_owned();
        self.max_uses
            .update(cx, |field, cx| field.set_value(max_uses, window, cx));
    }

    /// Only these communities picked in the open create dialog, for stories and tests.
    #[cfg(any(test, feature = "stories"))]
    pub(crate) fn pick_communities(&mut self, ids: &[&str], cx: &mut Context<Self>) {
        self.picked = ids.iter().map(|id| (*id).to_owned()).collect();
        cx.notify();
    }

    /// An invite as if its link was just copied, for stories.
    #[cfg(feature = "stories")]
    pub(crate) fn mark_copied(&mut self, code: &str) {
        self.copied = Some(code.to_owned());
    }

    /// The delete confirm of `code` open, for stories.
    #[cfg(feature = "stories")]
    pub(crate) fn open_delete(&mut self, code: &str) {
        self.deleting = Some(code.to_owned());
    }

    fn create_action() -> AdminAction {
        act(AdminActionKind::CreateInstanceInvite, None)
    }

    fn delete_action(code: &str) -> AdminAction {
        act(AdminActionKind::DeleteInstanceInvite, Some(code))
    }

    fn busy_creating(&self) -> bool {
        running(&self.view.op, &Self::create_action())
    }

    /// A change already sent, whose op hasn't caught up: pressing again sends nothing.
    fn sending(&self, action: &AdminAction) -> bool {
        self.pending.iter().any(|pending| pending.action == *action)
    }

    fn open_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.creating = true;
        self.tried = false;
        self.expiry = ExpiryPreset::Never;
        self.max_uses
            .update(cx, |field, cx| field.set_value("", window, cx));
        // As the web does: the community named "default" if there is one, otherwise all of them.
        self.picked = match self
            .communities
            .iter()
            .find(|community| community.name.eq_ignore_ascii_case("default"))
        {
            Some(default) => vec![default.id.clone()],
            None => self
                .communities
                .iter()
                .map(|community| community.id.clone())
                .collect(),
        };
        cx.notify();
    }

    pub(crate) fn submit(&mut self, cx: &mut Context<Self>) {
        if !self.caps.invites_create || self.busy_creating() || self.sending(&Self::create_action())
        {
            return;
        }
        self.tried = true;
        let Ok(max_uses) = parse_max_uses(&self.max_uses.read(cx).value()) else {
            cx.notify();
            return;
        };
        if self.picked.is_empty() {
            cx.notify();
            return;
        }
        self.pending
            .push(Pending::new(Self::create_action(), &self.view.op));
        cx.emit(InstanceInvitesEvent::Create(InstanceInviteDraft {
            community_ids: self.picked.clone(),
            max_uses,
            valid_until_ms: self.expiry.valid_until(self.clock.now_ms()),
        }));
        cx.notify();
    }

    fn copy(&mut self, code: &str, cx: &mut Context<Self>) {
        let url = invite_url(&self.link_base, code);
        self.copied = Some(code.to_owned());
        cx.emit(InstanceInvitesEvent::CopyLink { url });
        cx.notify();
    }

    fn toggle_community(&mut self, id: &str, on: bool, cx: &mut Context<Self>) {
        if on {
            if !self.picked.iter().any(|picked| picked == id) {
                self.picked.push(id.to_owned());
            }
        } else {
            self.picked.retain(|picked| picked != id);
        }
        cx.notify();
    }

    pub(crate) fn confirm_delete(&mut self, code: &str, cx: &mut Context<Self>) {
        let action = Self::delete_action(code);
        if !self.caps.invites_delete || running(&self.view.op, &action) || self.sending(&action) {
            return;
        }
        self.pending.push(Pending::new(action, &self.view.op));
        self.deleting = None;
        cx.emit(InstanceInvitesEvent::Delete {
            code: code.to_owned(),
        });
        cx.notify();
    }

    /// The invite as the W5 rules know it: its status and uses are `rules`' on this shape.
    fn as_invite(invite: &InstanceInviteRow) -> InviteRow {
        InviteRow {
            code: invite.code.clone(),
            uses: invite.uses,
            max_uses: invite.max_uses,
            valid_until_ms: invite.valid_until_ms,
            disabled: invite.disabled,
            created_at_ms: invite.created_at_ms,
        }
    }

    fn community_chips(&self, invite: &InstanceInviteRow, cx: &App) -> Option<Div> {
        let sem = cx.sem();
        (!invite.communities.is_empty()).then(|| {
            let extra = invite.communities.len().saturating_sub(CHIPS_SHOWN);
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(spacing(0.5))
                .child(
                    text(Variant::Caption, "Communities:")
                        .flex_shrink_0()
                        .text_color(sem.text_secondary),
                )
                .children(
                    invite
                        .communities
                        .iter()
                        .take(CHIPS_SHOWN)
                        .map(|community| tone_chip(chip_name(&community.name), sem.primary)),
                )
                .when(extra > 0, |chips| {
                    chips.child(Chip::new(format!("+{extra}")))
                })
        })
    }

    /// The row's words under the code: uses, expiry, creation and who made it. Each stays whole
    /// and they wrap between themselves, so a line never splits a date in two. On a phone each
    /// takes its own line after the status chip, with no separators: a "·" that wrapped would
    /// start a line.
    fn detail_line(
        &self,
        invite: &InstanceInviteRow,
        leading: Vec<AnyElement>,
        stacked: bool,
        cx: &App,
    ) -> Div {
        let sem = cx.sem();
        let wire = Self::as_invite(invite);
        let mut details = vec![uses_label(&wire)];
        if let Some(until) = invite.valid_until_ms {
            details.push(format!("Expires: {}", date_label(&self.time, until)));
        }
        let created = format!("Created: {}", date_label(&self.time, invite.created_at_ms));
        details.push(match &invite.created_by {
            Some(by) => format!("{created} by {}", who(by)),
            None => created,
        });
        let line = div().w_full().flex();
        let line = if stacked {
            line.flex_col().items_start().gap(spacing(0.5))
        } else {
            line.flex_wrap().items_center().gap(spacing(0.5))
        };
        line.children(leading)
            .children(details.into_iter().enumerate().map(|(index, detail)| {
                let label = if index == 0 || stacked {
                    detail
                } else {
                    format!("\u{b7} {detail}")
                };
                text(Variant::Caption, label)
                    .max_w_full()
                    .truncate()
                    .text_color(sem.text_secondary)
            }))
    }

    fn invite_row(
        &self,
        invite: &InstanceInviteRow,
        now: i64,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem().clone();
        let wire = Self::as_invite(invite);
        let status = invite_status(&wire, now);
        let chip_color = match status {
            InviteStatus::Active => sem.success,
            _ => sem.error,
        };
        let chip_label = status.label();
        let code = invite.code.clone();
        let copy_code = code.clone();
        let delete_code = code.clone();
        let copied = self.copied.as_deref() == Some(code.as_str());
        let action = Self::delete_action(&code);
        let deleting = running(&self.view.op, &action);
        let error = failure(&self.view.op, &action);
        let link = design_icon(DesignIcon::Link, 20., sem.text_secondary);
        let chips = self.community_chips(invite, cx);
        let error = error.map(|error| field_error(error.message.clone(), cx));
        let copy = action_icon(
            format!("admin-invites-copy-{code}"),
            if copied {
                DesignIcon::Check
            } else {
                DesignIcon::ContentCopy
            },
            if copied {
                "Copied!".to_owned()
            } else {
                "Copy invite link".to_owned()
            },
            None,
            false,
            Some(sem.primary),
            cx.listener(move |page, _, _, cx| page.copy(&copy_code, cx)),
        );
        let delete = action_icon(
            format!("admin-invites-delete-{code}"),
            DesignIcon::Delete,
            format!("Delete invite {code}"),
            (!self.caps.invites_delete).then(|| needs("Delete instance invites")),
            deleting,
            Some(sem.error),
            cx.listener(move |page, _, _, cx| {
                page.deleting = Some(delete_code.clone());
                cx.notify();
            }),
        );
        let entry = row(
            SharedString::from(format!("admin-invites-invite-{code}")),
            format!("Invite {code}"),
            cx,
        );
        if narrow {
            // A phone: the code on top with the actions at that line's end, then the status and
            // the words, so nothing pushes the buttons off the row.
            let chip = tone_chip(chip_label, chip_color);
            let code_line = mono(code.clone(), cx).flex_1().min_w_0().truncate();
            let line = self.detail_line(invite, vec![chip.into_any_element()], true, cx);
            entry
                .flex_col()
                .items_start()
                .gap(spacing(1.))
                .child(
                    div()
                        .flex()
                        .w_full()
                        .items_center()
                        .gap(spacing(1.))
                        .child(link)
                        .child(code_line)
                        .child(copy)
                        .child(delete),
                )
                .child(line)
                .children(chips)
                .children(error)
                .into_any_element()
        } else {
            let line = self.detail_line(invite, Vec::new(), false, cx);
            let identity = div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(spacing(1.))
                .child(mono(code.clone(), cx).max_w_full().min_w_0().truncate())
                .child(tone_chip(chip_label, chip_color));
            entry
                .child(link)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(2.))
                        .child(identity)
                        .child(line)
                        .children(chips)
                        .children(error),
                )
                .child(copy)
                .child(delete)
                .into_any_element()
        }
    }

    fn create_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let sem = cx.sem().clone();
        let busy = self.busy_creating();
        let create_error = failure(&self.view.op, &Self::create_action()).cloned();
        let uses_error = parse_max_uses(&self.max_uses.read(cx).value()).err();
        let uses = TextField::new("admin-invites-max-uses", &self.max_uses, "Max Uses")
            .placeholder("Unlimited")
            .disabled(busy)
            .error(uses_error.is_some())
            .helper(
                uses_error
                    .clone()
                    .unwrap_or_else(|| "Leave empty for unlimited uses".to_owned()),
            );
        let presets =
            div()
                .flex()
                .flex_wrap()
                .gap(spacing(1.))
                .children(ExpiryPreset::ALL.into_iter().map(|preset| {
                    let button = Button::new(
                        SharedString::from(format!("admin-invites-expiry-{}", preset.key())),
                        preset.label(),
                    )
                    .size(ButtonSize::Small)
                    .disabled(busy)
                    .on_click(cx.listener(move |page, _, _, cx| {
                        page.expiry = preset;
                        cx.notify();
                    }));
                    if preset == self.expiry {
                        button.contained()
                    } else {
                        button.outlined()
                    }
                }));
        let expires = match self.expiry.valid_until(self.clock.now_ms()) {
            Some(until) => format!("Expires {}", date_label(&self.time, until)),
            None => "Never expires".to_owned(),
        };
        let communities: Vec<AnyElement> = self
            .communities
            .iter()
            .map(|community| {
                let id = community.id.clone();
                let toggle = cx.weak_entity();
                let checked = self.picked.iter().any(|picked| picked == &community.id);
                Checkbox::new(
                    SharedString::from(format!("admin-invites-community-{id}")),
                    community.name.clone(),
                    checked,
                )
                .disabled(busy)
                .on_change(move |on, _, cx| {
                    toggle
                        .update(cx, |page, cx| page.toggle_community(&id, on, cx))
                        .ok();
                })
                .into_any_element()
            })
            .collect();
        let nothing_picked = (self.tried && self.picked.is_empty())
            .then(|| field_error("Pick at least one community", cx));
        let cancel = cx.weak_entity();
        let close = cx.weak_entity();
        let submit = cx.weak_entity();
        Dialog::new("Create Instance Invite")
            .width(480.)
            .body(
                div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_col()
                    .gap(spacing(2.))
                    .children(create_error.map(|error| Alert::new(Severity::Error, error.message)))
                    .child(
                        text(
                            Variant::Body2,
                            "Create a new invite link for users to join your Semaphore Chat instance.",
                        )
                        .text_color(sem.text_secondary),
                    )
                    .child(uses)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(
                                text(Variant::Caption, "Expires after")
                                    .text_color(sem.text_secondary),
                            )
                            .child(presets)
                            .child(text(Variant::Caption, expires).text_color(sem.text_secondary)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(spacing(1.))
                            .child(
                                text(Variant::Body2, "Communities to Auto-Join")
                                    .text_color(sem.text_primary),
                            )
                            .child(
                                text(
                                    Variant::Caption,
                                    "New users will automatically join the selected communities",
                                )
                                .text_color(sem.text_secondary),
                            )
                            .child(if self.communities.is_empty() {
                                text(Variant::Caption, "No communities to add people to yet.")
                                    .text_color(sem.text_secondary)
                                    .into_any_element()
                            } else {
                                div()
                                    .id("admin-invites-communities")
                                    .max_h(px(COMMUNITIES_HEIGHT))
                                    .overflow_y_scroll()
                                    .flex()
                                    .flex_col()
                                    .children(communities)
                                    .into_any_element()
                            })
                            .children(nothing_picked.map(|line| {
                                div()
                                    .id("admin-invites-communities-error")
                                    .test_support()
                                    .child(line)
                            })),
                    ),
            )
            .action(
                Button::new("admin-invites-create-cancel", "Cancel")
                    .disabled(busy)
                    .on_click(move |_, _, cx| {
                        cancel
                            .update(cx, |page, cx| {
                                page.creating = false;
                                cx.notify();
                            })
                            .ok();
                    }),
            )
            .action(
                Button::new("admin-invites-create-submit", "Create Invite")
                    .contained()
                    .loading(busy)
                    .disabled(uses_error.is_some())
                    .on_click(move |_, _, cx| {
                        submit.update(cx, |page, cx| page.submit(cx)).ok();
                    }),
            )
            .on_close(move |_, cx| {
                close
                    .update(cx, |page, cx| {
                        if !page.busy_creating() {
                            page.creating = false;
                            cx.notify();
                        }
                    })
                    .ok();
            })
    }

    fn delete_dialog(&self, code: &str, cx: &mut Context<Self>) -> Dialog {
        let busy = running(&self.view.op, &Self::delete_action(code));
        let confirm = cx.weak_entity();
        let cancel = cx.weak_entity();
        let delete = code.to_owned();
        Confirm {
            id: "admin-invites-delete",
            title: "Delete Invite",
            message: format!(
                "Delete the invite {code}? Its link stops working at once, and this can't be undone."
            ),
            confirm: "Delete Invite",
            busy,
        }
        .dialog(
            move |_, cx| {
                confirm
                    .update(cx, |page, cx| page.confirm_delete(&delete, cx))
                    .ok();
            },
            move |_, cx| {
                cancel
                    .update(cx, |page, cx| {
                        page.deleting = None;
                        cx.notify();
                    })
                    .ok();
            },
            cx,
        )
    }
}

impl Render for InstanceInvitesPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let narrow = phone(window);
        let create = locked_button(
            Button::new("admin-invites-create", "Create Invite")
                .contained()
                .start_icon(DesignIcon::Add)
                .on_click(cx.listener(|page, _, window, cx| page.open_form(window, cx))),
            "admin-invites-create-locked",
            (!self.caps.invites_create).then(|| needs("Create instance invites")),
            cx,
        );
        let listing: AnyElement = match &self.view.state {
            LoadState::Loading => loading_rows("admin-invites-loading", "Loading invites", 3),
            LoadState::Failed { error } => error_block(
                "admin-invites-retry",
                "Failed to load invites",
                error.message.clone(),
                cx.listener(|_, _: &ClickEvent, _, cx| cx.emit(InstanceInvitesEvent::Retry)),
                cx,
            ),
            LoadState::Ready if self.view.rows.is_empty() => {
                empty_line("No invites created yet", cx).into_any_element()
            }
            LoadState::Ready => {
                let now = self.clock.now_ms();
                let invites = self.view.rows.clone();
                let items: Vec<_> = invites
                    .iter()
                    .map(|invite| self.invite_row(invite, now, narrow, cx))
                    .collect();
                list("admin-invites-list", "Invites")
                    .children(items)
                    .into_any_element()
            }
        };
        let title = match self.view.state {
            LoadState::Ready => format!("Invites ({})", self.view.rows.len()),
            _ => "Invites".to_owned(),
        };
        let body: AnyElement = if !self.caps.invites_read {
            locked_note("admin-invites-denied", needs("Read instance invites"), cx)
                .into_any_element()
        } else {
            card(title, listing, cx).into_any_element()
        };
        let mut overlays: Vec<AnyElement> = Vec::new();
        if self.creating {
            overlays.push(self.create_dialog(cx).into_any_element());
        }
        if let Some(code) = self.deleting.clone() {
            overlays.push(self.delete_dialog(&code, cx).into_any_element());
        }
        div()
            .relative()
            .size_full()
            .child(page(
                "admin-invites",
                "Instance Invites",
                Some(SharedString::from(
                    "Manage invitation codes that allow new users to register and join your Semaphore Chat instance.",
                )),
                vec![create],
                body,
                window,
                cx,
            ))
            .children(overlays)
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
