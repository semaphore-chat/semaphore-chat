//! ListRow and Table on the design system (`design/guide/components.md`), and Tabs.
//!
//! ListRow and Table read only the roles (`sem.roles`) and the tokens (`design/tokens.json`).
//! A keyboard list (Up and Down, typeahead) is the list-focus host's (epic #848, B8): a row only
//! takes the focus handle and Tab stop the host gives it.

use super::overlays::{state_over, type_text};
use super::{Action, Icon, Spinner, ValueAction, Variant, text};
use crate::theme::{Sem, SemTheme};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use semaphore_design::lounge::{
    self as t, AVATAR_SM, BORDER_FOCUS, BORDER_HAIRLINE, CONTROL_LG, CONTROL_MD, ICON_SM,
    RADIUS_CARD, RADIUS_FULL, SPACE_MD, SPACE_SM, SPACE_XL, SPACE_XS, STATE_DISABLED, STATE_HOVER,
    STATE_HOVER_ON_FILL, STATE_PRESSED, STATE_PRESSED_ON_FILL,
};
use std::rc::Rc;

/// A row's height and shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RowSize {
    /// One line, `control.md` high, fully rounded.
    #[default]
    Md,
    /// Room for two lines, `control.lg` high, the card radius.
    Lg,
}

/// How a row's text reads: the row's own colour, the full text colour, or dimmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LineTone {
    Row,
    Strong,
    Dim,
}

/// The colours a row paints, from the roles. The web's `Wrapper`, `mainStyle` and `Line`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct RowPaint {
    pub background: Option<Hsla>,
    pub hover: Hsla,
    pub pressed: Hsla,
    /// The row's own text colour: secondary text, or the on-accent ink when selected.
    pub ink: Hsla,
    pub ring: Hsla,
    pub primary: Hsla,
    pub secondary: Hsla,
}

impl RowPaint {
    pub(crate) fn of(sem: &Sem, selected: bool, unread: bool, muted: bool) -> Self {
        let (under, hover, pressed) = if selected {
            (sem.roles.accent, STATE_HOVER_ON_FILL, STATE_PRESSED_ON_FILL)
        } else {
            (sem.roles.surface, STATE_HOVER, STATE_PRESSED)
        };
        let ink = if selected {
            sem.role.on_accent
        } else {
            sem.role.text_secondary
        };
        let colour = |tone: LineTone| match tone {
            LineTone::Row => ink,
            LineTone::Strong => sem.role.text,
            LineTone::Dim => sem.role.text_dim,
        };
        Self {
            background: selected.then_some(sem.role.accent),
            hover: state_over(sem, under, hover),
            pressed: state_over(sem, under, pressed),
            ink,
            // A ring in the focus colour vanishes into the accent: a selected row's is the ink.
            ring: if selected {
                sem.role.on_accent
            } else {
                sem.role.focus
            },
            primary: colour(line_tone(selected, muted, unread)),
            secondary: colour(line_tone(selected, muted, false)),
        }
    }
}

/// Selected keeps the on-accent ink whatever else is set; then muted dims and unread strengthens.
pub(crate) fn line_tone(selected: bool, dim: bool, strong: bool) -> LineTone {
    if selected {
        LineTone::Row
    } else if dim {
        LineTone::Dim
    } else if strong {
        LineTone::Strong
    } else {
        LineTone::Row
    }
}

/// The row's accessible name and description, by the web's naming rule: without a `label` the
/// visible lines with ", unread" and the trailing meaning after the primary; with one, the label
/// replaces the lines, the state is appended, and the secondary line becomes the description.
pub(crate) fn row_name(
    primary: &str,
    secondary: Option<&str>,
    label: Option<&str>,
    unread: bool,
    trailing_label: Option<&str>,
) -> (String, Option<String>) {
    let mut state: Vec<&str> = Vec::new();
    if unread {
        state.push("unread");
    }
    if let Some(trailing) = trailing_label.filter(|label| !label.is_empty()) {
        state.push(trailing);
    }
    match label {
        Some(label) => {
            let name = std::iter::once(label).chain(state).collect::<Vec<_>>();
            (name.join(", "), secondary.map(str::to_owned))
        }
        None => {
            let name = std::iter::once(primary)
                .chain(state)
                .chain(secondary)
                .collect::<Vec<_>>();
            (name.join(", "), None)
        }
    }
}

/// A row in a list of channels, people or places, as the web kit's ListRow: a button with
/// [`ListRow::on_click`], plain content without. `selected` is the solid accent pill. `trailing`
/// sits beside the button, not inside it, so it may hold buttons of its own.
#[derive(IntoElement)]
pub struct ListRow {
    id: ElementId,
    primary: SharedString,
    secondary: Option<SharedString>,
    leading: Option<AnyElement>,
    trailing: Option<AnyElement>,
    size: RowSize,
    selected: bool,
    unread: bool,
    strong: bool,
    trailing_label: Option<SharedString>,
    muted: bool,
    disabled: bool,
    label: Option<SharedString>,
    chevron: bool,
    busy: bool,
    focus: Option<FocusHandle>,
    tab_stop: Option<bool>,
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
            size: RowSize::Md,
            selected: false,
            unread: false,
            strong: false,
            trailing_label: None,
            muted: false,
            disabled: false,
            label: None,
            chevron: false,
            busy: false,
            focus: None,
            tab_stop: None,
            on_click: None,
        }
    }

    pub fn secondary(mut self, secondary: impl Into<SharedString>) -> Self {
        self.secondary = Some(secondary.into());
        self
    }

    /// An Avatar or an Icon. The text lines up in the same place whichever.
    pub fn leading(mut self, leading: impl IntoElement) -> Self {
        self.leading = Some(leading.into_any_element());
        self
    }

    /// A Badge, a Pill or an IconButton. It takes at most half the row.
    pub fn trailing(mut self, trailing: impl IntoElement) -> Self {
        self.trailing = Some(trailing.into_any_element());
        self
    }

    pub fn size(mut self, size: RowSize) -> Self {
        self.size = size;
        self
    }

    /// The current item: the solid accent pill.
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// A bolder main line in the full text colour, and ", unread" in the row's name.
    pub fn unread(mut self, unread: bool) -> Self {
        self.unread = unread;
        self
    }

    /// The same line as `unread`, for a title row, with nothing added to the name.
    pub fn strong(mut self, strong: bool) -> Self {
        self.strong = strong;
        self
    }

    /// What the trailing slot means, in the row's name: "2 mentions", "admin".
    pub fn trailing_label(mut self, label: impl Into<SharedString>) -> Self {
        self.trailing_label = Some(label.into());
        self
    }

    /// Both lines dimmed.
    pub fn muted(mut self, muted: bool) -> Self {
        self.muted = muted;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// The button's name when its lines do not say what it does; the secondary line then
    /// describes it. Ignored on a plain row.
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// A chevron at the end of the button: a sign that the row goes somewhere.
    pub fn chevron(mut self, chevron: bool) -> Self {
        self.chevron = chevron;
        self
    }

    /// What the row opens is still loading: a small spinner in place of the chevron, presses
    /// ignored, and it stays focusable.
    pub fn busy(mut self, busy: bool) -> Self {
        self.busy = busy;
        self
    }

    /// Joins a keyboard list: the list's focus handle for this row and whether it is the list's
    /// one Tab stop. The list-focus host moves focus; the row only takes it.
    pub fn focus(mut self, handle: &FocusHandle, tab_stop: bool) -> Self {
        self.focus = Some(handle.clone());
        self.tab_stop = Some(tab_stop);
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
        let interactive = self.on_click.is_some();
        let working = self.busy && interactive && !self.disabled;
        let paint = RowPaint::of(sem, self.selected, self.unread || self.strong, self.muted);
        let (height, radius) = match self.size {
            RowSize::Md => (CONTROL_MD, RADIUS_FULL),
            RowSize::Lg => (CONTROL_LG, RADIUS_CARD),
        };
        let (name, description) = row_name(
            &self.primary,
            self.secondary.as_deref(),
            self.label.as_deref().filter(|_| interactive),
            self.unread && !self.selected,
            self.trailing_label.as_deref(),
        );
        let weight = if self.unread || self.strong {
            t::TEXT_BODY_STRONG
        } else {
            t::TEXT_BODY
        };
        let has_trailing = self.trailing.is_some();
        let end = if working {
            Some(
                Spinner::new(ElementId::Name(format!("{}-busy", self.id).into()))
                    .size(ICON_SM)
                    .color(paint.ink)
                    .into_any_element(),
            )
        } else if self.chevron && interactive {
            Some(
                Icon::new(IconName::ChevronRight)
                    .size(ICON_SM)
                    .color(paint.ink)
                    .into_any_element(),
            )
        } else {
            None
        };
        let mut children: Vec<AnyElement> = Vec::new();
        if let Some(leading) = self.leading {
            children.push(
                div()
                    .flex_shrink_0()
                    .min_w(px(AVATAR_SM))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(leading)
                    .into_any_element(),
            );
        }
        children.push(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    type_text(weight, self.primary.clone())
                        .truncate()
                        .text_color(paint.primary),
                )
                .children(self.secondary.clone().map(|secondary| {
                    type_text(t::TEXT_META, secondary)
                        .truncate()
                        .text_color(paint.secondary)
                }))
                .into_any_element(),
        );
        if let Some(end) = end {
            children.push(div().flex_shrink_0().flex().child(end).into_any_element());
        }
        let main = if let Some(handler) = self.on_click.filter(|_| !self.disabled) {
            let (pressed, ring) = (paint.pressed, paint.ring);
            // The ring is a constant-width border, so a selected row's text does not shift.
            let ring_width = BORDER_FOCUS;
            let button = base::Button::new(self.id.clone())
                .selected(self.selected)
                .accessibility_label(name)
                .when_some(self.focus.as_ref(), |button, focus| {
                    button.track_focus(focus)
                })
                .when_some(self.tab_stop, |button, stop| button.tab_stop(stop))
                .when_some(description, |button, description| {
                    button.aria_description(description)
                })
                .rounded(px(radius))
                .border(px(ring_width))
                .border_color(transparent_black())
                .cursor_pointer()
                .when(!working, |button| {
                    button
                        .active(move |style| style.bg(pressed))
                        .on_click(move |_, window, cx| handler(window, cx))
                })
                .focus_visible(move |style| style.border_color(ring));
            lay_out(button, has_trailing, children).into_any_element()
        } else if interactive {
            // A disabled button: out of reach of the mouse and the keyboard.
            let button = base::Button::new(self.id.clone())
                .disabled(true)
                .accessibility_label(name)
                .rounded(px(radius))
                .border(px(BORDER_FOCUS))
                .border_color(transparent_black());
            lay_out(button, has_trailing, children).into_any_element()
        } else {
            lay_out(
                div()
                    .id(self.id.clone())
                    .test_support()
                    .aria_label(name)
                    .border(px(BORDER_FOCUS))
                    .border_color(transparent_black()),
                has_trailing,
                children,
            )
            .into_any_element()
        };
        let hover = paint.hover;
        div()
            .w_full()
            .min_w_0()
            .min_h(px(height))
            .flex()
            .items_center()
            .rounded(px(radius))
            .text_color(paint.ink)
            .when_some(paint.background, |row, background| row.bg(background))
            .when(interactive && !self.disabled, |row| {
                row.hover(move |style| style.bg(hover))
            })
            .when(self.disabled, |row| row.opacity(STATE_DISABLED))
            .child(main)
            .children(self.trailing.map(|trailing| {
                div()
                    .flex_none()
                    .min_w_0()
                    .max_w(relative(0.5))
                    .pr(px(SPACE_MD))
                    .flex()
                    .items_center()
                    .gap(px(SPACE_XS))
                    .child(trailing)
            }))
    }
}

/// The row's main part: the link or button (or plain content) beside the trailing slot. Its
/// padding is the row's, so a press on it counts.
fn lay_out<E: Styled + ParentElement>(
    element: E,
    has_trailing: bool,
    children: Vec<AnyElement>,
) -> E {
    element
        .flex_1()
        .min_w_0()
        .self_stretch()
        .flex()
        .items_center()
        .gap(px(SPACE_SM))
        .pl(px(SPACE_XS))
        .pr(px(if has_trailing { SPACE_SM } else { SPACE_MD }))
        .children(children)
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

/// Which edge a column's cells line up with. Use `End` for numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Align {
    #[default]
    Start,
    End,
}

/// One column of a [`Table`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableColumn {
    pub id: SharedString,
    pub header: SharedString,
    pub align: Align,
}

impl TableColumn {
    pub fn new(id: impl Into<SharedString>, header: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            header: header.into(),
            align: Align::Start,
        }
    }

    pub fn align(mut self, align: Align) -> Self {
        self.align = align;
        self
    }
}

/// One record of a [`Table`]: a cell for each column id, text or kit pieces (a Pill, an
/// IconButton).
pub struct TableRow {
    pub id: SharedString,
    cells: Vec<(SharedString, AnyElement)>,
}

impl TableRow {
    pub fn new(id: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            cells: Vec::new(),
        }
    }

    pub fn cell(mut self, column: impl Into<SharedString>, content: impl IntoElement) -> Self {
        self.cells.push((column.into(), content.into_any_element()));
        self
    }

    /// A cell of plain text.
    pub fn text(self, column: impl Into<SharedString>, content: impl Into<SharedString>) -> Self {
        let content: SharedString = content.into();
        let column: SharedString = column.into();
        // Named by its text, so assistive technology (and a test) reads the cell.
        let cell = div()
            .id(ElementId::Name(column.clone()))
            .test_support()
            .aria_label(content.clone())
            .child(content);
        self.cell(column, cell)
    }

    fn take(&mut self, column: &str) -> Option<AnyElement> {
        let at = self
            .cells
            .iter()
            .position(|(id, _)| id.as_ref() == column)?;
        Some(self.cells.remove(at).1)
    }
}

/// Records in rows, one column per kind of fact, as the web kit's Table: a hairline between rows,
/// no stripes, no outer border; the header in `text.meta` at the strong weight and the secondary
/// text colour. Too wide for its space, it scrolls sideways inside its own box, which takes
/// keyboard focus so a keyboard can scroll it. It is not virtual (the web's tables aren't either).
#[derive(IntoElement)]
pub struct Table {
    id: ElementId,
    label: SharedString,
    columns: Vec<TableColumn>,
    rows: Vec<TableRow>,
    empty: Option<SharedString>,
    min_width: Option<Pixels>,
}

impl Table {
    pub fn new(
        label: impl Into<SharedString>,
        columns: Vec<TableColumn>,
        rows: Vec<TableRow>,
    ) -> Self {
        Self {
            id: "table".into(),
            label: label.into(),
            columns,
            rows,
            empty: None,
            min_width: None,
        }
    }

    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = id.into();
        self
    }

    /// Shown across the whole table when there are no rows.
    pub fn empty(mut self, empty: impl Into<SharedString>) -> Self {
        self.empty = Some(empty.into());
        self
    }

    /// The width below which the table scrolls sideways instead of squeezing its columns.
    pub fn min_width(mut self, width: Pixels) -> Self {
        self.min_width = Some(width);
        self
    }
}

impl RenderOnce for Table {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let (hairline, text_colour, secondary, focus) = (
            sem.role.hairline,
            sem.role.text,
            sem.role.text_secondary,
            sem.role.focus,
        );
        let handle = window
            .use_keyed_state(self.id.clone(), cx, |_, cx| {
                cx.focus_handle().tab_stop(true)
            })
            .read(cx)
            .clone();
        let cell = |align: Align| {
            div()
                .flex_1()
                .min_w_0()
                .p(px(SPACE_MD))
                .flex()
                .items_center()
                .when(align == Align::End, |cell| cell.justify_end())
        };
        let header = div()
            .flex()
            .w_full()
            .border_b(px(BORDER_HAIRLINE))
            .border_color(hairline)
            .text_color(secondary)
            .id("table-head")
            .role(Role::Row)
            .children(self.columns.iter().enumerate().map(|(at, column)| {
                cell(column.align)
                    .id(("table-head-cell", at))
                    .role(Role::ColumnHeader)
                    .child(
                        type_text(t::TEXT_META, column.header.clone())
                            .font_weight(FontWeight(t::TEXT_BODY_STRONG.weight as f32))
                            .truncate(),
                    )
            }));
        let body: Vec<AnyElement> = if self.rows.is_empty()
            && let Some(empty) = self.empty
        {
            vec![
                div()
                    .id("table-empty")
                    .test_support()
                    .w_full()
                    .px(px(SPACE_MD))
                    .py(px(SPACE_XL))
                    .flex()
                    .justify_center()
                    .text_color(secondary)
                    .child(type_text(t::TEXT_BODY, empty))
                    .into_any_element(),
            ]
        } else {
            let columns = self.columns.clone();
            self.rows
                .into_iter()
                .enumerate()
                .map(|(index, mut row)| {
                    div()
                        .id(("table-row", index))
                        .flex()
                        .w_full()
                        .border_b(px(BORDER_HAIRLINE))
                        .border_color(hairline)
                        .text_color(text_colour)
                        .role(Role::Row)
                        .children(columns.iter().enumerate().map(|(at, column)| {
                            let content = row.take(&column.id);
                            cell(column.align)
                                .id(("table-cell", at))
                                .role(Role::Cell)
                                .child(
                                    div()
                                        .min_w_0()
                                        .font_family(t::TEXT_BODY.family)
                                        .text_size(px(t::TEXT_BODY.size))
                                        .line_height(px(t::TEXT_BODY.line_height))
                                        .truncate()
                                        .children(content),
                                )
                        }))
                        .into_any_element()
                })
                .collect()
        };
        div()
            .id(self.id)
            .test_support()
            .role(Role::Table)
            .aria_label(self.label)
            .track_focus(&handle)
            .w_full()
            .overflow_x_scroll()
            .border(px(BORDER_FOCUS))
            .border_color(transparent_black())
            .focus_visible(move |style| style.border_color(focus))
            .child(
                div()
                    .w_full()
                    .when_some(self.min_width, |table, width| table.min_w(width))
                    .flex()
                    .flex_col()
                    .child(header)
                    .children(body),
            )
    }
}
