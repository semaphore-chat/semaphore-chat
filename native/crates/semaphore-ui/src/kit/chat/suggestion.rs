//! `SuggestionList`: the suggestions a composer offers while the reader types a mention
//! (`frontend/src/kit/chat/SuggestionList.tsx`).

use super::{child_id, one_line};
use crate::kit::overlays::overlay_surface;
use crate::kit::{Avatar, AvatarSize, Icon, IconSize, Spinner};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::chat::SUGGESTIONS_SHOWN;
use semaphore_design::lounge::{
    AVATAR_SM, CONTROL_LG, RADIUS_MD, SPACE_MD, SPACE_SM, SPACE_XS, STATE_HOVER, STATE_PRESSED,
    TEXT_BODY, TEXT_SMALL,
};
use semaphore_design::{LoungeIcon, Rgba};
use std::cell::Cell;
use std::rc::Rc;

/// One suggestion: what is inserted, a quieter second line, and an avatar (a person) or an icon
/// (anything else: a group, `@here`).
#[derive(Clone)]
pub struct Suggestion {
    key: SharedString,
    label: SharedString,
    detail: Option<SharedString>,
    avatar: Option<(Option<ImageSource>, Option<Rgba>)>,
    file: Option<SharedString>,
    icon: Option<LoungeIcon>,
}

impl Suggestion {
    /// `key` is stable across renders; `label` is what is inserted, as read ("aiko", "here").
    pub fn new(key: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            detail: None,
            avatar: None,
            file: None,
            icon: None,
        }
    }

    /// "Aiko Tanaka", "Notify online members in this channel", "4 members".
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// A person: their avatar, the picture if there is one, initials from the label otherwise.
    pub fn avatar(mut self, src: Option<ImageSource>, colour: Option<Rgba>) -> Self {
        self.avatar = Some((src, colour));
        self
    }

    /// The person's avatar file, drawn through the app's `AvatarImages` once it has it.
    pub fn avatar_file(mut self, file_id: Option<&str>) -> Self {
        self.file = file_id.map(|id| SharedString::from(id.to_owned()));
        self
    }

    /// Anything else: an icon in the avatar's place (the at sign when none is given).
    pub fn icon(mut self, icon: LoungeIcon) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn key(&self) -> &SharedString {
        &self.key
    }
}

type PickHandler = Rc<dyn Fn(usize, &mut Window, &mut App)>;

/// The suggestions a composer offers (its `suggestions`): a listbox the field drives. Focus never
/// leaves the field: ↑ and ↓ move the highlight (`active_index`), Enter or Tab picks and Escape
/// closes, all in the screen's keys (Composer's `on_key`). A press on an option picks it without
/// taking focus from the field. Six rows show, then it scrolls, and the active row is kept in
/// view.
#[derive(IntoElement)]
pub struct SuggestionList {
    id: ElementId,
    label: SharedString,
    options: Vec<Suggestion>,
    active_index: Option<usize>,
    on_pick: Option<PickHandler>,
    loading: bool,
}

impl SuggestionList {
    /// `label` names the list ("Mention suggestions"); `active_index` is the highlighted option.
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        options: Vec<Suggestion>,
        active_index: Option<usize>,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            options,
            active_index,
            on_pick: None,
            loading: false,
        }
    }

    /// An option was pressed.
    pub fn on_pick(mut self, handler: impl Fn(usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_pick = Some(Rc::new(handler));
        self
    }

    /// The options are still loading: with none yet, a spinner row, "Loading…".
    pub fn loading(mut self, loading: bool) -> Self {
        self.loading = loading;
        self
    }
}

/// The scroll of the list and the highlight it last kept in view.
struct Kept {
    scroll: ScrollHandle,
    shown: Cell<Option<usize>>,
}

impl RenderOnce for SuggestionList {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let p = sem.roles;
        let secondary = sem.role.text_secondary;
        let kept = window
            .use_keyed_state(child_id(&self.id, "kept"), cx, |_, _| {
                Rc::new(Kept {
                    scroll: ScrollHandle::new(),
                    shown: Cell::new(None),
                })
            })
            .read(cx)
            .clone();
        let active = self
            .active_index
            .filter(|index| *index < self.options.len());
        // GPUI keeps an item in view only once the list has been laid out (its first frame
        // has no bounds yet), so until then the request is made again, and one more frame is
        // asked for: otherwise nothing would draw the frame that lays it out.
        let laid_out = kept.scroll.bounds().size.height > px(0.);
        if let Some(index) = active
            && (kept.shown.get() != active || !laid_out)
        {
            kept.scroll.scroll_to_item(index);
            if !laid_out {
                window.request_animation_frame();
            }
        }
        kept.shown.set(if laid_out { active } else { None });

        let hover = hsla_of(blend(p.text, p.surface, STATE_HOVER));
        let selected_fill = hsla_of(blend(p.accent, p.surface, STATE_PRESSED));
        let option = |id: ElementId| {
            base::Button::new(id)
                .role(Role::ListBoxOption)
                // The field keeps focus (and a phone its keyboard): typing goes on narrowing it.
                .focusable(false)
                .flex_none()
                .w_full()
                .flex()
                .items_center()
                .justify_start()
                .gap(px(SPACE_SM))
                .min_w_0()
                .min_h(px(CONTROL_LG))
                .px(px(SPACE_MD))
                .rounded(px(RADIUS_MD))
                .text_color(sem.role.text)
        };
        let leading = |child: AnyElement| {
            div()
                .flex_none()
                .size(px(AVATAR_SM))
                .flex()
                .items_center()
                .justify_center()
                .child(child)
        };

        let count = self.options.len();
        let rows: Vec<AnyElement> =
            if self.loading && count == 0 {
                vec![
                    option(child_id(&self.id, "loading"))
                        .accessibility_label("Loading…")
                        .aria_selected(false)
                        .disabled(true)
                        .child(leading(
                            Spinner::new(child_id(&self.id, "spinner"))
                                .size(IconSize::Sm)
                                .into_any_element(),
                        ))
                        .child(one_line(TEXT_BODY, "Loading…"))
                        .into_any_element(),
                ]
            } else {
                self.options
                    .into_iter()
                    .enumerate()
                    .map(|(index, suggestion)| {
                        let selected = Some(index) == active;
                        let on_pick = self.on_pick.clone();
                        let mark = match (suggestion.avatar, suggestion.icon) {
                            (Some((src, colour)), _) => Avatar::new(suggestion.label.clone())
                                .size(AvatarSize::Sm)
                                .image(src)
                                .file(suggestion.file.as_deref())
                                .colour(colour)
                                .decorative(true)
                                .into_any_element(),
                            (None, icon) => Icon::lounge(icon.unwrap_or(LoungeIcon::AtSign))
                                .size(IconSize::Sm.px())
                                .color(secondary)
                                .into_any_element(),
                        };
                        let name = match &suggestion.detail {
                            Some(detail) => format!("{}, {detail}", suggestion.label),
                            None => suggestion.label.to_string(),
                        };
                        option(ElementId::NamedChild(
                            std::sync::Arc::new(self.id.clone()),
                            suggestion.key.clone(),
                        ))
                        .accessibility_label(name)
                        .aria_selected(selected)
                        .aria_position_in_set(index + 1)
                        .aria_size_of_set(count)
                        .cursor_pointer()
                        .when(selected, |row| row.bg(selected_fill))
                        .when(!selected, |row| row.hover(move |style| style.bg(hover)))
                        .on_click(move |_, window, cx| {
                            if let Some(on_pick) = &on_pick {
                                on_pick(index, window, cx);
                            }
                        })
                        .child(leading(mark))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .child(one_line(TEXT_BODY, suggestion.label))
                                .children(suggestion.detail.map(|detail| {
                                    one_line(TEXT_SMALL, detail).text_color(secondary)
                                })),
                        )
                        .into_any_element()
                    })
                    .collect()
            };

        overlay_surface(div(), &sem)
            .id(self.id)
            .test_support()
            .role(Role::ListBox)
            .aria_label(self.label)
            .when(self.loading, |list| list.aria_description("busy"))
            .occlude()
            .flex()
            .flex_col()
            .max_h(px(SUGGESTIONS_SHOWN as f32 * CONTROL_LG + 2. * SPACE_XS))
            .overflow_y_scroll()
            .track_scroll(&kept.scroll)
            .p(px(SPACE_XS))
            .children(rows)
    }
}
