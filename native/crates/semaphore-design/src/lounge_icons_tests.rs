use crate::lounge_icons::LoungeIcon;
use std::collections::HashSet;

/// The number of names in `design/icons/icons.json`; `ALL` must hold each once.
const COUNT: usize = 62;

/// The markup after the leading XML comment: the generator writes the
/// `@license` comment first, then the canonical `<svg>` element.
fn markup(svg: &str) -> &str {
    let rest = svg.trim_start();
    match rest.strip_prefix("<!--") {
        Some(comment) => comment
            .split_once("-->")
            .expect("closed license comment")
            .1
            .trim_start(),
        None => rest,
    }
}

#[test]
fn all_holds_every_icon_once() {
    assert_eq!(LoungeIcon::ALL.len(), COUNT);
}

#[test]
fn every_name_is_unique() {
    let names: HashSet<&str> = LoungeIcon::ALL.iter().map(|icon| icon.name()).collect();
    assert_eq!(names.len(), COUNT);
}

#[test]
fn mic_points_at_its_asset() {
    assert_eq!(LoungeIcon::Mic.name(), "Mic");
    assert_eq!(LoungeIcon::Mic.asset_path(), "lucide/mic.svg");
}

#[test]
fn every_asset_is_an_svg_without_the_mask_colour() {
    const OPEN: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" \
                        viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#000\" stroke-width=\"2\" \
                        stroke-linecap=\"round\" stroke-linejoin=\"round\">";
    for icon in LoungeIcon::ALL {
        let svg = icon.svg();
        assert!(!svg.is_empty(), "{} has no asset", icon.name());
        let text = std::str::from_utf8(svg).expect("asset is UTF-8");
        assert!(
            text.starts_with("<!-- @license lucide-static v"),
            "{} does not start with the licence comment",
            icon.name()
        );
        assert!(
            markup(text).starts_with(OPEN),
            "{} does not start with the canonical <svg> element",
            icon.name()
        );
        assert!(
            text.ends_with("</svg>\n"),
            "{} does not end with the closing element and one newline",
            icon.name()
        );
        assert_eq!(
            text.matches("stroke=\"#000\"").count(),
            1,
            "{} does not draw in the mask colour exactly once",
            icon.name()
        );
        assert!(
            !text.contains("currentColor"),
            "{} still uses currentColor",
            icon.name()
        );
        assert!(
            icon.asset_path().starts_with("lucide/") && icon.asset_path().ends_with(".svg"),
            "{} has an unexpected asset path",
            icon.name()
        );
    }
}
