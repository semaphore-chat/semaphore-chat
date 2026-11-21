//! Tabs: a row of choices where exactly one is selected (`frontend/src/kit/controls/Tabs.tsx`).

use super::ValueAction;
use super::behaviour::list_focus::{ListFocusHost, ListKeys, ListOrientation, list_key};
use super::look::{
    Surface, c, focus_ring, mix, outer_focus_ring, shows_focus, stand_out_fill, styled_text,
    tint_base,
};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::behaviour::list_focus;
use semaphore_design::lounge::{
    BORDER_FOCUS, BORDER_HAIRLINE, BORDER_SELECTED, CONTROL_MD, CONTROL_SM, RADIUS_FULL, SPACE_2XS,
    SPACE_LG, SPACE_SM, SPACE_XS, STATE_DISABLED, STATE_HOVER, STATE_HOVER_ON_FILL, STATE_PRESSED,
    STATE_PRESSED_ON_FILL, TEXT_BODY_STRONG, TEXT_META, TEXT_TAG, TextStyle,
};
use semaphore_design::{Palette, Rgba as Token};
use std::rc::Rc;

/// The look: `Underline` switches between views of a page, `Segmented` filters or switches mode
/// within one view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TabsVariant {
    #[default]
    Underline,
    Segmented,
}

/// One tab: its label, an optional count drawn after it, and whether it can be chosen.
#[derive(Debug, Clone, PartialEq)]
pub struct TabItem {
    pub label: SharedString,
    /// The tab's own element id, in place of `<row id>-<index>`, for a rig or test that names it.
    pub id: Option<SharedString>,
    pub count: Option<u32>,
    pub disabled: bool,
}

impl TabItem {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            id: None,
            count: None,
            disabled: false,
        }
    }

    pub fn id(mut self, id: impl Into<SharedString>) -> Self {
        self.id = Some(id.into());
        self
    }

    pub fn count(mut self, count: u32) -> Self {
        self.count = Some(count);
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// The name a screen reader reads: "Mentions, 3".
    pub fn accessible_name(&self) -> SharedString {
        match self.count {
            Some(count) => format!("{}, {count}", self.label).into(),
            None => self.label.clone(),
        }
    }
}

/// A tab's paint: its fill (`None` is clear), its text, and its hover and pressed fills.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TabPaint {
    pub background: Option<Token>,
    pub text: Token,
    pub hover: Token,
    pub pressed: Token,
    /// The underline's colour, for the underline look (`None` draws none).
    pub underline: Option<Token>,
}

/// `Tab`'s styles for `variant`, selected or not, on `on`.
pub fn tab_paint(p: &Palette, variant: TabsVariant, selected: bool, on: Surface) -> TabPaint {
    match variant {
        TabsVariant::Segmented => {
            let under = if selected {
                p.accent
            } else {
                stand_out_fill(p, on)
            };
            let (hover, pressed) = if selected {
                (STATE_HOVER_ON_FILL, STATE_PRESSED_ON_FILL)
            } else {
                (STATE_HOVER, STATE_PRESSED)
            };
            TabPaint {
                background: selected.then_some(p.accent),
                text: if selected {
                    p.on_accent
                } else {
                    p.text_secondary
                },
                hover: mix(p.text, under, hover),
                pressed: mix(p.text, under, pressed),
                underline: None,
            }
        }
        TabsVariant::Underline => {
            let under = tint_base(p, on);
            TabPaint {
                background: None,
                text: if selected { p.text } else { p.text_secondary },
                hover: mix(p.text, under, STATE_HOVER),
                pressed: mix(p.text, under, STATE_PRESSED),
                underline: selected.then_some(p.accent),
            }
        }
    }
}

fn label_type(variant: TabsVariant) -> TextStyle {
    let base = match variant {
        TabsVariant::Segmented => TEXT_META,
        TabsVariant::Underline => TEXT_BODY_STRONG,
    };
    TextStyle {
        weight: TEXT_BODY_STRONG.weight,
        ..base
    }
}

/// Tabs. With a named id, each tab is `<id>-<index>` ("friends-tabs-1"), so a test or a rig can
/// click it. Clicking the selected tab does nothing. The row scrolls when it is wider than its
/// space. The row is one Tab stop (the selected tab); Left and Right (and Up and Down) move to the
/// next or previous enabled tab and select it, wrapping round, and Home and End go to the ends.
#[derive(IntoElement)]
pub struct Tabs {
    id: ElementId,
    items: Vec<TabItem>,
    selected: usize,
    variant: TabsVariant,
    full_width: bool,
    on: Option<Surface>,
    on_select: Option<ValueAction<usize>>,
}

impl Tabs {
    pub fn new(id: impl Into<ElementId>, labels: Vec<SharedString>, selected: usize) -> Self {
        Self::items(id, labels.into_iter().map(TabItem::new).collect(), selected)
    }

    /// Tabs with counts or disabled tabs.
    pub fn items(id: impl Into<ElementId>, items: Vec<TabItem>, selected: usize) -> Self {
        Self {
            id: id.into(),
            items,
            selected,
            variant: TabsVariant::default(),
            full_width: false,
            on: None,
            on_select: None,
        }
    }

    pub fn variant(mut self, variant: TabsVariant) -> Self {
        self.variant = variant;
        self
    }

    /// `variant="segmented"`.
    pub fn segmented(self) -> Self {
        self.variant(TabsVariant::Segmented)
    }

    /// Spreads the tabs across the width of their space.
    pub fn full_width(mut self) -> Self {
        self.full_width = true;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }

    pub fn on_select(mut self, handler: impl Fn(usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(handler));
        self
    }
}

/// The tab row's keyboard list.
struct TabsFocus {
    focus: ListFocusHost,
}

fn tabs_focus(state: &mut TabsFocus) -> &mut ListFocusHost {
    &mut state.focus
}

const TABS_PARAMS: list_focus::Params = list_focus::Params {
    wrap: true,
    selection_follows_focus: true,
    typeahead_ms: semaphore_design::lounge::MOTION_TYPEAHEAD_MS,
};

const TABS_KEYS: ListKeys = ListKeys {
    orientation: ListOrientation::Horizontal,
    typeahead: false,
    allow_shift: false,
};

impl RenderOnce for Tabs {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let (count, selected_index, variant, on) = (
            self.items.len(),
            self.selected,
            self.variant,
            Surface::or_current(self.on, cx),
        );
        let segmented = variant == TabsVariant::Segmented;
        let full_width = self.full_width;
        let on_select = self.on_select;
        let row_name = match &self.id {
            ElementId::Name(name) => Some(name.clone()),
            _ => None,
        };
        let ids: Vec<ElementId> = self
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| match (&item.id, &row_name) {
                (Some(id), _) => ElementId::Name(id.clone()),
                (None, Some(name)) => ElementId::Name(format!("{name}-{index}").into()),
                (None, None) => ("tab", index).into(),
            })
            .collect();
        let ty = label_type(variant);
        // The web's Tabs on `useListFocus`: horizontal, wrapping, selection follows focus, no
        // typeahead. Rows are the tabs' indices.
        let rows: Vec<list_focus::Row> = self
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| list_focus::Row {
                id: index.to_string(),
                label: item.label.to_string(),
                disabled: item.disabled,
            })
            .collect();
        let state = window.use_keyed_state(self.id.clone(), cx, |_, _| TabsFocus {
            focus: ListFocusHost::new(TABS_PARAMS, TABS_KEYS),
        });
        let (synced, stop) = state.update(cx, |state, cx| {
            let synced = state
                .focus
                .sync(rows, Some(Some(selected_index.to_string())), window, cx);
            (synced.handles, state.focus.tab_stop())
        });
        let handles: Vec<FocusHandle> = synced
            .into_iter()
            .map(|(id, handle)| handle.tab_stop(stop.as_deref() == Some(id.as_str())))
            .collect();
        let rings: Vec<bool> = handles
            .iter()
            .map(|handle| shows_focus(handle, window))
            .collect();
        let on_key = on_select.clone();
        let key_state = state.clone();
        base::Tabs::new(self.id)
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                let Some(list_event) = key_state.read(cx).focus.event_for(&event.keystroke) else {
                    return;
                };
                let Some(effects) = list_key(&key_state, tabs_focus, list_event, window, cx) else {
                    return;
                };
                cx.stop_propagation();
                // Selection follows focus; the selected tab does nothing.
                for effect in effects {
                    if let list_focus::Effect::Select { id } = effect
                        && let Ok(next) = id.parse::<usize>()
                        && next != selected_index
                        && let Some(on_select) = &on_key
                    {
                        on_select(next, window, cx);
                    }
                }
            })
            .flex()
            .max_w_full()
            .overflow_x_scroll()
            .when(full_width, |row| row.w_full())
            .map(|row| {
                if segmented {
                    row.gap(px(SPACE_2XS))
                        .p(px(SPACE_XS))
                        .rounded(px(RADIUS_FULL))
                        .bg(c(stand_out_fill(&p, on)))
                } else {
                    row.gap(px(SPACE_LG))
                        .border_b(px(BORDER_HAIRLINE))
                        .border_color(c(p.hairline))
                }
            })
            .children(
                self.items
                    .into_iter()
                    .enumerate()
                    .map(move |(index, item)| {
                        let selected = index == selected_index;
                        let paint = tab_paint(&p, variant, selected, on);
                        let (hover, pressed) = (c(paint.hover), c(paint.pressed));
                        let on_select = on_select.clone();
                        let name = item.accessible_name();
                        let enabled = !item.disabled;
                        let mut tab = base::Tab::new(ids[index].clone())
                            .track_focus(&handles[index])
                            .selected(selected)
                            .disabled(item.disabled)
                            .set_position(index, count)
                            .accessibility_label(name)
                            .relative()
                            .flex()
                            .flex_shrink_0()
                            .items_center()
                            .justify_center()
                            .gap(px(SPACE_SM))
                            .whitespace_nowrap()
                            .text_color(c(paint.text))
                            .when(full_width, |tab| tab.flex_1())
                            .when_some(paint.background, |tab, fill| tab.bg(c(fill)))
                            .when(item.disabled, |tab| tab.opacity(STATE_DISABLED))
                            .when(enabled, |tab| {
                                tab.cursor_pointer()
                                    .hover(move |style| style.bg(hover))
                                    .active(move |style| style.bg(pressed))
                            })
                            .map(|tab| {
                                if segmented {
                                    tab.h(px(CONTROL_SM))
                                        .px(px(SPACE_LG))
                                        .rounded(px(RADIUS_FULL))
                                } else {
                                    tab.h(px(CONTROL_MD))
                                        .px(px(SPACE_XS))
                                        .mb(px(-BORDER_HAIRLINE))
                                }
                            })
                            .child(styled_text(ty, item.label))
                            .children(
                                item.count
                                    .map(|count| styled_text(TEXT_TAG, count.to_string())),
                            )
                            .children(paint.underline.map(|line| {
                                div()
                                    .absolute()
                                    .left_0()
                                    .right_0()
                                    .bottom_0()
                                    .h(px(BORDER_SELECTED))
                                    .bg(c(line))
                            }))
                            // The segmented row's padding holds an outer ring; the underline row
                            // has none, so its ring sits inside, as the web's does.
                            .when(rings[index], |tab| {
                                tab.child(if segmented {
                                    outer_focus_ring(&p, RADIUS_FULL)
                                } else {
                                    focus_ring(&p, 0., -BORDER_FOCUS)
                                })
                            });
                        if enabled && !selected {
                            tab = tab.on_click(move |_, window, cx| {
                                if let Some(on_select) = &on_select {
                                    on_select(index, window, cx);
                                }
                            });
                        }
                        tab
                    }),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kit::look::tests::inputs;
    use crate::theme::Sem;
    use crate::theme::color::contrast_ratio;
    use core::prelude::v1::test;

    #[test]
    fn a_count_is_read_after_the_label() {
        assert_eq!(
            TabItem::new("Mentions").count(3).accessible_name(),
            "Mentions, 3"
        );
        assert_eq!(TabItem::new("All").accessible_name(), "All");
    }

    #[test]
    fn the_looks_paint_their_roles() {
        let p = Sem::default().roles;
        let pill = tab_paint(&p, TabsVariant::Segmented, true, Surface::Surface);
        assert_eq!((pill.background, pill.text), (Some(p.accent), p.on_accent));
        assert_eq!(pill.hover, mix(p.text, p.accent, STATE_HOVER_ON_FILL));
        let rest = tab_paint(&p, TabsVariant::Segmented, false, Surface::Surface);
        assert_eq!((rest.background, rest.text), (None, p.text_secondary));
        assert_eq!(rest.hover, mix(p.text, p.fill, STATE_HOVER));
        let line = tab_paint(&p, TabsVariant::Underline, true, Surface::Ground);
        assert_eq!((line.underline, line.text), (Some(p.accent), p.text));
        assert_eq!(line.pressed, mix(p.text, p.ground, STATE_PRESSED));
        assert_eq!(
            tab_paint(&p, TabsVariant::Underline, false, Surface::Surface).underline,
            None
        );
        assert_eq!(label_type(TabsVariant::Segmented).size, TEXT_META.size);
        assert_eq!(
            label_type(TabsVariant::Underline).size,
            TEXT_BODY_STRONG.size
        );
    }

    #[test]
    fn tab_text_reads_on_every_theme() {
        for input in inputs() {
            let p = Sem::new(input).roles;
            for on in [Surface::Ground, Surface::Surface, Surface::Fill] {
                for variant in [TabsVariant::Underline, TabsVariant::Segmented] {
                    for selected in [false, true] {
                        let paint = tab_paint(&p, variant, selected, on);
                        let under =
                            paint
                                .background
                                .unwrap_or(if variant == TabsVariant::Segmented {
                                    stand_out_fill(&p, on)
                                } else {
                                    tint_base(&p, on)
                                });
                        let ratio = contrast_ratio(paint.text, under);
                        assert!(
                            ratio >= 4.5,
                            "{} {variant:?} selected={selected} on {on:?}: {ratio:.2}:1",
                            input.name()
                        );
                    }
                }
            }
        }
    }
}
