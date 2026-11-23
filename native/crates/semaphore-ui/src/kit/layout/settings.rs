//! SettingsLayout: sections on the left, the section on the right
//! (`frontend/src/kit/layout/SettingsLayout.tsx`, `design/guide/layouts.md`, "Settings with side
//! navigation").

use super::focus::follow_focus;
use super::frame::place_toasts;
use super::kept::{pane, shown_or_kept};
use super::width::WidthRange;
use crate::kit::overlays::type_text;
use crate::kit::{Action, IconButton, IconButtonVariant, Island, Padding};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as I;
use semaphore_design::lounge::{
    BORDER_HAIRLINE, CONTROL_MD, LAYOUT_GUTTER, LAYOUT_LEFT_COLUMN, SPACE_LG, SPACE_MD, SPACE_SM,
    SPACE_XL, SPACE_XS, TEXT_TITLE,
};
use std::rc::Rc;

/// Which pane a phone shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SettingsPane {
    #[default]
    Nav,
    Content,
}

const NAV: usize = 0;
const CONTENT: usize = 1;

/// The settings screen: sections on the left, the section on the right.
///
/// - Wide and compact: a nav island (`layout.leftColumn` wide, a navigation landmark headed by
///   `title`) beside the content island (the main). [`SettingsLayout::footer`] is pinned to the
///   bottom of the content island.
/// - Phone: one pane ([`SettingsLayout::phone_pane`]). The content pane has a header with Back,
///   which calls `on_back`. The other pane is kept but not drawn, so a half-edited form survives.
///   While the nav pane is shown it is the main, so the page still has exactly one.
///
/// When the pane that holds focus stops being shown, focus moves to the pane now shown. Toasts
/// sit at the foot of the content's body, above the footer. Render inside an
/// [`super::AppFrame`].
#[derive(IntoElement)]
pub struct SettingsLayout {
    title: SharedString,
    nav: AnyElement,
    nav_label: SharedString,
    content: AnyElement,
    on_back: Action,
    phone_pane: SettingsPane,
    footer: Option<AnyElement>,
}

impl SettingsLayout {
    /// `title` heads the nav island (and the phone's content header) and names the main;
    /// `nav_label` names the navigation landmark; `on_back` is the phone's Back (required: a
    /// phone has no other way back to the list).
    pub fn new(
        title: impl Into<SharedString>,
        nav: impl IntoElement,
        nav_label: impl Into<SharedString>,
        content: impl IntoElement,
        on_back: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            title: title.into(),
            nav: nav.into_any_element(),
            nav_label: nav_label.into(),
            content: content.into_any_element(),
            on_back: Rc::new(on_back),
            phone_pane: SettingsPane::Nav,
            footer: None,
        }
    }

    pub fn phone_pane(mut self, pane: SettingsPane) -> Self {
        self.phone_pane = pane;
        self
    }

    /// A bar pinned to the bottom of the content island, such as "unsaved changes".
    pub fn footer(mut self, footer: impl IntoElement) -> Self {
        self.footer = Some(footer.into_any_element());
        self
    }
}

/// The page's heading (the web's `h1`): in the nav island, and in the phone's content header.
fn title_text(id: &'static str, title: SharedString) -> impl IntoElement {
    type_text(TEXT_TITLE, title)
        .id(id)
        .test_support()
        .role(Role::Heading)
        .min_w_0()
        .truncate()
}

impl RenderOnce for SettingsLayout {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let phone = WidthRange::current(window).is_phone();
        let show_nav = !phone || self.phone_pane == SettingsPane::Nav;
        let show_content = !phone || self.phone_pane == SettingsPane::Content;
        let nav_main = phone && show_nav;
        let mut shown = Vec::with_capacity(2);
        if show_nav {
            shown.push(NAV);
        }
        if show_content {
            shown.push(CONTENT);
        }
        let target = if nav_main { NAV } else { CONTENT };
        let handles = follow_focus("settings-layout-focus", 2, &shown, target, window, cx);

        let nav = pane("settings-layout-nav", &handles[NAV])
            .when(nav_main, |pane| pane.role(Role::Main))
            .child(
                Island::new("settings-layout-nav-island")
                    .nav(self.nav_label.clone())
                    .padding(Padding::Md)
                    .scroll(true)
                    .child(title_text("settings-layout-nav-title", self.title.clone()))
                    .child(div().mt(px(SPACE_SM)).child(self.nav)),
            )
            .when(nav_main, |pane| pane.child(place_toasts(cx)));

        let on_back = self.on_back.clone();
        let header = phone.then(|| {
            div()
                .id("settings-layout-header")
                .test_support()
                .flex_none()
                .flex()
                .items_center()
                .gap(px(SPACE_MD))
                .min_h(px(CONTROL_MD + 2. * SPACE_LG))
                .px(px(SPACE_LG))
                .child(
                    IconButton::new("settings-layout-back", I::ArrowBack, "Back")
                        .variant(IconButtonVariant::Soft)
                        .on_click(move |_, window, cx| on_back(window, cx)),
                )
                .child(title_text(
                    "settings-layout-header-title",
                    self.title.clone(),
                ))
        });
        let body_top = if phone { SPACE_XS } else { SPACE_XL };
        let body = div()
            .relative()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .id("settings-layout-body")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .overflow_x_hidden()
                    .pt(px(body_top))
                    .px(px(SPACE_XL))
                    .pb(px(SPACE_XL))
                    .child(self.content),
            )
            // Toasts sit above the footer, at the foot of what scrolls.
            .when(show_content, |body| body.child(place_toasts(cx)));
        let footer = self.footer.map(|footer| {
            div()
                .id("settings-layout-footer")
                .test_support()
                .flex_none()
                .flex()
                .flex_wrap()
                .items_center()
                .justify_end()
                .gap(px(SPACE_SM))
                .py(px(SPACE_MD))
                .px(px(SPACE_XL))
                .border_t(px(BORDER_HAIRLINE))
                .border_color(sem.role.hairline)
                .child(footer)
        });
        let content = pane("settings-layout-content", &handles[CONTENT]).child(
            Island::new("settings-layout-content-island")
                .main(Some(self.title.clone()))
                .padding(Padding::None)
                .scroll(true)
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .children(header)
                        .child(body)
                        .children(footer),
                ),
        );

        let root = div()
            .id("settings-layout")
            .test_support()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex();
        if phone {
            root.flex_col().relative().children([
                shown_or_kept(nav, show_nav),
                shown_or_kept(content, show_content),
            ])
        } else {
            root.flex_row()
                .gap(px(LAYOUT_GUTTER))
                .child(nav.flex_none().w(px(LAYOUT_LEFT_COLUMN)))
                .child(shown_or_kept(content, true))
        }
    }
}
