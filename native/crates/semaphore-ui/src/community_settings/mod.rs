//! W5-ui-community: the community settings shell and its tabs, from `pages/EditCommunityPage.tsx`
//! and `components/Community/`. What this user may do comes from core's
//! `CommunityPermissionsView` (`CommunityCaps`), never from roles: an action it doesn't allow shows
//! disabled with the reason, not hidden.
//!
//! - `CommunitySettingsScreen`: the section nav beside the open tab (a list to tap into on a phone),
//!   as `FormPageShell` on the web's desktop. It creates every tab and hands them out, so the owner
//!   feeds each one and listens to it. Roles and Moderation are slots: the W5 roles and moderation
//!   lanes' views go in them.
//! - `OverviewTab` (`CommunitySettingsForm` and `CommunityFormContent`): name, description, avatar
//!   and banner, and deleting the community behind its typed name (the web has no delete).
//! - `MembersTab` (`MemberManagement.tsx`): the members with their top role, the roles and
//!   moderation entry points (dialogs of the other lanes), and adding members through search.
//! - `ChannelsTab` (`ChannelManagement.tsx`, `CreateChannelDialog.tsx`, `EditChannelDialog.tsx`,
//!   `WebhookManagement.tsx`): text and voice channels, create, rename, delete, move, and a text
//!   channel's webhooks in its edit dialog; channel permissions are a slot there.
//! - `PrivateChannelsTab` (`PrivateChannelMembership.tsx`): a private channel's members.
//! - `MentionGroupsTab` (`AliasGroupManagement.tsx`, `AliasGroupEditor.tsx`).
//! - `EmojiTab` (`CustomEmojiManagement.tsx`), `SoundboardTab` (`SoundboardManagement.tsx`).
//! - `InvitesTab` (`InviteManagement.tsx`, which the web never mounts): my invites that include
//!   this community.
//!
//! Several changes share one op (`CommunitySettingsView::op`), which core keeps per change
//! (`AdminOp::actions`): each tab and row reads only its own change's entry (`rules::state_of`), and
//! `CommunitySettingsScreen::set_settings` hands that op to the tabs that send on it.

mod channels;
mod common;
mod emoji;
mod groups;
mod invites;
mod members;
mod overview;
mod private;
pub mod rules;
mod shell;
mod sounds;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;

pub use channels::{ChannelsEvent, ChannelsTab};
pub use emoji::{EmojiEvent, EmojiTab};
pub use groups::{MentionGroupsEvent, MentionGroupsTab};
pub use invites::{InvitesEvent, InvitesTab};
pub use members::{MembersEvent, MembersTab};
pub use overview::{CommunityImage, OverviewEvent, OverviewTab};
pub use private::{PrivateChannelsEvent, PrivateChannelsTab};
pub use rules::{CommunityTab, ExpiryPreset, InviteStatus};
pub use sounds::{SoundboardEvent, SoundboardTab};

use gpui_kit::*;
use semaphore_core::model::{CommunityPermissionsView, CommunitySettingsView, LoadState};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommunityShellEvent {
    /// The user picked a tab: the owner keeps it in the route.
    TabChanged(CommunityTab),
    /// The close button: back to the community.
    Close,
    /// The permissions failed to load and the user asked again: `Core::retry_failed`.
    RetryPermissions,
}

pub struct CommunitySettingsScreen {
    community_id: String,
    community_name: String,
    permissions: CommunityPermissionsView,
    tab: CommunityTab,
    /// The route named a tab, or the user picked one: don't move to the first open one.
    tab_chosen: bool,
    phone_open: bool,
    overview: Entity<OverviewTab>,
    members: Entity<MembersTab>,
    channels: Entity<ChannelsTab>,
    private_channels: Entity<PrivateChannelsTab>,
    mention_groups: Entity<MentionGroupsTab>,
    emoji: Entity<EmojiTab>,
    soundboard: Entity<SoundboardTab>,
    invites: Entity<InvitesTab>,
    roles: Option<AnyView>,
    moderation: Option<AnyView>,
}

impl EventEmitter<CommunityShellEvent> for CommunitySettingsScreen {}

impl CommunitySettingsScreen {
    pub fn new(
        community_id: impl Into<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let community_id = community_id.into();
        Self {
            permissions: CommunityPermissionsView {
                community_id: community_id.clone(),
                ..CommunityPermissionsView::default()
            },
            community_name: String::new(),
            tab: CommunityTab::Overview,
            tab_chosen: false,
            phone_open: false,
            overview: cx.new(|cx| OverviewTab::new(window, cx)),
            members: cx.new(|cx| MembersTab::new(window, cx)),
            channels: cx.new(|cx| ChannelsTab::new(window, cx)),
            private_channels: cx.new(|cx| PrivateChannelsTab::new(window, cx)),
            mention_groups: cx.new(|cx| MentionGroupsTab::new(window, cx)),
            emoji: cx.new(|cx| EmojiTab::new(window, cx)),
            soundboard: cx.new(|cx| SoundboardTab::new(window, cx)),
            invites: cx.new(|cx| InvitesTab::new(window, cx)),
            roles: None,
            moderation: None,
            community_id,
        }
    }

    pub fn community_id(&self) -> &str {
        &self.community_id
    }

    /// `Core::community_permissions`, read again on `ViewChanged { CommunityPermissions }`. Every
    /// tab gets the caps; the nav locks the tabs they don't open.
    pub fn set_permissions(&mut self, view: CommunityPermissionsView, cx: &mut Context<Self>) {
        let caps = view.caps;
        self.overview.update(cx, |tab, cx| tab.set_caps(caps, cx));
        self.members.update(cx, |tab, cx| tab.set_caps(caps, cx));
        self.channels.update(cx, |tab, cx| tab.set_caps(caps, cx));
        self.private_channels
            .update(cx, |tab, cx| tab.set_caps(caps, cx));
        self.mention_groups
            .update(cx, |tab, cx| tab.set_caps(caps, cx));
        self.emoji.update(cx, |tab, cx| tab.set_caps(caps, cx));
        self.soundboard.update(cx, |tab, cx| tab.set_caps(caps, cx));
        self.invites.update(cx, |tab, cx| tab.set_caps(caps, cx));
        let ready = matches!(view.state, LoadState::Ready);
        self.permissions = view;
        if ready && !self.tab_chosen {
            self.tab = rules::first_open_tab(&caps);
        }
        cx.notify();
    }

    /// `Core::community_settings`, read again on `ViewChanged { CommunitySettings }`: the overview
    /// form, the breadcrumb's name, and the op the channels, members and soundboard tabs share.
    pub fn set_settings(
        &mut self,
        view: CommunitySettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.community_name = view.name.clone();
        let op = view.op.clone();
        self.members
            .update(cx, |tab, cx| tab.set_op(op.clone(), cx));
        self.channels
            .update(cx, |tab, cx| tab.set_op(op.clone(), cx));
        self.soundboard.update(cx, |tab, cx| tab.set_op(op, cx));
        self.overview
            .update(cx, |tab, cx| tab.set_view(view, window, cx));
        cx.notify();
    }

    /// The route's tab. On a phone this opens it, rather than showing the list.
    pub fn set_tab(&mut self, tab: CommunityTab, cx: &mut Context<Self>) {
        self.tab = tab;
        self.tab_chosen = true;
        self.phone_open = true;
        cx.notify();
    }

    pub fn tab(&self) -> CommunityTab {
        self.tab
    }

    /// The roles lane's role list and editor, for the Roles tab.
    pub fn set_roles_slot(&mut self, view: Option<AnyView>, cx: &mut Context<Self>) {
        self.roles = view;
        cx.notify();
    }

    /// The moderation lane's ban list, timeout list and log, for the Moderation tab.
    pub fn set_moderation_slot(&mut self, view: Option<AnyView>, cx: &mut Context<Self>) {
        self.moderation = view;
        cx.notify();
    }

    pub fn overview(&self) -> Entity<OverviewTab> {
        self.overview.clone()
    }

    pub fn members(&self) -> Entity<MembersTab> {
        self.members.clone()
    }

    pub fn channels(&self) -> Entity<ChannelsTab> {
        self.channels.clone()
    }

    pub fn private_channels(&self) -> Entity<PrivateChannelsTab> {
        self.private_channels.clone()
    }

    pub fn mention_groups(&self) -> Entity<MentionGroupsTab> {
        self.mention_groups.clone()
    }

    pub fn emoji(&self) -> Entity<EmojiTab> {
        self.emoji.clone()
    }

    pub fn soundboard(&self) -> Entity<SoundboardTab> {
        self.soundboard.clone()
    }

    pub fn invites(&self) -> Entity<InvitesTab> {
        self.invites.clone()
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
