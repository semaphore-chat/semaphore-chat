//! W3's registering, forgot password, invites, sign in with browser and creating communities.
//!
//! `Core::set_loopback` isn't exported: a mobile app would sign in with browser through its OS's
//! web authentication session and a custom scheme, not a loopback listener, so over UniFFI
//! `start_browser_sign_in` stays unavailable until that variant exists.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    BrowserSignInFailure, BrowserSignInView, CreatedCommunity, ErrorView, InviteJoin,
    InvitePreview, InvitePreviewView, InviteSkipReason, JoinedCommunity, LoadState, NewCommunity,
    RegisterForm, RegisterRequirements, RegistrationMode, ServerInfo, SkippedInviteCommunity,
};

#[uniffi::remote(Enum)]
pub enum RegistrationMode {
    Open,
    InviteOnly,
    Closed,
}

/// What the last probe said: `Core::server_info`.
#[uniffi::remote(Record)]
pub struct ServerInfo {
    pub url: String,
    pub name: Option<String>,
    pub max_file_bytes: Option<u64>,
    pub password_reset: bool,
    pub registration: RegistrationMode,
    pub browser_sign_in: bool,
    pub gif_search: bool,
    pub needs_setup: bool,
}

#[uniffi::remote(Record)]
pub struct RegisterRequirements {
    pub mode: RegistrationMode,
    pub can_register: bool,
    pub invite_required: bool,
}

#[uniffi::remote(Record)]
pub struct RegisterForm {
    pub username: String,
    pub password: String,
    pub email: Option<String>,
    pub invite_code: String,
}

#[uniffi::remote(Record)]
pub struct InvitePreview {
    pub code: String,
    pub created_by: Option<String>,
    pub uses: u32,
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
}

#[uniffi::remote(Record)]
pub struct InvitePreviewView {
    pub state: LoadState,
    pub invite: Option<InvitePreview>,
    pub reason: Option<String>,
}

#[uniffi::remote(Record)]
pub struct JoinedCommunity {
    pub id: String,
    pub name: String,
}

#[uniffi::remote(Enum)]
pub enum InviteSkipReason {
    AlreadyMember,
    Banned,
    Other,
}

#[uniffi::remote(Record)]
pub struct SkippedInviteCommunity {
    pub id: String,
    pub name: String,
    pub reason: InviteSkipReason,
}

#[uniffi::remote(Record)]
pub struct InviteJoin {
    pub joined: Vec<JoinedCommunity>,
    pub skipped: Vec<SkippedInviteCommunity>,
}

#[uniffi::remote(Enum)]
pub enum BrowserSignInFailure {
    Denied,
    TimedOut,
    Refused { error: ErrorView },
    ListenFailed { message: String },
    NotOffered,
}

#[uniffi::remote(Enum)]
pub enum BrowserSignInView {
    Idle,
    Waiting { expires_at_ms: u64 },
    Redeeming,
    Failed { reason: BrowserSignInFailure },
}

#[uniffi::remote(Record)]
pub struct NewCommunity {
    pub name: String,
    pub description: Option<String>,
}

#[uniffi::remote(Record)]
pub struct CreatedCommunity {
    pub id: String,
}

/// `semaphore_core::commands::browser_sign_in::BROWSER_SIGN_IN_TIMEOUT_MS`.
#[uniffi::export]
pub fn browser_sign_in_timeout_ms() -> u64 {
    semaphore_core::commands::browser_sign_in::BROWSER_SIGN_IN_TIMEOUT_MS
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn register_requirements(&self) -> RegisterRequirements {
        self.sync(move |core| core.register_requirements())
    }

    pub fn server_info(&self) -> Option<ServerInfo> {
        self.sync(move |core| core.server_info())
    }

    pub async fn register(&self, form: RegisterForm) -> Result<(), CoreError> {
        self.run(move |core| async move { core.register(form).await })
            .await
    }

    pub async fn accept_invite(&self, code: String) -> Result<InviteJoin, CoreError> {
        self.run(move |core| async move { core.accept_invite(code).await })
            .await
    }

    pub async fn forgot_password(&self, email: String) -> Result<(), CoreError> {
        self.run(move |core| async move { core.forgot_password(email).await })
            .await
    }

    pub fn invite_preview(&self, code: String) -> InvitePreviewView {
        self.sync(move |core| core.invite_preview(code))
    }

    pub async fn create_community(
        &self,
        community: NewCommunity,
    ) -> Result<CreatedCommunity, CoreError> {
        self.run(move |core| async move { core.create_community(community).await })
            .await
    }

    pub async fn start_browser_sign_in(&self) -> Result<String, CoreError> {
        self.run(move |core| async move { core.start_browser_sign_in().await })
            .await
    }

    pub fn cancel_browser_sign_in(&self) {
        self.sync(move |core| {
            core.cancel_browser_sign_in();
        })
    }

    pub fn browser_sign_in(&self) -> BrowserSignInView {
        self.sync(move |core| core.browser_sign_in())
    }
}
