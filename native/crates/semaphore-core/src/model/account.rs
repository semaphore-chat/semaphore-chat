//! This account's sessions and appearance settings. Unit W3-core.

use super::LoadState;

/// One signed-in device, from `GET /auth/sessions`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionRow {
    pub id: String,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    pub created_at_ms: i64,
    pub last_used_at_ms: i64,
    pub expires_at_ms: i64,
    /// This client's own session. `Core::revoke_session` refuses it: that's signing out.
    pub is_current: bool,
    /// A revoke of it is on its way.
    pub busy: bool,
}

/// `Core::sessions`, most recently used first. `ViewKey::Sessions` says when to read again. The
/// server sends no event when the list changes, so it's read again when shown and older than
/// `commands::account::SESSIONS_STALE_MS`, after each revoke, and when a desktop app signs in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionsView {
    pub state: LoadState,
    pub sessions: Vec<SessionRow>,
    /// `Core::revoke_other_sessions` is on its way.
    pub revoking_others: bool,
}

/// What this user may do on the instance, from their instance roles (`GET /roles/my/instance`)
/// and whether they own it (an owner may do everything, as the server's `RbacGuard`).
/// `ViewKey::InstancePermissions` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstancePermissionsView {
    pub state: LoadState,
    /// `CREATE_COMMUNITY`: show "Create community". False until known.
    pub can_create_community: bool,
    /// W5: `CREATE_INSTANCE_INVITE`, half of what an invite needs (`CommunityCaps::create_invite`).
    pub can_create_invite: bool,
    /// W5: `DELETE_INSTANCE_INVITE`.
    pub can_delete_invite: bool,
    /// W6: what the admin area may show and do.
    pub admin: super::InstanceAdminCaps,
}

/// Dark or light, as the server stores it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum ThemeMode {
    #[default]
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum AccentColor {
    #[default]
    Teal,
    Blue,
    Indigo,
    Purple,
    Rose,
    Red,
    Orange,
    Amber,
    Lime,
    Emerald,
    Cyan,
    Slate,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum ThemeIntensity {
    #[default]
    Minimal,
    Balanced,
    Vibrant,
}

/// A colour as the appearance settings keep it: `#rrggbb`, as the contract's `baseColor`.
/// Core has no other colour type, and this one stays UI-free.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    /// `#rrggbb`, either case, as the contract's `baseColor` allows; `None` for anything else.
    pub fn parse(hex: &str) -> Option<Self> {
        fn digit(byte: u8) -> Option<u8> {
            match byte {
                b'0'..=b'9' => Some(byte - b'0'),
                b'a'..=b'f' => Some(byte - b'a' + 10),
                b'A'..=b'F' => Some(byte - b'A' + 10),
                _ => None,
            }
        }
        let [b'#', r1, r2, g1, g2, b1, b2] = hex.as_bytes() else {
            return None;
        };
        Some(Self {
            r: (digit(*r1)? << 4) | digit(*r2)?,
            g: (digit(*g1)? << 4) | digit(*g2)?,
            b: (digit(*b1)? << 4) | digit(*b2)?,
        })
    }

    /// The lowercase `#rrggbb` the server stores.
    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

impl AccentColor {
    /// The accent's primary colour: `ACCENT_PRIMARY` in `shared/src/theme/accents.ts`, the table
    /// the web client and the backend derive a base colour from.
    pub fn primary(self) -> Rgb {
        match self {
            AccentColor::Teal => Rgb {
                r: 0x0d,
                g: 0x94,
                b: 0x88,
            },
            AccentColor::Blue => Rgb {
                r: 0x3b,
                g: 0x82,
                b: 0xf6,
            },
            AccentColor::Indigo => Rgb {
                r: 0x63,
                g: 0x66,
                b: 0xf1,
            },
            AccentColor::Purple => Rgb {
                r: 0x8b,
                g: 0x5c,
                b: 0xf6,
            },
            AccentColor::Rose => Rgb {
                r: 0xf4,
                g: 0x3f,
                b: 0x5e,
            },
            AccentColor::Red => Rgb {
                r: 0xef,
                g: 0x44,
                b: 0x44,
            },
            AccentColor::Orange => Rgb {
                r: 0xf9,
                g: 0x73,
                b: 0x16,
            },
            AccentColor::Amber => Rgb {
                r: 0xf5,
                g: 0x9e,
                b: 0x0b,
            },
            AccentColor::Lime => Rgb {
                r: 0x84,
                g: 0xcc,
                b: 0x16,
            },
            AccentColor::Emerald => Rgb {
                r: 0x10,
                g: 0xb9,
                b: 0x81,
            },
            AccentColor::Cyan => Rgb {
                r: 0x06,
                g: 0xb6,
                b: 0xd4,
            },
            AccentColor::Slate => Rgb {
                r: 0x64,
                g: 0x74,
                b: 0x8b,
            },
        }
    }
}

/// The theme, synced through the server (`appearance-settings`), as the web's `useThemeSync`.
/// The defaults are the server's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Appearance {
    pub mode: ThemeMode,
    pub accent: AccentColor,
    pub intensity: ThemeIntensity,
    /// The colour the theme is derived from (`baseColor`). The accent's primary when the server
    /// sent none or an unreadable one, as the web's `useThemeSync` falls back.
    pub base: Rgb,
    /// `matchSystem`: follow the operating system's light/dark setting.
    pub match_system: bool,
    /// `newDesign`: the new design, stored here for the UI that will use it.
    pub new_design: bool,
}

impl Default for Appearance {
    fn default() -> Self {
        let accent = AccentColor::default();
        Self {
            mode: ThemeMode::default(),
            accent,
            intensity: ThemeIntensity::default(),
            base: accent.primary(),
            match_system: false,
            new_design: false,
        }
    }
}

/// What `Core::update_appearance` changes: each `None` is left as it is.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AppearancePatch {
    pub mode: Option<ThemeMode>,
    pub accent: Option<AccentColor>,
    pub intensity: Option<ThemeIntensity>,
    /// Sent as `baseColor`, and never together with `accent`: the server derives the accent.
    pub base: Option<Rgb>,
    pub match_system: Option<bool>,
}

/// `Core::appearance`: read at sign-in, so the theme can apply before anything opens settings.
/// `ViewKey::Appearance` says when to read again. Shows a change at once, while it's on its way.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppearanceView {
    pub state: LoadState,
    pub appearance: Appearance,
}
