//! The About dialog's model: what it shows, where its links go, Copy version, and Escape.

use super::{AboutDialog, AboutEvent, DOCS_URL, PROJECT_URL, platform_line};
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use std::path::PathBuf;

const VERSION: &str = "1.2.3";
const LICENCES: &str = "/usr/share/doc/semaphore-chat-native/THIRD-PARTY-LICENCES.txt";

fn about(cx: &mut TestAppContext, licences: Option<&str>) -> Rig<AboutDialog, AboutEvent> {
    let licences = licences.map(PathBuf::from);
    rig(cx, 900., move |window, cx| {
        let mut dialog = AboutDialog::new(VERSION, window, cx);
        dialog.set_licences(licences, cx);
        dialog
    })
}

#[gpui_kit::test]
fn shows_the_name_the_version_and_the_platform(cx: &mut TestAppContext) {
    let rig = about(cx, Some(LICENCES));
    let platform = platform_line();
    rig.with(cx, |_, window, _| {
        assert!(window.try_find("about").is_some(), "the body is drawn");
        for label in [
            "Semaphore Chat",
            "Version 1.2.3",
            "Self-hosted voice and text chat.",
            platform.as_str(),
        ] {
            assert!(
                window.try_find_by_label(label).is_some(),
                "{label:?} is shown"
            );
        }
    });
    assert_eq!(
        rig.view
            .read_with(cx, |dialog, _| dialog.version().to_owned()),
        VERSION
    );
}

#[gpui_kit::test]
fn copy_version_puts_the_version_on_the_clipboard(cx: &mut TestAppContext) {
    let rig = about(cx, None);
    rig.click(cx, "about-copy-version");
    assert_eq!(
        cx.read_from_clipboard().and_then(|item| item.text()),
        Some(VERSION.to_owned())
    );
}

#[gpui_kit::test]
fn the_links_ask_the_owner_to_open_them(cx: &mut TestAppContext) {
    let rig = about(cx, Some(LICENCES));
    rig.click(cx, "about-site");
    rig.click(cx, "about-docs");
    rig.click(cx, "about-licences");
    assert_eq!(
        rig.events(),
        [
            AboutEvent::OpenUrl(PROJECT_URL.to_owned()),
            AboutEvent::OpenUrl(DOCS_URL.to_owned()),
            AboutEvent::OpenUrl(LICENCES.to_owned()),
        ]
    );
}

#[gpui_kit::test]
fn a_build_without_licences_offers_no_licence_link(cx: &mut TestAppContext) {
    let rig = about(cx, None);
    assert!(!rig.has(cx, "about-licences"));
}

#[gpui_kit::test]
fn escape_closes(cx: &mut TestAppContext) {
    let rig = about(cx, None);
    rig.with(cx, |_, window, _| window.activate_window());
    cx.simulate_keystrokes(rig.window, "escape");
    assert_eq!(rig.events(), [AboutEvent::Close]);
}

#[gpui_kit::test]
fn close_closes(cx: &mut TestAppContext) {
    let rig = about(cx, None);
    rig.click(cx, "about-close");
    assert_eq!(rig.events(), [AboutEvent::Close]);
}
