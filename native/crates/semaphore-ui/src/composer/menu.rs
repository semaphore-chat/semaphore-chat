//! The mention dropdown, after `MentionDropdown.tsx`, placed at the caret.
//!
//! The web sits it above the whole composer. Here it follows the caret, as the unit asks: its arrow
//! points at the caret's x, and its bottom sits just above the caret's line. Below
//! [`MENU_FULL_WIDTH_BELOW`] it takes the composer's width and drops the key hint, as the web does on
//! a phone, and only the bottom follows the caret.
//!
//! The kit's own caret popup (`CaretAnchoredPopup`) is private, so this does what it does: resolve
//! the anchor in prepaint, inside `deferred`, from the geometry the input stashed in its own prepaint
//! that frame. A dropdown laid out in `render` would trail the caret by a frame.

use super::palette::{BODY_FONT, MENU_FULL_WIDTH_BELOW, Palette, icon, observed, with_alpha};
use super::rules::menu_heading;
use gpui_kit::base::Button;
use gpui_kit::component::input::TextareaState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{MentionCandidate, MentionKind};
use semaphore_design::Icon as DesignIcon;
use std::rc::Rc;

const MENU_WIDTH: f32 = 280.;
const MENU_MAX_HEIGHT: f32 = 320.;
const MENU_HEIGHT_FRACTION: f32 = 0.4;
const ARROW_LEFT: f32 = 24.;
const ARROW_HALF: f32 = 8.;
/// With the caret on the field's first line, this puts the arrow's tip on the field's top edge,
/// which leaves the web's 8 px gap under the paper.
const GAP_ABOVE_CARET: f32 = 17.;
const WINDOW_MARGIN: f32 = 8.;

pub type OnPick = Rc<dyn Fn(usize, &mut Window, &mut App)>;

/// Everything the dropdown draws.
pub struct MenuData<'a> {
    pub candidates: &'a [MentionCandidate],
    pub selected: usize,
    pub scroll: &'a ScrollHandle,
    pub on_pick: OnPick,
    /// The app's avatar files, for members' pictures. Initials without.
    pub avatars: Option<&'a crate::kit::AvatarImages>,
}

fn full_width(viewport: Size<Pixels>) -> bool {
    viewport.width < px(MENU_FULL_WIDTH_BELOW)
}

fn avatar(
    candidate: &MentionCandidate,
    selected: bool,
    palette: &Palette,
    avatars: Option<&crate::kit::AvatarImages>,
) -> AnyElement {
    let (tint, glyph) = match candidate.kind {
        MentionKind::User => {
            let initial: String = candidate
                .label
                .chars()
                .filter(|c| c.is_alphanumeric())
                .take(1)
                .flat_map(char::to_uppercase)
                .collect();
            let ring = if selected {
                with_alpha(palette.primary, 0.5)
            } else {
                with_alpha(palette.divider, 0.1)
            };
            let picture = avatars.and_then(|avatars| {
                let file_id = candidate.avatar_file_id.as_deref()?;
                Some(((avatars.resolve)(file_id)?, avatars.cache.clone()))
            });
            return div()
                .size(px(36.))
                .flex_none()
                .rounded_full()
                .border_2()
                .border_color(ring)
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .size(px(32.))
                        .rounded_full()
                        .bg(palette.avatar_bg)
                        .text_color(palette.background)
                        .text_size(px(14.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .overflow_hidden()
                        .map(|circle| match picture {
                            // Initials until the picture is decoded, and if it never is.
                            Some((resource, cache)) => circle.child(
                                img(ImageSource::Resource(resource))
                                    .image_cache(&cache)
                                    .size_full()
                                    .rounded_full()
                                    .object_fit(ObjectFit::Cover)
                                    .with_fallback(move || {
                                        div().child(initial.clone()).into_any_element()
                                    }),
                            ),
                            None => circle.child(initial),
                        }),
                )
                .into_any_element();
        }
        MentionKind::Alias => (palette.warning, DesignIcon::Group),
        MentionKind::Special => (palette.success, DesignIcon::Notifications),
        MentionKind::Channel => (palette.primary, DesignIcon::Tag),
    };
    div()
        .size(px(36.))
        .flex_none()
        .rounded_full()
        .bg(with_alpha(tint, 0.1))
        .border_2()
        .border_color(if selected {
            with_alpha(tint, 0.5)
        } else {
            with_alpha(palette.divider, 0.1)
        })
        .flex()
        .items_center()
        .justify_center()
        .child(icon(glyph, 20., tint))
        .into_any_element()
}

/// The second line: the label, if it says more than the insert text does.
fn subtitle(candidate: &MentionCandidate) -> Option<String> {
    let bare = candidate
        .insert_text
        .trim_start_matches(['@', '#'])
        .to_owned();
    (candidate.label != bare && !candidate.label.is_empty()).then(|| candidate.label.clone())
}

fn row(
    index: usize,
    candidate: &MentionCandidate,
    data: &MenuData,
    one_line: bool,
    palette: &Palette,
) -> Button {
    let selected = index == data.selected;
    let on_pick = data.on_pick.clone();
    let subtitle = subtitle(candidate);
    let tint = with_alpha(palette.primary, 0.08);
    Button::new(("mention-option", index))
        .role(Role::ListBoxOption)
        .accessibility_label(candidate.insert_text.clone())
        .aria_selected(selected)
        .aria_position_in_set(index + 1)
        .aria_size_of_set(data.candidates.len())
        // The field keeps focus, as on the web: typing goes on narrowing the list.
        .focusable(false)
        .on_click(move |_, window, cx| on_pick(index, window, cx))
        .w_full()
        .flex_none()
        .min_h(px(44.))
        .when(!one_line, |row| row.mb(px(2.)).py(px(15.)))
        .pl(px(13.))
        .pr(px(16.))
        .rounded(px(8.))
        .border_l_3()
        .border_color(if selected {
            palette.primary
        } else {
            transparent_black()
        })
        .when(selected, |row| row.bg(tint))
        .hover(move |style| style.bg(tint))
        .cursor_pointer()
        .justify_start()
        .gap(px(14.))
        .child(avatar(candidate, selected, palette, data.avatars))
        .child(
            div()
                .flex()
                // Phone: name and @handle on one line, so every row is 44 px.
                .when(one_line, |text| {
                    text.flex_row().items_baseline().gap(px(8.))
                })
                .when(!one_line, |text| text.flex_col().gap(px(2.)))
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .truncate()
                        .when(one_line, |name| name.flex_none().max_w(relative(0.6)))
                        .line_height(px(20.))
                        .text_size(px(14.))
                        .font_weight(if selected {
                            FontWeight::SEMIBOLD
                        } else {
                            FontWeight::MEDIUM
                        })
                        .text_color(if selected {
                            palette.primary
                        } else {
                            palette.text
                        })
                        .child(candidate.insert_text.clone()),
                )
                .when_some(subtitle, |column, subtitle| {
                    column.child(
                        div()
                            .truncate()
                            .line_height(px(20.))
                            .text_size(px(12.))
                            .text_color(with_alpha(palette.text_secondary, 0.8))
                            .child(subtitle),
                    )
                }),
        )
}

/// The little triangle under the paper, pointing at the caret.
fn arrow(color: Hsla) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let mut builder = PathBuilder::fill();
            builder.move_to(bounds.origin);
            builder.line_to(bounds.top_right());
            builder.line_to(point(bounds.center().x, bounds.bottom()));
            builder.close();
            if let Ok(path) = builder.build() {
                window.paint_path(path, color);
            }
        },
    )
    .absolute()
    .left(px(ARROW_LEFT))
    .bottom(px(-ARROW_HALF))
    .w(px(ARROW_HALF * 2.))
    .h(px(ARROW_HALF))
}

/// The dropdown's paper. Its height is capped as the web's is, at 40% of the window.
pub fn menu(data: MenuData, viewport: Size<Pixels>, palette: &Palette) -> AnyElement {
    let full = full_width(viewport);
    let max_height = px(MENU_MAX_HEIGHT).min(viewport.height * MENU_HEIGHT_FRACTION);
    let rows: Vec<_> = data
        .candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| row(index, candidate, &data, full, palette))
        .collect();
    let heading = menu_heading(data.candidates).to_uppercase();
    let menu = div()
        .id("mention-menu")
        .occlude()
        .relative()
        .flex()
        .flex_col()
        .font_family(BODY_FONT)
        .when(full, |menu| menu.w(viewport.width - px(WINDOW_MARGIN * 2.)))
        .when(!full, |menu| menu.w(px(MENU_WIDTH)))
        .max_h(max_height)
        .rounded(px(12.))
        .border_1()
        .border_color(with_alpha(palette.divider, 0.12))
        .bg(palette.paper)
        .shadow(vec![
            BoxShadow {
                color: with_alpha(black(), 0.12),
                offset: point(px(0.), px(8.)),
                blur_radius: px(32.),
                spread_radius: px(0.),
                inset: false,
            },
            BoxShadow {
                color: with_alpha(black(), 0.08),
                offset: point(px(0.), px(2.)),
                blur_radius: px(8.),
                spread_radius: px(0.),
                inset: false,
            },
        ])
        .child(
            div()
                .flex_none()
                .px(px(16.))
                .py(px(if full { 6. } else { 12. }))
                .border_b_1()
                .border_color(with_alpha(palette.divider, 0.08))
                .text_size(px(12.))
                .line_height(px(24.))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(palette.text_secondary)
                .child(heading),
        )
        .child(observed(
            div()
                .id("mention-listbox")
                .role(Role::ListBox)
                .aria_label("Mention suggestions")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .p(px(4.))
                .overflow_y_scroll()
                .track_scroll(data.scroll)
                .children(rows),
        ))
        .when(!full, |menu| {
            menu.child(
                div()
                    .flex_none()
                    .px(px(16.))
                    .py(px(8.))
                    .border_t_1()
                    .border_color(with_alpha(palette.divider, 0.08))
                    .text_size(px(11.))
                    .line_height(px(24.))
                    .text_color(with_alpha(palette.text_secondary, 0.6))
                    .child("↑↓ Navigate • Enter/Tab Select • Esc Close"),
            )
        })
        .child(arrow(palette.paper));
    observed(menu).into_any_element()
}

/// Places its child above the caret, once the input has laid out this frame. Use inside `deferred`,
/// so its prepaint comes after the input's.
pub struct AtCaret {
    state: Entity<TextareaState>,
    child: AnyElement,
}

impl AtCaret {
    pub fn new(state: Entity<TextareaState>, child: AnyElement) -> Self {
        Self { state, child }
    }
}

/// The window origin for a menu of `size` whose arrow points at `caret`.
fn origin_for(
    caret: Bounds<Pixels>,
    scroll_y: Pixels,
    size: Size<Pixels>,
    viewport: Size<Pixels>,
) -> Point<Pixels> {
    let margin = px(WINDOW_MARGIN);
    let x = if full_width(viewport) {
        margin
    } else {
        let right_limit = (viewport.width - size.width - margin).max(margin);
        (caret.origin.x - px(ARROW_LEFT + ARROW_HALF)).clamp(margin, right_limit)
    };
    let caret_top = caret.origin.y + scroll_y;
    let y = (caret_top - px(GAP_ABOVE_CARET) - size.height).max(margin);
    point(x, y)
}

impl Element for AtCaret {
    type RequestLayoutState = ();
    type PrepaintState = bool;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        // Zero-sized where it sits: the real layout happens in prepaint, once the anchor is known.
        (window.request_layout(Style::default(), [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        let Some(geometry) = self.state.read(cx).prepaint_caret_geometry() else {
            return false;
        };
        let viewport = window.viewport_size();
        let available = size(
            AvailableSpace::Definite(viewport.width),
            AvailableSpace::Definite(viewport.height),
        );
        let measured = self.child.layout_as_root(available, window, cx);
        let origin = origin_for(
            geometry.cursor_bounds(),
            geometry.scroll_offset().y,
            measured,
            viewport,
        );
        self.child.prepaint_at(origin, window, cx);
        true
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        placed: &mut bool,
        window: &mut Window,
        cx: &mut App,
    ) {
        if *placed {
            self.child.paint(window, cx);
        }
    }
}

impl IntoElement for AtCaret {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[core::prelude::v1::test]
    fn the_menu_stays_in_the_window_and_points_at_the_caret() {
        let caret = |x: f32, y: f32| Bounds::new(point(px(x), px(y)), size(px(1.), px(20.)));
        let menu = size(px(280.), px(200.));
        let wide = size(px(1000.), px(600.));
        // Arrow on the caret.
        assert_eq!(
            origin_for(caret(300., 500.), px(0.), menu, wide),
            point(px(268.), px(283.))
        );
        // Clamped at each edge.
        assert_eq!(origin_for(caret(10., 500.), px(0.), menu, wide).x, px(8.));
        assert_eq!(
            origin_for(caret(990., 500.), px(0.), menu, wide).x,
            px(712.)
        );
        assert_eq!(origin_for(caret(300., 100.), px(0.), menu, wide).y, px(8.));
        // Inner scroll moves the caret's line up.
        assert_eq!(
            origin_for(caret(300., 500.), px(-23.), menu, wide).y,
            px(260.)
        );
        // Narrow: full width, so only the height follows.
        let narrow = size(px(400.), px(600.));
        assert_eq!(
            origin_for(caret(300., 500.), px(0.), menu, narrow).x,
            px(8.)
        );
    }
}
