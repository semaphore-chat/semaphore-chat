//! Where the client is: routes, history, and `semaphore://` deep links.
//!
//! The route table mirrors `frontend/src/routes.tsx` so all of the web's paths have a place. The
//! slice builds the variants with a named shape; the rest parse to [`Route::Unbuilt`], which keeps
//! the path and its pattern, so a later unit promotes one variant at a time and links keep working.
//!
//! The deep-link parser is a port of `frontend/electron/deep-link-parser.ts`, and for the same reason
//! it is strict: once the scheme is registered, any program on the machine can hand us a string.

use semaphore_core::model::{AdminPage, Conversation};

/// Every path in `routes.tsx`, in its order. 32, counting the catch-all.
pub const WEB_PATHS: [&str; 32] = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/onboarding",
    "/join/:inviteCode",
    "/debug/pwa",
    "/desktop-login",
    "/",
    "/direct-messages",
    "/direct-messages/:dmGroupId",
    "/notifications",
    "/friends",
    "/settings",
    "/admin",
    "/admin/users",
    "/admin/communities",
    "/admin/invites",
    "/admin/roles",
    "/admin/storage",
    "/admin/settings",
    "/admin/debug",
    "/debug/notifications",
    "/profile",
    "/profile/edit",
    "/profile/:userId",
    "/community/create",
    "/community/:communityId",
    "/community/:communityId/edit",
    "/community/:communityId/channel/:channelId",
    "/community/:communityId/channel/:channelId/search",
    "*",
];

/// Reached without a session, as `PublicRoute` and the public routes in `routes.tsx` are.
const PUBLIC_PATTERNS: [&str; 7] = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/onboarding",
    "/join/:inviteCode",
    "/desktop-login",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Home,
    Login,
    Community {
        community_id: String,
    },
    Channel {
        community_id: String,
        channel_id: String,
    },
    DirectMessages,
    DirectMessage {
        dm_group_id: String,
    },
    Invite {
        invite_code: String,
    },
    /// The settings page, on a tab.
    Settings {
        tab: crate::settings::SettingsTab,
    },
    /// Someone's profile page.
    Profile {
        user_id: String,
    },
    /// This user's profile, being edited.
    ProfileEdit,
    /// W5: a community's settings, on a tab. The tab isn't in the path (the web keeps it in local
    /// state too), so `/community/:communityId/edit` opens the first tab.
    CommunitySettings {
        community_id: String,
        tab: crate::community_settings::CommunityTab,
    },
    /// U-freeze: the instance admin area, on a page (`/admin`, `/admin/users`, ...).
    /// `/admin/debug` stays `Unbuilt`: the owner chose not to build it natively.
    Admin {
        page: semaphore_core::model::AdminPage,
    },
    /// U-freeze: the notifications page (the centre panel is the shell's).
    Notifications,
    /// U-freeze: the friends page.
    Friends,
    /// `/reset-password?token=...`: the signed-out reset screen. `None` is a link with no token,
    /// which the screen shows as missing or invalid.
    ResetPassword {
        token: Option<String>,
    },
    /// U-freeze: this user's own profile (`/profile`).
    OwnProfile,
    /// U-freeze: the create-community screen (`/community/create`).
    CreateCommunity,
    /// U-freeze: a channel with its search panel open (`.../channel/:channelId/search`).
    ChannelSearch {
        community_id: String,
        channel_id: String,
    },
    /// A web path this slice has no screen for yet.
    Unbuilt {
        pattern: &'static str,
        path: String,
    },
    NotFound {
        path: String,
    },
}

fn segments(path: &str) -> Vec<&str> {
    path.split('/').filter(|part| !part.is_empty()).collect()
}

/// The pattern's parameters, if `path` matches it.
fn matches<'a>(pattern: &str, path: &[&'a str]) -> Option<Vec<&'a str>> {
    let parts = segments(pattern);
    if parts.len() != path.len() {
        return None;
    }
    let mut params = Vec::new();
    for (part, value) in parts.iter().zip(path) {
        if part.starts_with(':') {
            params.push(*value);
        } else if part != value {
            return None;
        }
    }
    Some(params)
}

impl Route {
    /// From an app path. Static patterns come before parametric ones in [`WEB_PATHS`], as React
    /// Router's ranking would have it, so `/community/create` is not a community called `create`.
    pub fn parse(path: &str) -> Route {
        let without_fragment = path.split('#').next().unwrap_or(path);
        let (path, query) = without_fragment
            .split_once('?')
            .unwrap_or((without_fragment, ""));
        let parts = segments(path);
        for pattern in WEB_PATHS.iter().copied().filter(|pattern| *pattern != "*") {
            let Some(params) = matches(pattern, &parts) else {
                continue;
            };
            let param = |index: usize| params[index].to_owned();
            return match pattern {
                "/" => Route::Home,
                "/login" => Route::Login,
                "/direct-messages" => Route::DirectMessages,
                "/direct-messages/:dmGroupId" => Route::DirectMessage {
                    dm_group_id: param(0),
                },
                "/join/:inviteCode" => Route::Invite {
                    invite_code: param(0),
                },
                "/settings" => Route::Settings {
                    tab: crate::settings::SettingsTab::default(),
                },
                "/profile/edit" => Route::ProfileEdit,
                "/profile/:userId" => Route::Profile { user_id: param(0) },
                "/community/:communityId" => Route::Community {
                    community_id: param(0),
                },
                "/community/:communityId/edit" => Route::CommunitySettings {
                    community_id: param(0),
                    tab: crate::community_settings::CommunityTab::default(),
                },
                "/community/:communityId/channel/:channelId" => Route::Channel {
                    community_id: param(0),
                    channel_id: param(1),
                },
                "/community/:communityId/channel/:channelId/search" => Route::ChannelSearch {
                    community_id: param(0),
                    channel_id: param(1),
                },
                "/notifications" => Route::Notifications,
                "/friends" => Route::Friends,
                "/profile" => Route::OwnProfile,
                "/reset-password" => Route::ResetPassword {
                    token: query_token(query),
                },
                "/community/create" => Route::CreateCommunity,
                "/admin" => admin(AdminPage::Dashboard),
                "/admin/users" => admin(AdminPage::Users),
                "/admin/communities" => admin(AdminPage::Communities),
                "/admin/invites" => admin(AdminPage::Invites),
                "/admin/roles" => admin(AdminPage::Roles),
                "/admin/storage" => admin(AdminPage::Storage),
                "/admin/settings" => admin(AdminPage::Settings),
                _ => Route::Unbuilt {
                    pattern,
                    path: path.to_owned(),
                },
            };
        }
        Route::NotFound {
            path: path.to_owned(),
        }
    }

    pub fn path(&self) -> String {
        match self {
            Route::Home => "/".into(),
            Route::Login => "/login".into(),
            Route::Community { community_id } => format!("/community/{community_id}"),
            Route::Channel {
                community_id,
                channel_id,
            } => format!("/community/{community_id}/channel/{channel_id}"),
            Route::DirectMessages => "/direct-messages".into(),
            Route::DirectMessage { dm_group_id } => format!("/direct-messages/{dm_group_id}"),
            Route::Invite { invite_code } => format!("/join/{invite_code}"),
            Route::Settings { .. } => "/settings".into(),
            Route::Profile { user_id } => format!("/profile/{user_id}"),
            Route::ProfileEdit => "/profile/edit".into(),
            Route::CommunitySettings { community_id, .. } => {
                format!("/community/{community_id}/edit")
            }
            Route::Admin { page } => admin_path(*page).into(),
            Route::Notifications => "/notifications".into(),
            Route::Friends => "/friends".into(),
            Route::OwnProfile => "/profile".into(),
            Route::ResetPassword { .. } => "/reset-password".into(),
            Route::CreateCommunity => "/community/create".into(),
            Route::ChannelSearch {
                community_id,
                channel_id,
            } => format!("/community/{community_id}/channel/{channel_id}/search"),
            Route::Unbuilt { path, .. } | Route::NotFound { path } => path.clone(),
        }
    }

    /// Whether reaching this route needs a session.
    pub fn requires_auth(&self) -> bool {
        match self {
            Route::Login | Route::Invite { .. } | Route::ResetPassword { .. } => false,
            Route::Unbuilt { pattern, .. } => !PUBLIC_PATTERNS.contains(pattern),
            _ => true,
        }
    }

    /// The community this route is inside, for the rail's selection.
    pub fn community_id(&self) -> Option<&str> {
        match self {
            Route::Community { community_id }
            | Route::Channel { community_id, .. }
            | Route::ChannelSearch { community_id, .. }
            | Route::CommunitySettings { community_id, .. } => Some(community_id),
            _ => None,
        }
    }

    pub fn channel_id(&self) -> Option<&str> {
        match self {
            Route::Channel { channel_id, .. } | Route::ChannelSearch { channel_id, .. } => {
                Some(channel_id)
            }
            _ => None,
        }
    }

    /// What core should have on screen for this route.
    pub fn conversation(&self) -> Option<Conversation> {
        match self {
            Route::Channel { channel_id, .. } | Route::ChannelSearch { channel_id, .. } => {
                Some(Conversation::Channel {
                    id: channel_id.clone(),
                })
            }
            Route::DirectMessage { dm_group_id } => Some(Conversation::DirectMessage {
                id: dm_group_id.clone(),
            }),
            _ => None,
        }
    }
}

fn admin(page: AdminPage) -> Route {
    Route::Admin { page }
}

/// The web path of an admin page.
pub fn admin_path(page: AdminPage) -> &'static str {
    match page {
        AdminPage::Dashboard => "/admin",
        AdminPage::Users => "/admin/users",
        AdminPage::Communities => "/admin/communities",
        AdminPage::Invites => "/admin/invites",
        AdminPage::Roles => "/admin/roles",
        AdminPage::Storage => "/admin/storage",
        AdminPage::Settings => "/admin/settings",
    }
}

/// `DeepLinkRoute` in `deep-link-parser.ts`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLink {
    Community {
        community_id: String,
    },
    Channel {
        community_id: String,
        channel_id: String,
    },
    DmInbox,
    Dm {
        dm_group_id: String,
    },
    Invite {
        invite_code: String,
    },
    /// `semaphore://reset-password?token=...`: the reset screen, signed out.
    ResetPassword {
        token: Option<String>,
    },
}

const MAX_URL_LENGTH: usize = 2048;
const MAX_SEGMENT_LENGTH: usize = 200;

/// What `URL#hostname` calls the authority's name, lowercased. This parser has no `URL` to lean on,
/// so a link with credentials or a port fails closed rather than being normalised.
fn deep_link_host(authority: &str) -> Option<String> {
    if authority.is_empty() || authority.contains(['@', ':', '[', ']', '%', '\\']) {
        return None;
    }
    Some(authority.to_ascii_lowercase())
}

fn percent_decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = segment.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= MAX_SEGMENT_LENGTH
        && !segment.contains(['/', '\\'])
        && segment != "."
        && segment != ".."
        && !segment
            .chars()
            .any(|c| (c as u32) <= 0x1f || c as u32 == 0x7f)
}

fn is_uuid(value: &str) -> bool {
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let parts: Vec<&str> = value.split('-').collect();
    parts.len() == GROUPS.len()
        && parts.iter().zip(GROUPS).all(|(part, length)| {
            part.len() == length && part.chars().all(|c| c.is_ascii_hexdigit())
        })
}

fn is_invite_code(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A typed route for an exact, well-formed link, and `None` for anything else. Drop `None` with a
/// log and do nothing further. Never panics.
pub fn parse_deep_link(raw: &str) -> Option<DeepLink> {
    if raw.is_empty() || raw.len() > MAX_URL_LENGTH {
        return None;
    }
    let (scheme, rest) = raw.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("semaphore") {
        return None;
    }
    let without_fragment = rest.split('#').next().unwrap_or(rest);
    let (rest, query) = without_fragment
        .split_once('?')
        .unwrap_or((without_fragment, ""));
    let (authority, path) = match rest.find('/') {
        Some(slash) => rest.split_at(slash),
        None => (rest, ""),
    };
    let host = deep_link_host(authority)?;
    let parts = path
        .split('/')
        .filter(|part| !part.is_empty())
        .map(percent_decode)
        .collect::<Option<Vec<String>>>()?;
    if !parts.iter().all(|part| is_safe_segment(part)) {
        return None;
    }
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    match (host.as_str(), parts.as_slice()) {
        ("community", [community]) if is_uuid(community) => Some(DeepLink::Community {
            community_id: (*community).to_owned(),
        }),
        ("community", [community, "channel", channel])
            if is_uuid(community) && is_uuid(channel) =>
        {
            Some(DeepLink::Channel {
                community_id: (*community).to_owned(),
                channel_id: (*channel).to_owned(),
            })
        }
        ("direct-messages", []) => Some(DeepLink::DmInbox),
        ("direct-messages", [group]) if is_uuid(group) => Some(DeepLink::Dm {
            dm_group_id: (*group).to_owned(),
        }),
        ("join", [code]) if is_invite_code(code) => Some(DeepLink::Invite {
            invite_code: (*code).to_owned(),
        }),
        ("reset-password", []) => Some(DeepLink::ResetPassword {
            token: query_token(query),
        }),
        _ => None,
    }
}

impl DeepLink {
    /// `mapDeepLinkRouteToPath`, typed.
    pub fn route(&self) -> Route {
        match self.clone() {
            DeepLink::Community { community_id } => Route::Community { community_id },
            DeepLink::Channel {
                community_id,
                channel_id,
            } => Route::Channel {
                community_id,
                channel_id,
            },
            DeepLink::DmInbox => Route::DirectMessages,
            DeepLink::Dm { dm_group_id } => Route::DirectMessage { dm_group_id },
            DeepLink::Invite { invite_code } => Route::Invite { invite_code },
            DeepLink::ResetPassword { token } => Route::ResetPassword { token },
        }
    }
}

/// `?token=` from a query string: percent-decoded, and only when it looks like a reset token (a
/// graphic, slash-free string of at most 128 characters). Anything else reads as no token, which
/// the screen reports as a missing or invalid link.
fn query_token(query: &str) -> Option<String> {
    let raw = query.split('&').find_map(|pair| {
        pair.strip_prefix("token=")
            .or_else(|| pair.strip_prefix("amp;token="))
    })?;
    let token = percent_decode(raw)?;
    let length = token.chars().count();
    (length > 0
        && length <= 128
        && !token.contains(['/', '\\'])
        && token.chars().all(|c| c.is_ascii_graphic()))
    .then_some(token)
}

/// The client's position. A plain value, so any UI can hold it: back and forward like a browser's,
/// and a deep link that needs a session waits here until there is one, as `useDeepLinks` does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NavModel {
    current: Route,
    back: Vec<Route>,
    forward: Vec<Route>,
    pending: Option<Route>,
    signed_in: bool,
}

impl NavModel {
    pub fn new(start: Route, signed_in: bool) -> Self {
        Self {
            current: start,
            back: Vec::new(),
            forward: Vec::new(),
            pending: None,
            signed_in,
        }
    }

    pub fn current(&self) -> &Route {
        &self.current
    }

    pub fn pending(&self) -> Option<&Route> {
        self.pending.as_ref()
    }

    pub fn can_go_back(&self) -> bool {
        !self.back.is_empty()
    }

    /// Goes to `route`. Going to where we are adds no history.
    pub fn navigate(&mut self, route: Route) {
        if route == self.current {
            return;
        }
        let previous = std::mem::replace(&mut self.current, route);
        self.back.push(previous);
        self.forward.clear();
    }

    /// Goes to `route` in place: `<Navigate replace>`, as opening a community does on its way to a
    /// channel, so back doesn't land on the redirect.
    pub fn replace(&mut self, route: Route) {
        self.current = route;
    }

    pub fn go_back(&mut self) -> bool {
        let Some(route) = self.back.pop() else {
            return false;
        };
        self.forward
            .push(std::mem::replace(&mut self.current, route));
        true
    }

    pub fn go_forward(&mut self) -> bool {
        let Some(route) = self.forward.pop() else {
            return false;
        };
        self.back.push(std::mem::replace(&mut self.current, route));
        true
    }

    /// Handles a deep link: goes now, stashes it until sign-in, or returns false for a bad link.
    pub fn open_deep_link(&mut self, raw: &str) -> bool {
        let Some(link) = parse_deep_link(raw) else {
            return false;
        };
        let route = link.route();
        if self.signed_in || !route.requires_auth() {
            self.navigate(route);
        } else {
            self.pending = Some(route);
        }
        true
    }

    /// Tells the model about sign-in. Goes to a stashed link, or home from the login screen.
    pub fn set_signed_in(&mut self, signed_in: bool) {
        self.signed_in = signed_in;
        if !signed_in {
            self.back.clear();
            self.forward.clear();
            self.current = Route::Login;
            return;
        }
        if let Some(route) = self.pending.take() {
            self.navigate(route);
        } else if self.current == Route::Login {
            self.current = Route::Home;
        }
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "11111111-2222-4333-8444-555555555555";
    const UUID2: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    #[test]
    fn every_web_path_has_a_place() {
        for pattern in WEB_PATHS.iter().filter(|pattern| **pattern != "*") {
            let path = pattern
                .split('/')
                .map(|part| if part.starts_with(':') { "x-1" } else { part })
                .collect::<Vec<_>>()
                .join("/");
            let route = Route::parse(&path);
            assert!(
                !matches!(route, Route::NotFound { .. }),
                "{pattern} is {route:?}"
            );
            assert_eq!(Route::parse(&route.path()), route, "{pattern}");
        }
        assert_eq!(WEB_PATHS.len(), 32);
    }

    #[test]
    fn slice_routes_parse_to_their_shapes() {
        assert_eq!(Route::parse("/"), Route::Home);
        assert_eq!(
            Route::parse("/community/c1/channel/ch1"),
            Route::Channel {
                community_id: "c1".into(),
                channel_id: "ch1".into()
            }
        );
        assert_eq!(
            Route::parse("/direct-messages/d1?x=1"),
            Route::DirectMessage {
                dm_group_id: "d1".into()
            }
        );
        assert_eq!(Route::parse("/community/create"), Route::CreateCommunity);
        assert!(matches!(
            Route::parse("/admin/debug"),
            Route::Unbuilt {
                pattern: "/admin/debug",
                ..
            }
        ));
        assert!(matches!(
            Route::parse("/nope/at/all"),
            Route::NotFound { .. }
        ));
        // The reset path carries its token from the query string.
        assert_eq!(
            Route::parse("/reset-password?token=w3-reset-token"),
            Route::ResetPassword {
                token: Some("w3-reset-token".into())
            }
        );
        assert_eq!(
            Route::parse("/reset-password"),
            Route::ResetPassword { token: None }
        );
        assert_eq!(
            Route::parse("/reset-password?token=a%20b"),
            Route::ResetPassword { token: None },
            "spaces are not a token"
        );
    }

    #[test]
    fn the_freeze_routes_parse_and_round_trip() {
        let cases = [
            (
                "/admin",
                Route::Admin {
                    page: AdminPage::Dashboard,
                },
            ),
            (
                "/admin/users",
                Route::Admin {
                    page: AdminPage::Users,
                },
            ),
            (
                "/admin/communities",
                Route::Admin {
                    page: AdminPage::Communities,
                },
            ),
            (
                "/admin/invites",
                Route::Admin {
                    page: AdminPage::Invites,
                },
            ),
            (
                "/admin/roles",
                Route::Admin {
                    page: AdminPage::Roles,
                },
            ),
            (
                "/admin/storage",
                Route::Admin {
                    page: AdminPage::Storage,
                },
            ),
            (
                "/admin/settings",
                Route::Admin {
                    page: AdminPage::Settings,
                },
            ),
            ("/notifications", Route::Notifications),
            ("/friends", Route::Friends),
            ("/profile", Route::OwnProfile),
            ("/community/create", Route::CreateCommunity),
            (
                "/community/c1/channel/ch1/search",
                Route::ChannelSearch {
                    community_id: "c1".into(),
                    channel_id: "ch1".into(),
                },
            ),
        ];
        for (path, route) in cases {
            assert_eq!(Route::parse(path), route, "{path}");
            assert_eq!(route.path(), path);
            assert!(route.requires_auth(), "{path} needs a session");
        }
        let search = Route::parse("/community/c1/channel/ch1/search");
        assert_eq!(search.community_id(), Some("c1"));
        assert_eq!(search.channel_id(), Some("ch1"));
        assert_eq!(
            search.conversation(),
            Some(Conversation::Channel { id: "ch1".into() })
        );
        assert_eq!(
            Route::Admin {
                page: AdminPage::Users
            }
            .community_id(),
            None
        );
        assert!(Route::parse("/profile/edit") == Route::ProfileEdit);
        assert!(matches!(Route::parse("/onboarding"), Route::Unbuilt { .. }));
    }

    #[test]
    fn community_settings_route_round_trips_without_its_tab() {
        use crate::community_settings::CommunityTab;
        let cases = [
            ("/community/c1/edit", CommunityTab::Overview),
            ("/community/c1/edit/", CommunityTab::Overview),
            ("/community/c1/edit?tab=roles", CommunityTab::Overview),
        ];
        for (path, tab) in cases {
            assert_eq!(
                Route::parse(path),
                Route::CommunitySettings {
                    community_id: "c1".into(),
                    tab
                },
                "{path}"
            );
        }
        for tab in CommunityTab::ALL {
            let route = Route::CommunitySettings {
                community_id: "c1".into(),
                tab,
            };
            assert_eq!(route.path(), "/community/c1/edit");
            assert_eq!(route.community_id(), Some("c1"));
            assert_eq!(route.channel_id(), None);
            assert_eq!(route.conversation(), None);
            assert!(route.requires_auth());
        }
        // `edit` is a segment of its own: a channel called `edit` is still a channel.
        assert!(matches!(
            Route::parse("/community/c1/channel/edit"),
            Route::Channel { .. }
        ));
        assert!(matches!(
            Route::parse("/community/edit"),
            Route::Community { .. }
        ));
    }

    #[test]
    fn auth_rules_match_the_web() {
        assert!(!Route::parse("/login").requires_auth());
        assert!(!Route::parse("/join/abc").requires_auth());
        assert!(!Route::parse("/register").requires_auth());
        assert!(!Route::parse("/reset-password?token=x").requires_auth());
        assert!(Route::parse("/settings").requires_auth());
        assert!(Route::parse("/direct-messages").requires_auth());
    }

    #[test]
    fn deep_links_map_as_the_web_does() {
        let path = |raw: &str| parse_deep_link(raw).map(|link| link.route().path());
        assert_eq!(
            path(&format!("semaphore://community/{UUID}")),
            Some(format!("/community/{UUID}"))
        );
        assert_eq!(
            path(&format!("semaphore://community/{UUID}/channel/{UUID2}")),
            Some(format!("/community/{UUID}/channel/{UUID2}"))
        );
        assert_eq!(
            path("semaphore://direct-messages"),
            Some("/direct-messages".into())
        );
        assert_eq!(
            path(&format!("semaphore://direct-messages/{UUID}")),
            Some(format!("/direct-messages/{UUID}"))
        );
        assert_eq!(path("semaphore://join/aB3_-x"), Some("/join/aB3_-x".into()));
        assert_eq!(
            path("semaphore://reset-password?token=w3-reset-token"),
            Some("/reset-password".into())
        );
        assert_eq!(
            parse_deep_link("semaphore://reset-password?token=w3-reset-token")
                .map(|link| link.route()),
            Some(Route::ResetPassword {
                token: Some("w3-reset-token".into())
            })
        );
        assert_eq!(
            parse_deep_link("semaphore://reset-password").map(|link| link.route()),
            Some(Route::ResetPassword { token: None })
        );
        assert_eq!(
            path(&format!("SEMAPHORE://COMMUNITY/{UUID}?utm=1#frag")),
            Some(format!("/community/{UUID}"))
        );
    }

    #[test]
    fn deep_links_fail_closed() {
        let long = format!("semaphore://join/{}", "a".repeat(3000));
        for bad in [
            "",
            "http://community/x",
            "semaphore:community",
            "semaphore://community/not-a-uuid",
            "semaphore://community/../../etc/passwd",
            "semaphore://community/%2e%2e",
            "semaphore://join/a%2fb",
            "semaphore://join/a%00b",
            "semaphore://join/%",
            "semaphore://join/%zz",
            "semaphore://join/%ff",
            "semaphore://join/has space",
            "semaphore://unknown-host/x",
            "semaphore://user@community/x",
            "semaphore://community:80/x",
            long.as_str(),
        ] {
            assert_eq!(parse_deep_link(bad), None, "{bad:?}");
        }
        assert_eq!(
            parse_deep_link(&format!("semaphore://community/{UUID}/channel")),
            None
        );
    }

    #[test]
    fn history_goes_back_and_forward() {
        let mut nav = NavModel::new(Route::Home, true);
        nav.navigate(Route::DirectMessages);
        nav.navigate(Route::DirectMessages);
        nav.navigate(Route::Community {
            community_id: "c".into(),
        });
        assert!(nav.go_back());
        assert_eq!(nav.current(), &Route::DirectMessages);
        assert!(nav.go_forward());
        nav.go_back();
        nav.go_back();
        assert_eq!(nav.current(), &Route::Home);
        assert!(!nav.go_back());
    }

    #[test]
    fn a_link_that_needs_a_session_waits_for_one() {
        let mut nav = NavModel::new(Route::Login, false);
        assert!(nav.open_deep_link("semaphore://direct-messages"));
        assert_eq!(nav.current(), &Route::Login);
        assert_eq!(nav.pending(), Some(&Route::DirectMessages));
        nav.set_signed_in(true);
        assert_eq!(nav.current(), &Route::DirectMessages);
        assert_eq!(nav.pending(), None);

        let mut nav = NavModel::new(Route::Login, false);
        assert!(nav.open_deep_link("semaphore://join/abc"));
        assert_eq!(
            nav.current(),
            &Route::Invite {
                invite_code: "abc".into()
            }
        );
        assert!(!nav.open_deep_link("semaphore://nope"));
    }

    mod properties {
        use super::*;
        use proptest::prelude::*;
        use proptest::test_runner::{Config, RngSeed};
        use std::prelude::rust_2024::test;

        fn config() -> Config {
            Config {
                cases: 512,
                rng_seed: RngSeed::Fixed(0xdee9_0001),
                ..Config::default()
            }
        }

        fn rest() -> impl Strategy<Value = String> {
            let piece = prop_oneof![
                Just("community".to_owned()),
                Just("channel".to_owned()),
                Just("direct-messages".to_owned()),
                Just("join".to_owned()),
                Just(UUID.to_owned()),
                Just("/".to_owned()),
                Just("%".to_owned()),
                Just("%2F".to_owned()),
                Just("%00".to_owned()),
                Just("%E2%82".to_owned()),
                Just("..".to_owned()),
                Just("?".to_owned()),
                Just("#".to_owned()),
                ".",
            ];
            prop::collection::vec(piece, 0..10).prop_map(|pieces| pieces.concat())
        }

        proptest! {
            #![proptest_config(config())]

            #[test]
            fn no_link_panics_the_parser(rest in rest(), any in ".{0,60}") {
                let _ = parse_deep_link(&format!("semaphore://{rest}"));
                let _ = parse_deep_link(&any);
            }

            #[test]
            fn a_parsed_link_names_only_well_formed_ids(rest in rest()) {
                if let Some(link) = parse_deep_link(&format!("semaphore://{rest}")) {
                    match link {
                        DeepLink::Community { community_id } => prop_assert!(is_uuid(&community_id)),
                        DeepLink::Channel { community_id, channel_id } => {
                            prop_assert!(is_uuid(&community_id) && is_uuid(&channel_id));
                        }
                        DeepLink::Dm { dm_group_id } => prop_assert!(is_uuid(&dm_group_id)),
                        DeepLink::Invite { invite_code } => prop_assert!(is_invite_code(&invite_code)),
                        DeepLink::ResetPassword { token } => {
                            let ok = token.is_none_or(|token| {
                                (1..=128).contains(&token.chars().count())
                                    && !token.contains(['/', '\\'])
                                    && token.chars().all(|c| c.is_ascii_graphic())
                            });
                            prop_assert!(ok);
                        }
                        DeepLink::DmInbox => {}
                    }
                }
            }
        }
    }
}
