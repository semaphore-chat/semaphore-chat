//! `LinkCard`: a link's preview under a message (`frontend/src/kit/chat/LinkCard.tsx`).

use super::one_line;
use crate::kit::Icon;
use crate::kit::look::{focus_handle, focus_ring, shows_focus};
use crate::kit::overlays::type_text;
use crate::kit::surface::{Surface, stand_out_fill, tint_base_token};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::links::check_link;
use semaphore_design::LoungeIcon;
use semaphore_design::chat::IMAGE_MAX;
use semaphore_design::lounge::{
    BORDER_SELECTED, ICON_SM, RADIUS_MD, RADIUS_SM, SPACE_MD, SPACE_SM, SPACE_XS, STATE_HOVER,
    TEXT_BODY_STRONG, TEXT_META, TEXT_SMALL,
};

/// The banner's shape: the 1.91:1 that link-preview images are made for.
pub const LINK_CARD_BANNER_RATIO: f32 = 1.91;

/// A link's preview (MessageRow's `attachments`): the site, the page's title and summary, and its
/// picture. The whole card is one link that opens in the browser. A picture given by address
/// passes the same check as the link (http or https, no user name); one that fails to load is
/// left out (the banner box stays empty, so the card keeps its height).
#[derive(IntoElement)]
pub struct LinkCard {
    id: ElementId,
    href: SharedString,
    site: SharedString,
    title: Option<SharedString>,
    description: Option<SharedString>,
    image: Option<ImageSource>,
    icon: Option<ImageSource>,
    on: Option<Surface>,
}

impl LinkCard {
    /// `site` is the site's name or host ("Example · Aiko"); one line.
    pub fn new(
        id: impl Into<ElementId>,
        href: impl Into<SharedString>,
        site: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            href: href.into(),
            site: site.into(),
            title: None,
            description: None,
            image: None,
            icon: None,
            on: None,
        }
    }

    /// The page's title (two lines at most).
    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// The page's own summary (two lines at most).
    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// The page's picture, in a fixed 1.91:1 box.
    pub fn image(mut self, image: ImageSource) -> Self {
        self.image = Some(image);
        self
    }

    /// The site's icon, beside its name.
    pub fn icon(mut self, icon: ImageSource) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// A picture the card may draw: one given by address must pass the link check.
pub(crate) fn allowed_picture(source: ImageSource) -> Option<ImageSource> {
    match &source {
        ImageSource::Resource(Resource::Uri(uri)) => check_link(uri)
            .map(|link| ImageSource::Resource(Resource::Uri(SharedUri::from(link.href)))),
        _ => Some(source),
    }
}

/// The card's name: "title, site, opens in your browser", or the plain card's "title" / "site".
pub(crate) fn card_name(title: Option<&str>, site: &str, link: bool) -> String {
    match (link, title) {
        (true, Some(title)) => format!("{title}, {site}, opens in your browser"),
        (true, None) => format!("{site}, opens in your browser"),
        (false, title) => title.unwrap_or(site).to_owned(),
    }
}

impl RenderOnce for LinkCard {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let p = sem.roles;
        let on = Surface::or_current(self.on, cx);
        let link = check_link(&self.href);
        let name = card_name(self.title.as_deref(), &self.site, link.is_some());
        let secondary = sem.role.text_secondary;
        let site_icon = match self.icon.and_then(allowed_picture) {
            Some(source) => img(source)
                .size(px(ICON_SM))
                .rounded(px(SPACE_XS))
                .object_fit(ObjectFit::Contain)
                .with_fallback(move || {
                    Icon::lounge(LoungeIcon::Link)
                        .size(ICON_SM)
                        .color(secondary)
                        .into_any_element()
                })
                .into_any_element(),
            None => Icon::lounge(LoungeIcon::Link)
                .size(ICON_SM)
                .color(secondary)
                .into_any_element(),
        };
        let banner_fill = hsla_of(blend(p.text, tint_base_token(&p, on), STATE_HOVER));
        let content = vec![
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_XS))
                .min_w_0()
                .text_color(secondary)
                .child(div().flex_shrink_0().child(site_icon))
                .child(one_line(TEXT_SMALL, self.site.clone()))
                .into_any_element(),
            self.title
                .clone()
                .map(|title| {
                    type_text(TEXT_BODY_STRONG, title)
                        .text_color(sem.role.accent_text)
                        .line_clamp(2)
                        .into_any_element()
                })
                .unwrap_or_else(|| Empty.into_any_element()),
            self.description
                .map(|description| {
                    type_text(TEXT_META, description)
                        .text_color(secondary)
                        .line_clamp(2)
                        .into_any_element()
                })
                .unwrap_or_else(|| Empty.into_any_element()),
            self.image
                .and_then(allowed_picture)
                .map(|source| {
                    div()
                        .w_full()
                        .aspect_ratio(LINK_CARD_BANNER_RATIO)
                        .mt(px(SPACE_XS))
                        .overflow_hidden()
                        .rounded(px(RADIUS_SM))
                        .bg(banner_fill)
                        .child(
                            img(source)
                                .size_full()
                                .object_fit(ObjectFit::Cover)
                                .with_fallback(|| Empty.into_any_element()),
                        )
                        .into_any_element()
                })
                .unwrap_or_else(|| Empty.into_any_element()),
        ];
        let look = |el: Div| {
            el.flex()
                .flex_col()
                .gap(px(SPACE_XS))
                .w_full()
                .max_w(px(IMAGE_MAX.width))
                .min_w_0()
                .pt(px(SPACE_SM))
                .px(px(SPACE_MD))
                .pb(px(SPACE_MD))
                .rounded(px(RADIUS_MD))
                .border_l(px(BORDER_SELECTED))
                .border_color(sem.role.accent)
                .bg(stand_out_fill(&sem, on))
                .text_color(sem.role.text)
        };
        match link {
            Some(link) => {
                let focus = focus_handle(&self.id, window, cx);
                let ring = shows_focus(&focus, window);
                let hover = hsla_of(blend(p.text, tint_base_token(&p, on), STATE_HOVER));
                let href = link.href;
                // The card's look on a wrapper the button fills: a base button centres its content.
                base::Button::new(self.id)
                    .track_focus(&focus)
                    .role(Role::Link)
                    .accessibility_label(name)
                    .relative()
                    .w_full()
                    .max_w(px(IMAGE_MAX.width))
                    .rounded(px(RADIUS_MD))
                    .cursor_pointer()
                    .on_click(move |_, _, cx| cx.open_url(&href))
                    .child(
                        look(div())
                            .hover(move |style| style.bg(hover))
                            .children(content),
                    )
                    .when(ring, |card| card.child(focus_ring(&p, RADIUS_MD, 0.)))
                    .into_any_element()
            }
            None => look(div())
                .id(self.id)
                .test_support()
                .role(Role::Group)
                .aria_label(name)
                .children(content)
                .into_any_element(),
        }
    }
}
