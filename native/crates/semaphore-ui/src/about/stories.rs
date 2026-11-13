//! The About dialog's stories: with a package's licence file, at desktop and phone width.

use super::AboutDialog;
use crate::dms::stories::dialog_framed;
use crate::stories::Story;
use gpui_kit::*;
use std::path::PathBuf;

/// The version the fixture shows: the package version the docs' size table was measured at.
const VERSION: &str = "0.10.0";
/// Where a Linux package puts the third-party licences (`docs/packaging.md`).
const LICENCES: &str = "/usr/share/doc/semaphore-chat-native/THIRD-PARTY-LICENCES.txt";

fn about(window: &mut Window, cx: &mut App) -> AnyView {
    let dialog = cx.new(|cx| AboutDialog::new(VERSION, window, cx));
    dialog.update(cx, |dialog, cx| {
        dialog.set_licences(Some(PathBuf::from(LICENCES)), cx)
    });
    dialog_framed(dialog.into(), cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("about", |_, window, cx| about(window, cx)),
        Story::new("about-phone", |_, window, cx| about(window, cx)),
    ]
}
