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
    Teal,
    Blue,
    Indigo,
    /// The server's default (`accentColor` in the schema), the nearest accent to `#8e75ff`.
    #[default]
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
    /// The accents in the picker's order (`ACCENT_NAMES` in `shared/src/theme/accents.ts`), the
    /// order a tie in [`AccentColor::nearest_to`] goes to.
    pub const ALL: [AccentColor; 12] = [
        AccentColor::Teal,
        AccentColor::Blue,
        AccentColor::Indigo,
        AccentColor::Purple,
        AccentColor::Rose,
        AccentColor::Red,
        AccentColor::Orange,
        AccentColor::Amber,
        AccentColor::Lime,
        AccentColor::Emerald,
        AccentColor::Cyan,
        AccentColor::Slate,
    ];

    /// The accent's name, as `accentColor` carries it.
    pub fn name(self) -> &'static str {
        match self {
            AccentColor::Teal => "teal",
            AccentColor::Blue => "blue",
            AccentColor::Indigo => "indigo",
            AccentColor::Purple => "purple",
            AccentColor::Rose => "rose",
            AccentColor::Red => "red",
            AccentColor::Orange => "orange",
            AccentColor::Amber => "amber",
            AccentColor::Lime => "lime",
            AccentColor::Emerald => "emerald",
            AccentColor::Cyan => "cyan",
            AccentColor::Slate => "slate",
        }
    }

    /// The accent `name` stands for; `None` for anything else, as the server's `IsIn` refuses it.
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|accent| accent.name() == name)
    }

    /// The accent's primary colour: `ACCENT_PRIMARY` in `shared/src/theme/accents.ts`, the table
    /// the web client, the backend and the fake server derive a base colour from.
    pub fn primary(self) -> Rgb {
        let index = Self::ALL
            .iter()
            .position(|accent| *accent == self)
            .expect("ALL holds every accent");
        Rgb::parse(ACCENT_PRIMARY[index]).expect("the accent table is #rrggbb")
    }

    /// The accent whose primary is nearest `base` in OKLab, as the backend's `nearestAccent` picks
    /// it: `Slate` for a colour without a meaningful chroma, ties to [`AccentColor::ALL`]'s order.
    pub fn nearest_to(base: Rgb) -> Self {
        let [lightness, a, b] = oklab(base);
        if a.hypot(b) < LOW_CHROMA {
            return AccentColor::Slate;
        }
        let mut nearest = Self::ALL[0];
        let mut nearest_distance = f64::INFINITY;
        for accent in Self::ALL {
            let [primary_lightness, primary_a, primary_b] = oklab(accent.primary());
            let distance = (lightness - primary_lightness).powi(2)
                + (a - primary_a).powi(2)
                + (b - primary_b).powi(2);
            if distance < nearest_distance {
                nearest_distance = distance;
                nearest = accent;
            }
        }
        nearest
    }
}

/// Each accent's primary colour, lowercase `#rrggbb`, in [`AccentColor::ALL`]'s order:
/// `ACCENT_PRIMARY` in `shared/src/theme/accents.ts`.
const ACCENT_PRIMARY: [&str; 12] = [
    "#0d9488", "#3b82f6", "#6366f1", "#8b5cf6", "#f43f5e", "#ef4444", "#f97316", "#f59e0b",
    "#84cc16", "#10b981", "#06b6d4", "#64748b",
];

/// Chroma below which a base colour counts as a grey (`LOW_CHROMA` in `accents.ts`).
const LOW_CHROMA: f64 = 0.03;

/// 8-bit sRGB to OKLab `[L, a, b]`, `toOklab` in `shared/src/theme/accents.ts`.
fn oklab(Rgb { r, g, b }: Rgb) -> [f64; 3] {
    let linear = |channel: u8| {
        let c = f64::from(channel) / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let r = linear(r);
    let g = linear(g);
    let b = linear(b);
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
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
        Self {
            mode: ThemeMode::default(),
            accent: AccentColor::default(),
            intensity: ThemeIntensity::default(),
            base: DEFAULT_BASE,
            match_system: false,
            new_design: false,
        }
    }
}

/// The server's default `baseColor` (`#8e75ff`), the design system's default base.
pub const DEFAULT_BASE: Rgb = Rgb {
    r: 0x8e,
    g: 0x75,
    b: 0xff,
};

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

#[cfg(test)]
mod tests {
    use super::*;

    /// `shared/src/theme/accents.ts`, read as text: the web client, the backend and this client
    /// all derive a base colour from one table, so a change there has to reach this one.
    const ACCENTS_TS: &str = include_str!("../../../../../shared/src/theme/accents.ts");

    /// The `name: '#rrggbb'` pairs of `ACCENT_PRIMARY`, in the order the file lists them.
    fn accents_from_the_web() -> Vec<(&'static str, String)> {
        let block = ACCENTS_TS
            .split_once("export const ACCENT_PRIMARY")
            .expect("accents.ts declares ACCENT_PRIMARY")
            .1;
        let block = block
            .split_once('{')
            .expect("ACCENT_PRIMARY is an object literal")
            .1
            .split_once("};")
            .expect("the object literal is closed")
            .0;
        block
            .lines()
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                let hex = value.trim().trim_end_matches(',').strip_prefix('\'')?;
                Some((name.trim(), hex.strip_suffix('\'')?.to_owned()))
            })
            .collect()
    }

    /// The server's schema, read as text, for the defaults a new account gets.
    const SCHEMA: &str = include_str!("../../../../../backend/prisma/schema.prisma");

    /// `<field> String @default("<value>")` in `UserAppearanceSettings`.
    fn schema_default(field: &str) -> &'static str {
        let model = SCHEMA
            .split_once("model UserAppearanceSettings {")
            .expect("the schema declares UserAppearanceSettings")
            .1;
        let line = model
            .lines()
            .find(|line| line.split_whitespace().next() == Some(field))
            .unwrap_or_else(|| panic!("UserAppearanceSettings has no {field}"));
        line.split_once("@default(\"")
            .and_then(|(_, rest)| rest.split_once('"'))
            .unwrap_or_else(|| panic!("{field} has no string default"))
            .0
    }

    #[test]
    fn the_default_appearance_is_the_servers() {
        let appearance = Appearance::default();
        assert_eq!(appearance.base.to_hex(), schema_default("baseColor"));
        assert_eq!(appearance.base, DEFAULT_BASE);
        assert_eq!(appearance.accent.name(), schema_default("accentColor"));
        assert_eq!(AccentColor::nearest_to(DEFAULT_BASE), appearance.accent);
        assert_eq!(schema_default("themeMode"), "dark");
        assert_eq!(appearance.mode, ThemeMode::Dark);
        assert_eq!(schema_default("intensity"), "minimal");
        assert_eq!(appearance.intensity, ThemeIntensity::Minimal);
        assert!(!appearance.match_system);
    }

    #[test]
    fn the_accent_table_is_the_webs() {
        let web = accents_from_the_web();
        assert_eq!(web.len(), 12, "twelve accents in accents.ts: {web:?}");
        let here: Vec<(&str, String)> = AccentColor::ALL
            .iter()
            .map(|accent| (accent.name(), accent.primary().to_hex()))
            .collect();
        assert_eq!(here, web);
    }

    #[test]
    fn an_accent_is_named_and_parsed_as_the_contract_writes_it() {
        for accent in AccentColor::ALL {
            assert_eq!(AccentColor::parse(accent.name()), Some(accent));
        }
        // Unknown names and other cases are no accent at all: the server's `IsIn` refuses them.
        assert_eq!(AccentColor::parse("pink"), None);
        assert_eq!(AccentColor::parse("Teal"), None);
        assert_eq!(AccentColor::parse(""), None);
    }

    #[test]
    fn a_colour_is_a_hash_and_six_digits_in_either_case() {
        let teal = Rgb {
            r: 0x0d,
            g: 0x94,
            b: 0x88,
        };
        assert_eq!(Rgb::parse("#0d9488"), Some(teal));
        assert_eq!(Rgb::parse("#0D9488"), Some(teal));
        assert_eq!(Rgb::parse("#0d948"), None, "five digits");
        assert_eq!(Rgb::parse("#0d94880"), None, "seven digits");
        assert_eq!(Rgb::parse("0d9488"), None, "no hash");
        assert_eq!(Rgb::parse("#0d948g"), None, "not hex");
        assert_eq!(Rgb::parse("#0d948 "), None, "not hex, either case");
        assert_eq!(Rgb::parse(""), None);
        assert_eq!(Rgb::parse("#0d94é8"), None, "not even ASCII");
    }

    #[test]
    fn a_colour_writes_back_as_lowercase_hash_rrggbb() {
        assert_eq!(
            Rgb::parse("#ABCDEF").expect("six digits").to_hex(),
            "#abcdef"
        );
        assert_eq!(Rgb { r: 0, g: 1, b: 255 }.to_hex(), "#0001ff");
    }

    #[test]
    fn the_nearest_accent_is_the_backends_pick() {
        let nearest = |hex: &str| AccentColor::nearest_to(Rgb::parse(hex).expect("`#rrggbb`"));
        // The default base colour (the Lounge violet) and the one the backend tests name.
        assert_eq!(nearest("#8e75ff"), AccentColor::Purple);
        assert_eq!(nearest("#ff9a6b"), AccentColor::Amber);
        for accent in AccentColor::ALL {
            assert_eq!(
                AccentColor::nearest_to(accent.primary()),
                accent,
                "{} is nearest its own primary",
                accent.name()
            );
        }
        // A colour without a meaningful chroma has no hue: slate, whatever its lightness.
        for grey in ["#808080", "#000000", "#ffffff"] {
            assert_eq!(nearest(grey), AccentColor::Slate, "{grey}");
        }
    }
}
