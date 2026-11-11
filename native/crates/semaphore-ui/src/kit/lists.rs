//! List rows, Tabs and Table.

use super::{Action, ValueAction, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use std::rc::Rc;

/// MuiListItemButton with the theme's override: hover and selected tints, and the selected accent
/// border. The sidebars' own rows build on the same colours; this is the general one.
#[derive(IntoElement)]
pub struct ListRow {
    id: ElementId,
    primary: SharedString,
    secondary: Option<SharedString>,
    leading: Option<AnyElement>,
    trailing: Option<AnyElement>,
    selected: bool,
    disabled: bool,
    on_click: Option<Action>,
}

impl ListRow {
    pub fn new(id: impl Into<ElementId>, primary: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            primary: primary.into(),
            secondary: None,
            leading: None,
            trailing: None,
            selected: false,
            disabled: false,
            on_click: None,
        }
    }

    pub fn secondary(mut self, secondary: impl Into<SharedString>) -> Self {
        self.secondary = Some(secondary.into());
        self
    }

    pub fn leading(mut self, leading: impl IntoElement) -> Self {
        self.leading = Some(leading.into_any_element());
        self
    }

    pub fn trailing(mut self, trailing: impl IntoElement) -> Self {
        self.trailing = Some(trailing.into_any_element());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for ListRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let hover = if self.selected {
            sem.list_selected_hover
        } else {
            sem.list_hover
        };
        let mut row = base::Button::new(self.id)
            .selected(self.selected)
            .disabled(self.disabled)
            .accessibility_label(self.primary.clone())
            .w_full()
            .min_h(px(40.))
            .flex()
            .items_center()
            .justify_start()
            .gap(px(12.))
            .px(px(16.))
            .py(px(4.))
            .mb(px(2.))
            .rounded(px(8.))
            .text_color(if self.disabled {
                sem.text_disabled
            } else {
                sem.text_primary
            })
            .when(!self.disabled, |row| {
                row.cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .focus_visible(move |style| style.bg(hover))
            })
            .when(self.selected, |row| {
                row.bg(sem.list_selected)
                    .border_l(sem.list_selected_border)
                    .border_color(sem.primary)
            })
            .children(self.leading)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(text(Variant::Body2, self.primary).truncate())
                    .children(self.secondary.map(|secondary| {
                        text(Variant::Caption, secondary)
                            .truncate()
                            .text_color(sem.text_secondary)
                    })),
            )
            .children(self.trailing);
        if let Some(handler) = self.on_click.filter(|_| !self.disabled) {
            row = row.on_click(move |_, window, cx| handler(window, cx));
        }
        row
    }
}

/// MuiTabs: labels with a 2px accent underline on the selected one. With a named id, each tab is
/// `<id>-<index>` ("friends-tabs-1"), so a test or a rig can click it.
#[derive(IntoElement)]
pub struct Tabs {
    id: ElementId,
    labels: Vec<SharedString>,
    selected: usize,
    on_select: Option<ValueAction<usize>>,
}

impl Tabs {
    pub fn new(id: impl Into<ElementId>, labels: Vec<SharedString>, selected: usize) -> Self {
        Self {
            id: id.into(),
            labels,
            selected,
            on_select: None,
        }
    }

    pub fn on_select(mut self, handler: impl Fn(usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Tabs {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let (count, selected_index) = (self.labels.len(), self.selected);
        let (selected_color, other_color, line) =
            (sem.tab_selected, sem.text_secondary, sem.primary);
        let on_select = self.on_select;
        let tab_id = {
            let name = match &self.id {
                ElementId::Name(name) => Some(name.clone()),
                _ => None,
            };
            move |index: usize| -> ElementId {
                match &name {
                    Some(name) => ElementId::Name(format!("{name}-{index}").into()),
                    None => ("tab", index).into(),
                }
            }
        };
        base::Tabs::new(self.id)
            .flex()
            .border_b_1()
            .border_color(sem.divider)
            .children(
                self.labels
                    .into_iter()
                    .enumerate()
                    .map(move |(index, label)| {
                        let selected = index == selected_index;
                        let on_select = on_select.clone();
                        base::Tab::new(tab_id(index))
                            .selected(selected)
                            .set_position(index, count)
                            .accessibility_label(label.clone())
                            .cursor_pointer()
                            .min_w(px(90.))
                            .h(px(48.))
                            .relative()
                            .flex()
                            .items_center()
                            .justify_center()
                            .px(px(16.))
                            .text_color(if selected {
                                selected_color
                            } else {
                                other_color
                            })
                            .on_click(move |_, window, cx| {
                                if let Some(on_select) = &on_select {
                                    on_select(index, window, cx);
                                }
                            })
                            .child(text(Variant::Button, label))
                            .when(selected, |tab| {
                                tab.child(
                                    div()
                                        .absolute()
                                        .left_0()
                                        .right_0()
                                        .bottom_0()
                                        .h(px(2.))
                                        .bg(line),
                                )
                            })
                    }),
            )
    }
}

/// MuiTable: a header and rows, sized by share of the width. It is not virtual: the web's tables
/// aren't either. A table of thousands wants gpui-kit's `DataTable`.
#[derive(IntoElement)]
pub struct Table {
    label: SharedString,
    columns: Vec<SharedString>,
    rows: Vec<Vec<SharedString>>,
}

impl Table {
    pub fn new(
        label: impl Into<SharedString>,
        columns: Vec<SharedString>,
        rows: Vec<Vec<SharedString>>,
    ) -> Self {
        Self {
            label: label.into(),
            columns,
            rows,
        }
    }
}

impl RenderOnce for Table {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let (divider, primary, cell_padding) = (sem.divider, sem.text_primary, px(16.));
        let row = move |cells: Vec<SharedString>, head: bool| {
            div()
                .flex()
                .w_full()
                .border_b_1()
                .border_color(divider)
                .text_color(primary)
                .children(cells.into_iter().map(move |cell| {
                    div().flex_1().min_w_0().p(cell_padding).child(
                        text(
                            if head {
                                Variant::Subtitle2
                            } else {
                                Variant::Body2
                            },
                            cell,
                        )
                        .truncate(),
                    )
                }))
        };
        div()
            .w_full()
            .flex()
            .flex_col()
            .id("table")
            .test_support()
            .role(Role::Table)
            .aria_label(self.label)
            .child(row(self.columns, true))
            .children(self.rows.into_iter().map(move |cells| row(cells, false)))
    }
}
