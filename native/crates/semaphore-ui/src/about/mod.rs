//! The About dialog: Electron's Help > "About Semaphore Chat" (`dialog.showMessageBox`), with
//! what a native app can usefully say instead of a webview's version panel: the app's name and
//! version, the platform and renderer, where the project and its docs are, the licences the
//! package ships (see `native/docs/packaging.md`), and "Copy version".
//!
//! Built from kit pieces only. Escape and a press on the backdrop close it, as every [`Dialog`];
//! a link emits [`AboutEvent::OpenUrl`] and the app opens it through its `open_url` seam, so no
//! test or story ever opens anything.
//!
//! The copy button uses GPUI's own clipboard, the seam every other copy in the app uses.

#[cfg(feature = "stories")]
pub mod stories;
#[cfg(test)]
mod tests;

use crate::kit::{Button, Dialog, Variant, spacing, text};
use crate::theme::SemTheme as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use std::path::PathBuf;

/// The project's home page, as `frontend/package.json`'s repository gives it.
pub const PROJECT_URL: &str = "https://github.com/semaphore-chat/semaphore-chat";
/// The documentation site, as the README links it.
pub const DOCS_URL: &str = "https://docs.semaphorechat.app";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AboutEvent {
    /// Escape, the backdrop, or Close: the owner takes the dialog out of its tree.
    Close,
    /// "Project site", "Documentation" or "Open licences": the owner opens it (its `open_url`
    /// seam; a path for the licence file).
    OpenUrl(String),
}

/// The dialog's state: the version it shows, and where the package's licences are, if it shipped
/// them.
pub struct AboutDialog {
    version: SharedString,
    licences: Option<SharedString>,
    /// Escape is the dialog's only while the focus is inside it, so it takes the focus on its
    /// first draw, as the shortcut sheet does.
    focus: FocusHandle,
    took_focus: bool,
}

impl EventEmitter<AboutEvent> for AboutDialog {}

impl AboutDialog {
    pub fn new(
        version: impl Into<SharedString>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            version: version.into(),
            licences: None,
            focus: cx.focus_handle(),
            took_focus: false,
        }
    }

    /// The version the dialog shows, as the app reports it.
    pub fn version(&self) -> &str {
        &self.version
    }

    /// The third-party licence file this build installed: the package's
    /// `THIRD-PARTY-LICENCES.txt` (`docs/packaging.md`), or one beside the executable. `None` in
    /// a development run, where no package put one there: the link is then not offered.
    pub fn set_licences(&mut self, path: Option<PathBuf>, cx: &mut Context<Self>) {
        self.licences = path.map(|path| path.to_string_lossy().into_owned().into());
        cx.notify();
    }

    fn close(&mut self, cx: &mut Context<Self>) {
        cx.emit(AboutEvent::Close);
    }
}

/// "Linux (x86_64) · GPUI": the platform the build runs on, and what draws it. Cheap: two
/// compile-time constants and the renderer's name; no runtime query.
pub fn platform_line() -> String {
    let os = match std::env::consts::OS {
        "linux" => "Linux",
        "windows" => "Windows",
        "macos" => "macOS",
        other => other,
    };
    format!("{os} ({}) · GPUI", std::env::consts::ARCH)
}

impl Render for AboutDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus {
            self.took_focus = true;
            window.focus(&self.focus, cx);
        }
        let sem = cx.sem().clone();
        let width = if crate::panel::common::is_phone(window) {
            f32::from(window.viewport_size().width)
        } else {
            444.
        };
        let version = self.version.clone();
        let clipboard_version = version.clone();
        let view = cx.entity().downgrade();
        let site = {
            let view = view.clone();
            crate::kit::link("about-site", "Project site", cx, move |_, cx| {
                view.update(cx, |_, cx| {
                    cx.emit(AboutEvent::OpenUrl(PROJECT_URL.to_owned()))
                })
                .ok();
            })
        };
        let docs = {
            let view = view.clone();
            crate::kit::link("about-docs", "Documentation", cx, move |_, cx| {
                view.update(cx, |_, cx| {
                    cx.emit(AboutEvent::OpenUrl(DOCS_URL.to_owned()))
                })
                .ok();
            })
        };
        let licences = self.licences.clone().map(|path| {
            let view = view.clone();
            crate::kit::link("about-licences", "Open licences", cx, move |_, cx| {
                view.update(cx, |_, cx| cx.emit(AboutEvent::OpenUrl(path.to_string())))
                    .ok();
            })
        });
        let close = cx.entity().downgrade();
        let backdrop = cx.entity().downgrade();
        Dialog::new("About Semaphore Chat")
            .width(width)
            .body(
                div()
                    .id("about")
                    .test_support()
                    .relative()
                    .flex()
                    .flex_col()
                    .gap(spacing(0.75))
                    .child(div().absolute().size_0().track_focus(&self.focus))
                    .child(
                        text(Variant::H5, "Semaphore Chat")
                            .id("about-name")
                            .test_support()
                            .aria_label("Semaphore Chat"),
                    )
                    .child(
                        text(Variant::Body2, format!("Version {version}"))
                            .id("about-version")
                            .test_support()
                            .aria_label(format!("Version {version}")),
                    )
                    .child(
                        text(Variant::Body2, "Self-hosted voice and text chat.")
                            .id("about-tagline")
                            .test_support()
                            .aria_label("Self-hosted voice and text chat."),
                    )
                    .child({
                        let platform = platform_line();
                        text(Variant::Caption, platform.clone())
                            .id("about-platform")
                            .test_support()
                            .aria_label(platform)
                            .text_color(sem.text_secondary)
                    })
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(spacing(2.))
                            .child(site)
                            .child(docs)
                            .children(licences),
                    ),
            )
            .action(
                Button::new("about-copy-version", "Copy version").on_click(move |_, _, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(clipboard_version.to_string()));
                }),
            )
            .action(
                Button::new("about-close", "Close")
                    .contained()
                    .on_click(move |_, _, cx| {
                        close.update(cx, |dialog, cx| dialog.close(cx)).ok();
                    }),
            )
            .on_close(move |_, cx| {
                backdrop.update(cx, |dialog, cx| dialog.close(cx)).ok();
            })
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
