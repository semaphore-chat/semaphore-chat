//! W3's registering, forgot password, invites, sign in with browser and creating communities.
//!
//! `Core::set_loopback` isn't exported: a mobile app would sign in with browser through its OS's
//! web authentication session and a custom scheme, not a loopback listener, so over UniFFI
//! `start_browser_sign_in` stays unavailable until that variant exists.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    BrowserSignInFailure, BrowserSignInView, CreatedCommunity, ErrorView, InvitePreview,
    InvitePreviewView, LoadState, NewCommunity, RegisterForm, RegistrationMode,
};

#[uniffi::remote(Enum)]
pub enum RegistrationMode {
    Open,
    InviteOnly,
    Closed,
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
    pub async fn register(&self, form: RegisterForm) -> Result<(), CoreError> {
        self.core.register(form).await
    }

    pub async fn forgot_password(&self, email: String) -> Result<(), CoreError> {
        self.core.forgot_password(email).await
    }

    pub fn invite_preview(&self, code: String) -> InvitePreviewView {
        self.core.invite_preview(code)
    }

    pub async fn create_community(
        &self,
        community: NewCommunity,
    ) -> Result<CreatedCommunity, CoreError> {
        self.core.create_community(community).await
    }

    pub async fn start_browser_sign_in(&self) -> Result<String, CoreError> {
        self.core.start_browser_sign_in().await
    }

    pub fn cancel_browser_sign_in(&self) {
        self.core.cancel_browser_sign_in();
    }

    pub fn browser_sign_in(&self) -> BrowserSignInView {
        self.core.browser_sign_in()
    }
}
