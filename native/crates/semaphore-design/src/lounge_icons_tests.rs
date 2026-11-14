use crate::lounge_icons::LoungeIcon;
use std::collections::HashSet;

/// The number of names in `design/icons/icons.json`; `ALL` must hold each once.
const COUNT: usize = 54;

/// The markup after any leading XML comment: every Lucide file starts with the
/// `@license` comment, which the generated asset keeps byte for byte.
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
    for icon in LoungeIcon::ALL {
        let svg = icon.svg();
        assert!(!svg.is_empty(), "{} has no asset", icon.name());
        let text = std::str::from_utf8(svg).expect("asset is UTF-8");
        assert!(
            markup(text).starts_with("<svg"),
            "{} does not start with an <svg> element",
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
