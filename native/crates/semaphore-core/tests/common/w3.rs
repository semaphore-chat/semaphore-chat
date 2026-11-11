//! [`FakeBackend`] for W3: the account and onboarding areas, scripted through `FakeBackend::w3`
//! as W2's are (answers decoded into the wire type, errors, gates, the calls made). Appearance
//! answers the server's defaults when nothing is scripted, so signing in needs no script.

use super::FakeBackend;
use semaphore_core::backend::{AccountBackend, BackendResult, OnboardingBackend};
use semaphore_wire::types as wire;
use serde_json::{Value, json};

pub fn appearance_json(mode: &str, accent: &str, intensity: &str) -> Value {
    json!({
        "id": "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0ca001", "userId": "me", "themeMode": mode,
        "accentColor": accent, "intensity": intensity,
        "createdAt": "2026-11-01T00:00:00Z", "updatedAt": "2026-11-01T00:00:00Z",
    })
}

pub fn session_json(id: &str, current: bool, last_used: &str) -> Value {
    json!({
        "id": id, "deviceName": format!("device {id}"), "ipAddress": "10.0.0.1",
        "createdAt": "2026-11-01T00:00:00Z", "lastUsedAt": last_used,
        "expiresAt": "2026-12-01T00:00:00Z", "isCurrent": current,
    })
}

pub fn profile_json(display_name: &str, bio: Option<&str>, avatar: Option<&str>) -> Value {
    json!({
        "id": "me", "username": "me", "role": "USER", "displayName": display_name,
        "bio": bio, "status": null, "avatarUrl": avatar, "bannerUrl": null,
    })
}

#[async_trait::async_trait]
impl AccountBackend for FakeBackend {
    async fn user_controller_update_profile(
        &self,
        body: wire::UpdateProfileDto,
    ) -> BackendResult<wire::UserEntity> {
        let body = serde_json::to_string(&body).unwrap();
        self.w3.run("update_profile", &[&body]).await
    }
    async fn auth_controller_get_sessions(&self) -> BackendResult<Vec<wire::SessionInfoDto>> {
        self.w3.run("sessions", &[]).await
    }
    async fn auth_controller_revoke_session(
        &self,
        session_id: String,
    ) -> BackendResult<wire::RevokeSessionResponseDto> {
        self.w3.run("revoke", &[&session_id]).await
    }
    async fn auth_controller_revoke_all_other_sessions(
        &self,
    ) -> BackendResult<wire::RevokeAllSessionsResponseDto> {
        self.w3.run("revoke_others", &[]).await
    }
    async fn roles_controller_get_my_instance_roles(
        &self,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        self.w3.run("instance_roles", &[]).await
    }
    async fn appearance_settings_controller_get_settings(
        &self,
    ) -> BackendResult<wire::AppearanceSettingsResponseDto> {
        if !self.w3.answers.lock().unwrap().contains_key("appearance") {
            self.w3
                .answer("appearance", appearance_json("dark", "teal", "minimal"));
        }
        self.w3.run("appearance", &[]).await
    }
    async fn appearance_settings_controller_update_settings(
        &self,
        body: wire::UpdateAppearanceSettingsDto,
    ) -> BackendResult<wire::AppearanceSettingsResponseDto> {
        let body = serde_json::to_string(&body).unwrap();
        self.w3.run("update_appearance", &[&body]).await
    }
}

#[async_trait::async_trait]
impl OnboardingBackend for FakeBackend {
    async fn user_controller_register(
        &self,
        body: wire::CreateUserDto,
    ) -> BackendResult<wire::UserEntity> {
        self.w3
            .run("register", &[body.username.as_str(), &body.code])
            .await
    }
    async fn auth_controller_forgot_password(
        &self,
        body: wire::ForgotPasswordRequestDto,
    ) -> BackendResult<wire::ForgotPasswordResponseDto> {
        self.w3.run("forgot", &[&body.email]).await
    }
    async fn invite_controller_get_public_invite(
        &self,
        code: String,
    ) -> BackendResult<Option<wire::PublicInviteDto>> {
        self.w3.run("invite", &[&code]).await
    }
    async fn community_controller_create(
        &self,
        body: wire::CreateCommunityDto,
    ) -> BackendResult<wire::CommunityResponseDto> {
        self.w3.run("create_community", &[body.name.as_str()]).await
    }
}

use semaphore_core::platform::{
    CoreError, Loopback, LoopbackListener, LoopbackPage, LoopbackRequest,
};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

/// A loopback whose listeners a test feeds by hand, standing in for the browser.
#[derive(Default)]
pub struct FakeLoopback {
    pub listeners: Mutex<Vec<Arc<FakeListener>>>,
    pub bind_fails: Mutex<Option<String>>,
}

impl FakeLoopback {
    /// The newest listener.
    pub fn last(&self) -> Arc<FakeListener> {
        self.listeners
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("a listener")
    }
}

#[async_trait::async_trait]
impl Loopback for FakeLoopback {
    async fn bind(&self) -> Result<Arc<dyn LoopbackListener>, CoreError> {
        if let Some(message) = self.bind_fails.lock().unwrap().take() {
            return Err(CoreError::Failed { message });
        }
        let mut listeners = self.listeners.lock().unwrap();
        let listener = Arc::new(FakeListener {
            port: 40_000 + listeners.len() as u16,
            ..FakeListener::default()
        });
        listeners.push(listener.clone());
        Ok(listener)
    }
}

#[derive(Default)]
pub struct FakeListener {
    pub port: u16,
    queue: Mutex<VecDeque<LoopbackRequest>>,
    next_id: AtomicU64,
    pub replies: Mutex<Vec<(u64, LoopbackPage)>>,
    pub closed: AtomicBool,
    expired: AtomicBool,
    pub timeouts_asked: Mutex<Vec<u64>>,
    wake: Notify,
}

impl FakeListener {
    /// A request as a browser on this machine would send it, to `target`.
    pub fn get(&self, target: &str) -> u64 {
        self.request("GET", Some(&format!("127.0.0.1:{}", self.port)), target)
    }

    pub fn request(&self, method: &str, host: Option<&str>, target: &str) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        self.queue.lock().unwrap().push_back(LoopbackRequest {
            id,
            method: method.into(),
            host: host.map(Into::into),
            target: target.into(),
        });
        self.wake.notify_one();
        id
    }

    /// The timeout passes.
    pub fn expire(&self) {
        self.expired.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }

    pub fn reply_to(&self, id: u64) -> Option<LoopbackPage> {
        self.replies
            .lock()
            .unwrap()
            .iter()
            .find(|(reply, _)| *reply == id)
            .map(|(_, page)| *page)
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }
}

#[async_trait::async_trait]
impl LoopbackListener for FakeListener {
    fn port(&self) -> u16 {
        self.port
    }

    async fn next(&self, timeout_ms: u64) -> Option<LoopbackRequest> {
        self.timeouts_asked.lock().unwrap().push(timeout_ms);
        loop {
            if self.closed.load(Ordering::SeqCst) || self.expired.load(Ordering::SeqCst) {
                return None;
            }
            if let Some(request) = self.queue.lock().unwrap().pop_front() {
                return Some(request);
            }
            self.wake.notified().await;
        }
    }

    fn reply(&self, id: u64, page: LoopbackPage) {
        self.replies.lock().unwrap().push((id, page));
    }

    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }
}
