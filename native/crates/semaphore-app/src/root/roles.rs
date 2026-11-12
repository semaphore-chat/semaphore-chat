//! W5: roles in the app. `RolesPanel` for the settings' Roles slot, the `RoleAssignmentDialog`
//! (from `MembersEvent::ManageRoles` and the moderation menu's `ChangeRoles`; saving runs each
//! assign, then each unassign, one at a time), and `ChannelOverrides` for the Edit Channel
//! permissions slot (`Core::build_preset` when it opens and on `Preview`, so the locked chips are
//! exact, and before `replace_channel_overwrites` on `Save`).
//!
//! Views are never cached here: on each `ViewChanged` that [`feeds`] says concerns an open view,
//! it is read from core again and handed over. Signing out drops everything (`drop_roles`);
//! `CoreEvent::CommunityRemoved` closes what's open for that community, and
//! `CoreEvent::ChannelRemoved` the overrides for that channel. A save chain stops between steps
//! once its dialog has gone ([`run_chain`]), so nothing of it lands on another session.

use super::AppRoot;
use gpui_kit::*;
use semaphore_core::model::{OverwritesDraft, UserView, ViewKey};
use semaphore_core::{Core, CoreError, CoreEvent};
use semaphore_ui::roles::rules::stored_choice;
use semaphore_ui::roles::{
    ChannelOverrides, ChannelOverridesEvent, PresetChoice, RoleAssignmentDialog,
    RoleAssignmentEvent, RolesEvent, RolesPanel,
};
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// The settings' Roles tab, for one community.
pub(super) struct Panel {
    community_id: String,
    view: Entity<RolesPanel>,
    /// The role whose members dialog is open.
    members_of: Option<String>,
    _events: Subscription,
}

/// One member's roles dialog.
pub(super) struct Assign {
    community_id: String,
    user_id: String,
    view: Entity<RoleAssignmentDialog>,
    /// Set when the dialog goes, so a save chain still running stops before its next step.
    gone: Arc<AtomicBool>,
    _events: Subscription,
}

impl Drop for Assign {
    fn drop(&mut self) {
        self.gone.store(true, Ordering::SeqCst);
    }
}

/// The Edit Channel dialog's permissions, for one channel.
pub(super) struct Overrides {
    community_id: String,
    channel_id: String,
    view: Entity<ChannelOverrides>,
    /// The choice last previewed, until it's saved: what the locked chips are worked out for.
    /// `None`: the stored set.
    choice: Option<PresetChoice>,
    _events: Subscription,
}

/// This session's roles views.
#[derive(Default)]
pub struct Roles {
    pub(super) panel: Option<Panel>,
    pub(super) assign: Option<Assign>,
    pub(super) overrides: Option<Overrides>,
}

/// What a `ViewChanged` asks to be read again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Feed {
    PanelRoles,
    PanelMembers,
    AssignRoles,
    AssignMember,
    Overrides,
}

/// What's open, as [`feeds`] needs it.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Open<'a> {
    /// The Roles tab's community, and the role whose members it shows.
    pub panel: Option<(&'a str, Option<&'a str>)>,
    /// The assignment dialog's community and member.
    pub assign: Option<(&'a str, &'a str)>,
    /// The overrides' community and channel.
    pub overrides: Option<(&'a str, &'a str)>,
}

/// The views to read again on `ViewChanged { view }`. A community's permissions change what
/// every roles view offers, so they feed all of that community's.
pub(crate) fn feeds(view: &ViewKey, open: Open) -> Vec<Feed> {
    let mut out = Vec::new();
    let panel = |community: &str| open.panel.is_some_and(|(id, _)| id == community);
    let assign = |community: &str| open.assign.is_some_and(|(id, _)| id == community);
    match view {
        ViewKey::Roles { community_id } => {
            if panel(community_id) {
                out.push(Feed::PanelRoles);
            }
            if assign(community_id) {
                out.push(Feed::AssignRoles);
            }
        }
        ViewKey::RoleMembers {
            community_id,
            role_id,
        } => {
            if open
                .panel
                .is_some_and(|(id, role)| id == community_id && role == Some(role_id.as_str()))
            {
                out.push(Feed::PanelMembers);
            }
        }
        ViewKey::MemberRoles {
            community_id,
            user_id,
        } => {
            if open
                .assign
                .is_some_and(|(id, user)| id == community_id && user == user_id)
            {
                out.push(Feed::AssignMember);
            }
        }
        ViewKey::ChannelOverwrites { channel_id } => {
            if open.overrides.is_some_and(|(_, id)| id == channel_id) {
                out.push(Feed::Overrides);
            }
        }
        ViewKey::CommunityPermissions { community_id } => {
            if panel(community_id) {
                out.push(Feed::PanelRoles);
            }
            if assign(community_id) {
                out.extend([Feed::AssignRoles, Feed::AssignMember]);
            }
            if open.overrides.is_some_and(|(id, _)| id == community_id) {
                out.push(Feed::Overrides);
            }
        }
        _ => {}
    }
    out
}

/// One step of saving a member's roles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Change {
    Assign(String),
    Unassign(String),
}

/// `RoleAssignmentEvent::Save`'s steps: every give, then every take, each once, in order.
pub(crate) fn changes(add: &[String], remove: &[String]) -> Vec<Change> {
    let mut out: Vec<Change> = Vec::new();
    for id in add {
        if !out.contains(&Change::Assign(id.clone())) {
            out.push(Change::Assign(id.clone()));
        }
    }
    for id in remove {
        // A role both given and taken is a no-op the dialog can't send; give wins if it does.
        if !add.contains(id) && !out.contains(&Change::Unassign(id.clone())) {
            out.push(Change::Unassign(id.clone()));
        }
    }
    out
}

/// How a save chain ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ChainEnd {
    Done,
    /// Step `at` failed: the steps after it weren't sent.
    Failed {
        at: usize,
        error: String,
    },
    /// The dialog went before step `at`, which wasn't sent.
    Abandoned {
        at: usize,
    },
}

/// Runs `steps` one at a time with `run`, stopping at the first failure, and before any step once
/// `gone` is set.
pub(crate) async fn run_chain<F, Fut>(steps: Vec<Change>, gone: &AtomicBool, mut run: F) -> ChainEnd
where
    F: FnMut(Change) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    for (at, step) in steps.into_iter().enumerate() {
        if gone.load(Ordering::SeqCst) {
            return ChainEnd::Abandoned { at };
        }
        if let Err(error) = run(step).await {
            return ChainEnd::Failed { at, error };
        }
    }
    ChainEnd::Done
}

/// The member as the community's member list has them, or just their id.
pub(super) fn member_user(core: &Core, community_id: &str, user_id: &str) -> UserView {
    core.members(community_id.to_owned())
        .and_then(|list| {
            list.members
                .into_iter()
                .find(|member| member.user.id == user_id)
        })
        .map(|member| member.user)
        .unwrap_or_else(|| UserView {
            id: user_id.to_owned(),
            username: user_id.to_owned(),
            ..UserView::default()
        })
}

fn shown_name(user: &UserView) -> String {
    user.display_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| user.username.clone())
}

impl AppRoot {
    /// Runs a W5 command whose result arrives through core's views; a failure is logged (the view
    /// shows it).
    pub(super) fn w5_fire(
        &self,
        what: &'static str,
        work: impl Future<Output = Result<(), CoreError>> + Send + 'static,
    ) {
        if let Some(services) = &self.services {
            services.exec.fire(async move {
                if let Err(error) = work.await {
                    log::warn!("{what}: {error}");
                }
            });
        }
    }

    /// Signed out: no roles view of the last session stays.
    pub(super) fn drop_roles(&mut self) {
        self.roles = Roles::default();
    }

    pub(super) fn roles_on_core(&mut self, event: &CoreEvent, cx: &mut Context<Self>) {
        match event {
            CoreEvent::ViewChanged { view } => {
                let open = self.roles_open();
                let wanted = feeds(view, open);
                for feed in wanted {
                    self.roles_feed(feed, cx);
                }
            }
            CoreEvent::CommunityRemoved { community_id, .. } => {
                let ours = |id: &str| id == community_id;
                if self
                    .roles
                    .panel
                    .as_ref()
                    .is_some_and(|p| ours(&p.community_id))
                {
                    self.roles.panel = None;
                }
                if self
                    .roles
                    .assign
                    .as_ref()
                    .is_some_and(|a| ours(&a.community_id))
                {
                    self.roles.assign = None;
                }
                if self
                    .roles
                    .overrides
                    .as_ref()
                    .is_some_and(|o| ours(&o.community_id))
                {
                    self.roles.overrides = None;
                }
                cx.notify();
            }
            CoreEvent::ChannelRemoved { channel_id, .. }
                if self
                    .roles
                    .overrides
                    .as_ref()
                    .is_some_and(|o| o.channel_id == *channel_id) =>
            {
                self.roles.overrides = None;
                cx.notify();
            }
            _ => {}
        }
    }

    fn roles_open(&self) -> Open<'_> {
        Open {
            panel: self
                .roles
                .panel
                .as_ref()
                .map(|p| (p.community_id.as_str(), p.members_of.as_deref())),
            assign: self
                .roles
                .assign
                .as_ref()
                .map(|a| (a.community_id.as_str(), a.user_id.as_str())),
            overrides: self
                .roles
                .overrides
                .as_ref()
                .map(|o| (o.community_id.as_str(), o.channel_id.as_str())),
        }
    }

    fn roles_feed(&mut self, feed: Feed, cx: &mut Context<Self>) {
        let Some(core) = self.core() else {
            return;
        };
        match feed {
            Feed::PanelRoles => {
                if let Some(panel) = &self.roles.panel {
                    let view = core.roles(panel.community_id.clone());
                    panel.view.update(cx, |p, cx| p.set_roles(view, cx));
                }
            }
            Feed::PanelMembers => {
                if let Some(panel) = &self.roles.panel {
                    let members = panel
                        .members_of
                        .clone()
                        .map(|role| core.role_members(panel.community_id.clone(), role));
                    panel
                        .view
                        .update(cx, |p, cx| p.set_role_members(members, cx));
                }
            }
            Feed::AssignRoles => {
                if let Some(assign) = &self.roles.assign {
                    let view = core.roles(assign.community_id.clone());
                    assign.view.update(cx, |d, cx| d.set_roles(view, cx));
                }
            }
            Feed::AssignMember => {
                if let Some(assign) = &self.roles.assign {
                    let view =
                        core.member_roles(assign.community_id.clone(), assign.user_id.clone());
                    assign.view.update(cx, |d, cx| d.set_member_roles(view, cx));
                }
            }
            Feed::Overrides => self.feed_overrides(&core, cx),
        }
    }

    /// The overrides' view, and the roles its choice keeps (`BuiltPreset::auto_allowed_role_ids`).
    fn feed_overrides(&mut self, core: &Core, cx: &mut Context<Self>) {
        let Some(overrides) = &self.roles.overrides else {
            return;
        };
        let view = core.channel_overwrites(overrides.channel_id.clone());
        let ready = view.state == semaphore_core::model::LoadState::Ready;
        let choice = overrides
            .choice
            .clone()
            .unwrap_or_else(|| stored_choice(&view.detected));
        let kept = ready.then(|| {
            core.build_preset(
                overrides.channel_id.clone(),
                choice.card.preset(),
                choice.post_role_ids.clone(),
                choice.members_can_attach,
            )
            .auto_allowed_role_ids
        });
        overrides.view.update(cx, |o, cx| {
            o.set_overwrites(view, cx);
            o.set_kept(kept, cx);
        });
    }

    /// The assignment dialog over the shell, while it's open.
    pub(super) fn roles_overlays(&self, _cx: &mut Context<Self>) -> Vec<AnyElement> {
        self.roles
            .assign
            .iter()
            .map(|assign| assign.view.clone().into_any_element())
            .collect()
    }

    /// The view for `CommunitySettingsScreen::set_roles_slot`, built for this community (the same
    /// one again while it's for the same community).
    pub(super) fn roles_slot(
        &mut self,
        community_id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyView> {
        let core = self.core()?;
        if let Some(panel) = &self.roles.panel
            && panel.community_id == community_id
        {
            return Some(panel.view.clone().into());
        }
        let view = cx.new(|cx| RolesPanel::new(window, cx));
        let catalog = core.permission_catalog();
        let roles = core.roles(community_id.to_owned());
        let time = self.config.time;
        view.update(cx, |panel, cx| {
            panel.set_time(time, cx);
            panel.set_catalog(catalog, cx);
            panel.set_roles(roles, cx);
        });
        let events = cx.subscribe(&view, Self::on_roles_panel);
        self.roles.panel = Some(Panel {
            community_id: community_id.to_owned(),
            view: view.clone(),
            members_of: None,
            _events: events,
        });
        Some(view.into())
    }

    fn on_roles_panel(
        &mut self,
        _: Entity<RolesPanel>,
        event: &RolesEvent,
        cx: &mut Context<Self>,
    ) {
        let (Some(core), Some(community_id)) = (
            self.core(),
            self.roles.panel.as_ref().map(|p| p.community_id.clone()),
        ) else {
            return;
        };
        let id = community_id.clone();
        match event.clone() {
            RolesEvent::Create { draft } => self.w5_fire("creating a role", async move {
                core.create_role(id, draft).await.map(|_| ())
            }),
            RolesEvent::Update { role_id, patch } => self.w5_fire("saving a role", async move {
                core.update_role(id, role_id, patch).await
            }),
            RolesEvent::Delete { role_id } => self.w5_fire("deleting a role", async move {
                core.delete_role(id, role_id).await
            }),
            RolesEvent::Reorder { role_ids } => self.w5_fire("reordering roles", async move {
                core.reorder_roles(id, role_ids).await
            }),
            RolesEvent::ResetDefaults => self.w5_fire("resetting the default roles", async move {
                core.reset_default_roles(id).await
            }),
            RolesEvent::ShowMembers { role_id } => {
                if let Some(panel) = &mut self.roles.panel {
                    panel.members_of = Some(role_id);
                }
                self.roles_feed(Feed::PanelMembers, cx);
            }
            RolesEvent::CloseMembers => {
                if let Some(panel) = &mut self.roles.panel {
                    panel.members_of = None;
                }
                self.roles_feed(Feed::PanelMembers, cx);
            }
        }
    }

    /// The view for `ChannelsTab::set_permissions_slot` while the Edit Channel dialog is open on
    /// `channel_id` (`ChannelsEvent::OpenEdit`); `close_channel_permissions` on `CloseEdit`.
    pub(super) fn channel_permissions_slot(
        &mut self,
        community_id: &str,
        channel_id: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyView> {
        let core = self.core()?;
        if let Some(overrides) = &self.roles.overrides
            && overrides.channel_id == channel_id
        {
            return Some(overrides.view.clone().into());
        }
        let view = cx.new(|_| ChannelOverrides::new(channel_id.to_owned()));
        let events = cx.subscribe(&view, Self::on_overrides);
        self.roles.overrides = Some(Overrides {
            community_id: community_id.to_owned(),
            channel_id: channel_id.to_owned(),
            view: view.clone(),
            choice: None,
            _events: events,
        });
        self.feed_overrides(&core, cx);
        Some(view.into())
    }

    pub(super) fn close_channel_permissions(&mut self, cx: &mut Context<Self>) {
        if self.roles.overrides.take().is_some() {
            cx.notify();
        }
    }

    fn on_overrides(
        &mut self,
        _: Entity<ChannelOverrides>,
        event: &ChannelOverridesEvent,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        match event.clone() {
            ChannelOverridesEvent::Preview { channel_id, choice } => {
                if let Some(overrides) = &mut self.roles.overrides
                    && overrides.channel_id == channel_id
                {
                    overrides.choice = Some(choice);
                }
                self.feed_overrides(&core, cx);
            }
            ChannelOverridesEvent::Save { channel_id, choice } => {
                let built = core.build_preset(
                    channel_id.clone(),
                    choice.card.preset(),
                    choice.post_role_ids,
                    choice.members_can_attach,
                );
                // Saved, the stored set is the choice: the chips follow it from now on.
                if let Some(overrides) = &mut self.roles.overrides
                    && overrides.channel_id == channel_id
                {
                    overrides.choice = None;
                }
                let draft = OverwritesDraft {
                    preset: built.preset,
                    overwrites: built.overwrites,
                };
                self.w5_fire("saving channel permissions", async move {
                    core.replace_channel_overwrites(channel_id, draft).await
                });
            }
        }
    }

    /// One member's roles (`MembersEvent::ManageRoles`, `ModerationMenuEvent::ChangeRoles`).
    pub(super) fn open_role_assignment(
        &mut self,
        community_id: String,
        user_id: String,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(core) = self.core() else {
            return;
        };
        let name = shown_name(&member_user(&core, &community_id, &user_id));
        let view = cx.new(|_| RoleAssignmentDialog::new(user_id.clone(), name));
        let (roles, member) = (
            core.roles(community_id.clone()),
            core.member_roles(community_id.clone(), user_id.clone()),
        );
        view.update(cx, |dialog, cx| {
            dialog.set_roles(roles, cx);
            dialog.set_member_roles(member, cx);
        });
        let events = cx.subscribe(&view, Self::on_assignment);
        self.roles.assign = Some(Assign {
            community_id,
            user_id,
            view,
            gone: Arc::default(),
            _events: events,
        });
        cx.notify();
    }

    fn on_assignment(
        &mut self,
        dialog: Entity<RoleAssignmentDialog>,
        event: &RoleAssignmentEvent,
        cx: &mut Context<Self>,
    ) {
        match event.clone() {
            RoleAssignmentEvent::Close => {
                self.roles.assign = None;
                cx.notify();
            }
            RoleAssignmentEvent::Save {
                user_id,
                add,
                remove,
            } => {
                let (Some(core), Some(services), Some(assign)) = (
                    self.core(),
                    self.services.as_ref(),
                    self.roles.assign.as_ref(),
                ) else {
                    return;
                };
                if assign.view != dialog {
                    return;
                }
                let steps = changes(&add, &remove);
                if steps.is_empty() {
                    self.roles.assign = None;
                    cx.notify();
                    return;
                }
                dialog.update(cx, |d, cx| d.set_saving(true, cx));
                let (gone, community_id) = (assign.gone.clone(), assign.community_id.clone());
                let (sender, receiver) = async_channel::bounded(1);
                services.exec.handle().spawn(async move {
                    let end = run_chain(steps, &gone, |step| {
                        let (core, community_id, user_id) =
                            (core.clone(), community_id.clone(), user_id.clone());
                        async move {
                            match step {
                                Change::Assign(role) => {
                                    core.assign_role(community_id, user_id, role).await
                                }
                                Change::Unassign(role) => {
                                    core.unassign_role(community_id, user_id, role).await
                                }
                            }
                            .map_err(|error| error.to_string())
                        }
                    })
                    .await;
                    let _ = sender.send(end).await;
                });
                let dialog = dialog.downgrade();
                cx.spawn(async move |this, cx| {
                    let Ok(end) = receiver.recv().await else {
                        return;
                    };
                    this.update(cx, |this, cx| {
                        // Only the dialog that saved, if it's still the open one.
                        let open = this
                            .roles
                            .assign
                            .as_ref()
                            .is_some_and(|a| a.view.downgrade() == dialog);
                        if !open {
                            return;
                        }
                        match end {
                            ChainEnd::Done => this.roles.assign = None,
                            ChainEnd::Failed { error, .. } => {
                                log::warn!("saving a member's roles: {error}");
                                dialog.update(cx, |d, cx| d.set_saving(false, cx)).ok();
                            }
                            ChainEnd::Abandoned { .. } => {}
                        }
                        cx.notify();
                    })
                    .ok();
                })
                .detach();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn key_roles(c: &str) -> ViewKey {
        ViewKey::Roles {
            community_id: c.into(),
        }
    }

    #[test]
    fn feeds_read_only_what_is_open_for_that_community() {
        let all = Open {
            panel: Some(("c1", Some("r1"))),
            assign: Some(("c1", "u1")),
            overrides: Some(("c1", "ch1")),
        };
        let cases: Vec<(ViewKey, Open, Vec<Feed>)> = vec![
            (key_roles("c1"), Open::default(), vec![]),
            (
                key_roles("c1"),
                all,
                vec![Feed::PanelRoles, Feed::AssignRoles],
            ),
            (key_roles("c2"), all, vec![]),
            (
                key_roles("c1"),
                Open {
                    assign: Some(("c1", "u1")),
                    ..Open::default()
                },
                vec![Feed::AssignRoles],
            ),
            (
                ViewKey::RoleMembers {
                    community_id: "c1".into(),
                    role_id: "r1".into(),
                },
                all,
                vec![Feed::PanelMembers],
            ),
            // Another role's members, or no members dialog: nothing.
            (
                ViewKey::RoleMembers {
                    community_id: "c1".into(),
                    role_id: "r2".into(),
                },
                all,
                vec![],
            ),
            (
                ViewKey::RoleMembers {
                    community_id: "c1".into(),
                    role_id: "r1".into(),
                },
                Open {
                    panel: Some(("c1", None)),
                    ..Open::default()
                },
                vec![],
            ),
            (
                ViewKey::RoleMembers {
                    community_id: "c2".into(),
                    role_id: "r1".into(),
                },
                all,
                vec![],
            ),
            (
                ViewKey::MemberRoles {
                    community_id: "c1".into(),
                    user_id: "u1".into(),
                },
                all,
                vec![Feed::AssignMember],
            ),
            (
                ViewKey::MemberRoles {
                    community_id: "c1".into(),
                    user_id: "u2".into(),
                },
                all,
                vec![],
            ),
            (
                ViewKey::MemberRoles {
                    community_id: "c2".into(),
                    user_id: "u1".into(),
                },
                all,
                vec![],
            ),
            (
                ViewKey::ChannelOverwrites {
                    channel_id: "ch1".into(),
                },
                all,
                vec![Feed::Overrides],
            ),
            (
                ViewKey::ChannelOverwrites {
                    channel_id: "ch2".into(),
                },
                all,
                vec![],
            ),
            (
                ViewKey::CommunityPermissions {
                    community_id: "c1".into(),
                },
                all,
                vec![
                    Feed::PanelRoles,
                    Feed::AssignRoles,
                    Feed::AssignMember,
                    Feed::Overrides,
                ],
            ),
            (
                ViewKey::CommunityPermissions {
                    community_id: "c2".into(),
                },
                all,
                vec![],
            ),
            (ViewKey::Session, all, vec![]),
            (
                ViewKey::Channels {
                    community_id: "c1".into(),
                },
                all,
                vec![],
            ),
        ];
        for (view, open, want) in cases {
            assert_eq!(feeds(&view, open), want, "{view:?} with {open:?}");
        }
    }

    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn changes_give_first_then_take_each_once() {
        let a = |id: &str| Change::Assign(id.into());
        let u = |id: &str| Change::Unassign(id.into());
        let cases: Vec<(&[&str], &[&str], Vec<Change>)> = vec![
            (&[], &[], vec![]),
            (&["r1"], &[], vec![a("r1")]),
            (&[], &["r1"], vec![u("r1")]),
            (&["r2", "r1"], &["r3"], vec![a("r2"), a("r1"), u("r3")]),
            (&["r1", "r1"], &["r2", "r2"], vec![a("r1"), u("r2")]),
            // Both: the give stands.
            (&["r1"], &["r1", "r2"], vec![a("r1"), u("r2")]),
        ];
        for (add, remove, want) in cases {
            assert_eq!(changes(&ids(add), &ids(remove)), want, "{add:?} {remove:?}");
        }
    }

    #[tokio::test]
    async fn a_chain_runs_in_order_and_stops_at_the_first_failure_or_once_gone() {
        use std::sync::Mutex;
        let steps = changes(&ids(&["a", "b"]), &ids(&["c"]));
        // (fail at, gone before step, expected end, steps sent)
        let cases: Vec<(Option<usize>, Option<usize>, ChainEnd, usize)> = vec![
            (None, None, ChainEnd::Done, 3),
            (
                Some(0),
                None,
                ChainEnd::Failed {
                    at: 0,
                    error: "no".into(),
                },
                1,
            ),
            (
                Some(2),
                None,
                ChainEnd::Failed {
                    at: 2,
                    error: "no".into(),
                },
                3,
            ),
            (None, Some(1), ChainEnd::Abandoned { at: 1 }, 1),
            (None, Some(2), ChainEnd::Abandoned { at: 2 }, 2),
            // Gone after the failing step's turn: the failure is what ends it.
            (
                Some(1),
                Some(2),
                ChainEnd::Failed {
                    at: 1,
                    error: "no".into(),
                },
                2,
            ),
        ];
        for (fail_at, gone_before, want, sent_count) in cases {
            let gone = AtomicBool::new(false);
            let sent = Mutex::new(Vec::new());
            let end = run_chain(steps.clone(), &gone, |step| {
                let index = {
                    let mut sent = sent.lock().unwrap();
                    sent.push(step);
                    sent.len() - 1
                };
                if gone_before == Some(index + 1) {
                    gone.store(true, Ordering::SeqCst);
                }
                async move {
                    if fail_at == Some(index) {
                        Err("no".to_owned())
                    } else {
                        Ok(())
                    }
                }
            })
            .await;
            let sent = sent.into_inner().unwrap();
            assert_eq!(end, want, "fail {fail_at:?} gone {gone_before:?}");
            assert_eq!(
                sent.len(),
                sent_count,
                "fail {fail_at:?} gone {gone_before:?}"
            );
            assert_eq!(sent[..], steps[..sent.len()]);
        }
        // Gone before the first step: nothing is sent.
        let gone = AtomicBool::new(true);
        let mut sent = 0;
        let end = run_chain(steps.clone(), &gone, |_| {
            sent += 1;
            async { Ok(()) }
        })
        .await;
        assert_eq!(end, ChainEnd::Abandoned { at: 0 });
        assert_eq!(sent, 0);
        // An empty chain is done at once.
        assert_eq!(
            run_chain(Vec::new(), &AtomicBool::new(false), |_| async { Ok(()) }).await,
            ChainEnd::Done
        );
    }
}
