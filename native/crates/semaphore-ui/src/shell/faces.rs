//! Avatar faces: the file through the app's `AvatarImages` once it has the bytes, and initials on a
//! colour until then, or without one: the web's own fallback for a community, and for a user. Fixtures use `avatar:<key>:<label>` file ids, which the
//! web's sandbox turns into exactly such an SVG (`stories/fixtures/avatars.ts`), so stories match.

use crate::kit::Avatar;
use gpui_kit::{Hsla, SharedString, hsla, rgb};

const FIXTURE_PALETTE: [u32; 15] = [
    0x5865F2, 0x57F287, 0xFEE75C, 0xEB459E, 0xED4245, 0x3BA55D, 0x7289DA, 0xF47FFF, 0x00B0F4,
    0xFF7A00, 0x9B59B6, 0x1ABC9C, 0xE67E22, 0x2ECC71, 0xE91E63,
];

fn java_hash(input: &str) -> i32 {
    input.encode_utf16().fold(0i32, |hash, unit| {
        hash.wrapping_mul(31).wrapping_add(unit as i32)
    })
}

fn initials_of_both_ends(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.as_slice() {
        [] => "?".into(),
        [only] => only.chars().take(2).collect::<String>().to_uppercase(),
        [first, .., last] => first
            .chars()
            .take(1)
            .chain(last.chars().take(1))
            .collect::<String>()
            .to_uppercase(),
    }
}

/// `getCommunityInitials`.
fn community_initials(name: &str) -> String {
    name.split(' ')
        .take(2)
        .filter_map(|word| word.chars().next())
        .collect::<String>()
        .to_uppercase()
}

/// `stringToColor`: `hsl(hue, 65%, 45%)`.
fn string_to_color(id: &str) -> Hsla {
    let hue = java_hash(id).unsigned_abs() % 360;
    hsla(hue as f32 / 360., 0.65, 0.45, 1.)
}

fn fixture_face(file_id: Option<&str>) -> Option<(String, Hsla)> {
    let (key, label) = file_id?.strip_prefix("avatar:")?.split_once(':')?;
    // Only spaces are escaped in practice, and an odd label only changes the initials.
    let label = label.replace("%20", " ");
    let index = java_hash(key).unsigned_abs() as usize % FIXTURE_PALETTE.len();
    Some((
        initials_of_both_ends(&label),
        Hsla::from(rgb(FIXTURE_PALETTE[index])),
    ))
}

pub fn community_avatar(id: &str, name: &str, file_id: Option<&str>, size: f32) -> Avatar {
    let (label, color): (SharedString, Hsla) = match fixture_face(file_id) {
        Some((initials, color)) => (initials.into(), color),
        None => (community_initials(name).into(), string_to_color(id)),
    };
    Avatar::new(label)
        .size(size)
        .background(color)
        .file(file_id.filter(|id| !id.starts_with("avatar:")))
}

/// `UserAvatar` falls back to the first letter on MUI's grey.
pub fn user_avatar(name: &str, file_id: Option<&str>, size: f32) -> Avatar {
    match fixture_face(file_id) {
        Some((initials, color)) => Avatar::new(initials).size(size).background(color),
        None => {
            let initial = name
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_else(|| "?".into());
            Avatar::new(initial).size(size).file(file_id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initials_match_the_web() {
        assert_eq!(initials_of_both_ends("Liam Nilsson"), "LN");
        assert_eq!(initials_of_both_ends("Mike"), "MI");
        assert_eq!(community_initials("Nightowl Collective"), "NC");
        assert_eq!(community_initials("A B C"), "AB");
    }

    #[test]
    fn fixture_ids_give_the_sandbox_colour() {
        // colorFor("me") in avatars.ts is #5865F2, and the web story's Mike is that indigo.
        let (initials, color) = fixture_face(Some("avatar:me:Mike")).unwrap();
        assert_eq!(initials, "MI");
        assert_eq!(color, Hsla::from(rgb(0x5865F2)));
        assert!(fixture_face(Some("some-real-uuid")).is_none());
        assert!(fixture_face(None).is_none());
    }
}
