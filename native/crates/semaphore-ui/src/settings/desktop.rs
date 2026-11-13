//! The desktop app tab: close to tray, who opens `semaphore://` links, link preview images, the
//! server (the web's "Backend Configuration") and the versions ("App Information"). No start-up
//! options.

use super::shell::{info_row, section, switch_row, tab_page};
use super::{DesktopAppEvent, DesktopAppSettings, LinkHandler};
use crate::kit::{Button, ButtonSize, Severity, Switch, Variant, spacing, text};
use crate::panel::common::design_icon;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as DesignIcon;

/// The line under the links switch: what the owner means for this app, when there is more to say
/// than who it is.
pub(crate) fn link_note(links: LinkHandler, open_links: bool) -> Option<&'static str> {
    match links {
        LinkHandler::Registered => None,
        LinkHandler::PackageOwned => {
            Some("Your installed package opens semaphore:// links with Semaphore.")
        }
        LinkHandler::AnotherApp if open_links => {
            Some("Another app owns semaphore:// links now; turning this on takes them back.")
        }
        LinkHandler::AnotherApp => Some("Another app opens semaphore:// links on this computer."),
        LinkHandler::NotRegistered => Some("No app opens semaphore:// links on this computer yet."),
        LinkHandler::ManagedElsewhere => Some(
            "Your mimeapps.list is managed by another tool (it's a symlink), so Semaphore can't change which app opens semaphore:// links.",
        ),
        LinkHandler::Unknown => {
            Some("Couldn't tell which app opens semaphore:// links on this computer.")
        }
    }
}

impl Render for DesktopAppSettings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let state = self.state.clone();
        let view = cx.weak_entity();
        let tray_view = view.clone();
        let tray = section("Window", cx).child(switch_row(
            Switch::new("desktop-close-to-tray", "Close to tray", state.close_to_tray).on_change(
                move |on, _, cx| {
                    tray_view
                        .update(cx, |_, cx| cx.emit(DesktopAppEvent::SetCloseToTray(on)))
                        .ok();
                },
            ),
            "Close to tray",
            Some("Closing the window keeps Semaphore running in the tray, so calls and notifications carry on".into()),
            cx,
        ));
        let blocked = state.links_blocked.clone();
        let open_links_view = view.clone();
        let links = section("Links", cx)
            .child(switch_row(
                Switch::new(
                    "desktop-open-links",
                    "Open semaphore:// links with this app",
                    state.open_links,
                )
                .disabled(blocked.is_some())
                .on_change(move |on, _, cx| {
                    open_links_view
                        .update(cx, |_, cx| cx.emit(DesktopAppEvent::SetOpenLinks(on)))
                        .ok();
                }),
                "Open semaphore:// links with this app",
                Some(
                    "Register Semaphore for semaphore:// links (invites, shared messages) and open \
                     them here. Turning it off takes the registration away when this app made it."
                        .into(),
                ),
                cx,
            ))
            // Who opens the scheme now, from the app's own status check.
            .child(
                div()
                    .id("desktop-link-owner")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(SharedString::from(format!(
                        "Opens semaphore:// links: {}",
                        state.links.owner()
                    )))
                    .child(info_row(
                        "Opens semaphore:// links:",
                        state.links.owner(),
                        cx,
                    )),
            )
            .children(
                link_note(state.links, state.open_links).map(|note| {
                    div()
                        .id("desktop-link-status")
                        .test_support()
                        .role(Role::Status)
                        .aria_label(SharedString::from(note))
                        .child(text(Variant::Caption, note).text_color(sem.text_secondary))
                }),
            )
            .children(blocked.clone().or(state.links_note.clone()).map(|note| {
                div()
                    .id("desktop-links-note")
                    .test_support()
                    .role(Role::Note)
                    .aria_label(SharedString::from(note.clone()))
                    .child(text(Variant::Caption, note).text_color(sem.text_secondary))
            }));
        let previews_view = view.clone();
        let previews = section("Link previews", cx).child(switch_row(
            Switch::new(
                "desktop-link-preview-images",
                "Load images from other sites (link previews, GIFs)",
                state.link_preview_images,
            )
            .on_change(move |on, _, cx| {
                previews_view
                    .update(cx, |_, cx| cx.emit(DesktopAppEvent::SetLinkPreviewImages(on)))
                    .ok();
            }),
            "Load images from other sites (link previews, GIFs)",
            Some("Show link-preview pictures and GIFs. They load from third-party sites, which can see your IP address.".into()),
            cx,
        ));
        let server_name = state.server_name.clone();
        let server = section("Server", cx)
            .children(server_name.map(|name| info_row("Instance:", name, cx)))
            .child(
                div()
                    .id("desktop-server-url")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(SharedString::from(format!(
                        "Server address: {}",
                        state.server_url
                    )))
                    .child(
                        text(Variant::Body1, state.server_url.clone())
                            .font_family("monospace")
                            .text_color(sem.text_primary),
                    ),
            )
            .child(
                div().flex().child(
                    Button::new("desktop-change-server", "Change server")
                        .contained()
                        .on_click(
                            cx.listener(|_, _, _, cx| cx.emit(DesktopAppEvent::ChangeServer)),
                        ),
                ),
            );
        let (severity, summary) = state.update.summary();
        let (icon, tone) = match severity {
            Severity::Error => (DesignIcon::ErrorOutline, sem.error),
            Severity::Warning => (DesignIcon::WarningAmber, sem.warning),
            Severity::Info => (DesignIcon::InfoOutlined, sem.info),
            Severity::Success => (DesignIcon::CheckCircleOutline, sem.success),
        };
        let updates = section("Updates", cx)
            .child(
                div()
                    .id("desktop-update-status")
                    .test_support()
                    .role(Role::Status)
                    .aria_label(SharedString::from(summary.clone()))
                    .flex()
                    .items_start()
                    .gap(spacing(1.))
                    .child(div().pt(px(2.)).child(design_icon(icon, 18., tone)))
                    .child(
                        text(Variant::Body2, summary)
                            .flex_1()
                            .min_w_0()
                            .text_color(sem.text_primary),
                    ),
            )
            .child(
                div().flex().child(
                    Button::new("desktop-check-updates", "Check for updates")
                        .outlined()
                        .size(ButtonSize::Small)
                        .start_icon(DesignIcon::Refresh)
                        .disabled(!state.update_enabled || state.update.busy())
                        .on_click(
                            cx.listener(|_, _, _, cx| cx.emit(DesktopAppEvent::CheckForUpdates)),
                        ),
                ),
            )
            .children(state.update_note.clone().map(|note| {
                div()
                    .id("desktop-update-note")
                    .test_support()
                    .role(Role::Note)
                    .aria_label(SharedString::from(note.clone()))
                    .child(text(Variant::Caption, note).text_color(sem.text_secondary))
            }));
        let logs = state.log_folder;
        let about = section("About", cx)
            .child(info_row("App Version:", state.app_version.clone(), cx))
            .child(info_row(
                "Server Version:",
                state
                    .server_version
                    .clone()
                    .unwrap_or_else(|| "Unknown".into()),
                cx,
            ))
            .children(logs.then(|| {
                div()
                    .flex()
                    .items_center()
                    .gap(spacing(1.5))
                    .child(
                        Button::new("desktop-open-logs", "Open log folder")
                            .outlined()
                            .size(ButtonSize::Small)
                            .on_click(
                                cx.listener(|_, _, _, cx| cx.emit(DesktopAppEvent::OpenLogFolder)),
                            ),
                    )
                    .child(
                        text(
                            Variant::Caption,
                            "Logs and crash reports live in the app's data folder.",
                        )
                        .text_color(sem.text_secondary),
                    )
            }));
        tab_page(
            "desktop-settings",
            DesignIcon::DesktopWindows,
            "Desktop App",
            Vec::new(),
            div()
                .flex()
                .flex_col()
                .gap(spacing(3.))
                .child(tray)
                .child(links)
                .child(previews)
                .child(updates)
                .child(server)
                .child(about),
            cx,
        )
    }
}
