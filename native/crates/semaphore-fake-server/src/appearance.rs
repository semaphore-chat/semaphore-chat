//! The colour rules of `appearance-settings`: a port of `ACCENT_PRIMARY` and `nearestAccent` in
//! `shared/src/theme/accents.ts`, which the backend's
//! `backend/src/appearance-settings/appearance-settings.service.ts` uses to keep `accentColor` in
//! step with `baseColor`. The fake can't call shared TypeScript, and may depend on `semaphore-wire`
//! only, so the table and the OKLab distance are repeated here.

/// The accent names, in the picker's order (`ACCENT_NAMES`); a tie goes to the earlier one.
pub(crate) const ACCENT_NAMES: [&str; 12] = [
    "teal", "blue", "indigo", "purple", "rose", "red", "orange", "amber", "lime", "emerald",
    "cyan", "slate",
];

/// Each accent's primary colour, lowercase `#rrggbb`, in `ACCENT_NAMES`' order.
const ACCENT_PRIMARY: [&str; 12] = [
    "#0d9488", "#3b82f6", "#6366f1", "#8b5cf6", "#f43f5e", "#ef4444", "#f97316", "#f59e0b",
    "#84cc16", "#10b981", "#06b6d4", "#64748b",
];

/// Chroma below which a base colour counts as a grey (`LOW_CHROMA`).
const LOW_CHROMA: f64 = 0.03;

/// The primary colour of a named accent, as the backend derives `baseColor` from one.
pub(crate) fn primary(accent: &str) -> Option<&'static str> {
    ACCENT_NAMES
        .iter()
        .position(|name| *name == accent)
        .map(|index| ACCENT_PRIMARY[index])
}

/// The accent whose primary is nearest `base` in OKLab, as `nearestAccent` picks it: `slate` for a
/// colour without a meaningful chroma, `None` when `base` isn't `#rrggbb`.
pub(crate) fn nearest_accent(base: &str) -> Option<&'static str> {
    let [lightness, a, b] = oklab(parse_hex(base)?);
    if a.hypot(b) < LOW_CHROMA {
        return Some("slate");
    }
    let mut nearest = ACCENT_NAMES[0];
    let mut nearest_distance = f64::INFINITY;
    for (name, primary) in ACCENT_NAMES.iter().zip(ACCENT_PRIMARY) {
        let [primary_lightness, primary_a, primary_b] = oklab(parse_hex(primary)?);
        let distance = (lightness - primary_lightness).powi(2)
            + (a - primary_a).powi(2)
            + (b - primary_b).powi(2);
        if distance < nearest_distance {
            nearest_distance = distance;
            nearest = name;
        }
    }
    Some(nearest)
}

/// `#rrggbb` to 8-bit sRGB channels; `None` for anything else.
fn parse_hex(hex: &str) -> Option<[u8; 3]> {
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
    Some([
        (digit(*r1)? << 4) | digit(*r2)?,
        (digit(*g1)? << 4) | digit(*g2)?,
        (digit(*b1)? << 4) | digit(*b2)?,
    ])
}

/// 8-bit sRGB to OKLab `[L, a, b]`, `toOklab` in `shared/src/theme/accents.ts`.
fn oklab([r, g, b]: [u8; 3]) -> [f64; 3] {
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
