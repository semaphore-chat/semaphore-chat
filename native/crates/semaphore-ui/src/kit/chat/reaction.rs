//! `ReactionChip`: one reaction under a message (`frontend/src/kit/chat/ReactionChip.tsx`).

use crate::kit::Action;
use crate::kit::controls::Availability;
use crate::kit::look::{focus_handle, outer_focus_ring, shows_focus};
use crate::kit::surface::{Surface, stand_out_token, tint_base_token};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::accesskit::Toggled;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::chat::{drawn_reaction_count, reaction_name};
use semaphore_design::lounge::{
    BORDER_SELECTED, CONTROL_SM, ICON_MD, RADIUS_FULL, SPACE_MD, SPACE_SM, SPACE_XS,
    STATE_DISABLED, STATE_HOVER, STATE_HOVER_ON_FILL, STATE_PRESSED, TEXT_BODY_STRONG, TEXT_META,
};
use std::cell::Cell;
use std::rc::Rc;

/// One reaction: the emoji and how many reacted with it. A toggle button, pressed when it is the
/// reader's, named "Laugh reaction, 4" so the emoji is never the only clue.
#[derive(IntoElement)]
pub struct ReactionChip {
    id: ElementId,
    emoji: SharedString,
    src: Option<ImageSource>,
    label: SharedString,
    count: u64,
    mine: bool,
    unavailable: bool,
    busy: bool,
    on: Option<Surface>,
    on_toggle: Option<Action>,
    on_unavailable_press: Option<Action>,
    on_show_people: Option<Action>,
}

impl ReactionChip {
    /// `emoji` as text (`😂`); for a custom emoji give `src` and its `:name:` here as the fallback.
    /// `label` says what it is in words ("Laugh", "partyparrot").
    pub fn new(
        id: impl Into<ElementId>,
        emoji: impl Into<SharedString>,
        label: impl Into<SharedString>,
        count: u64,
    ) -> Self {
        Self {
            id: id.into(),
            emoji: emoji.into(),
            src: None,
            label: label.into(),
            count,
            mine: false,
            unavailable: false,
            busy: false,
            on: None,
            on_toggle: None,
            on_unavailable_press: None,
            on_show_people: None,
        }
    }

    /// A custom emoji's image. When it cannot be drawn, `emoji` is shown.
    pub fn src(mut self, src: ImageSource) -> Self {
        self.src = Some(src);
        self
    }

    /// The reader has reacted with it: pressed, and drawn in the accent with a ring.
    pub fn mine(mut self, mine: bool) -> Self {
        self.mine = mine;
        self
    }

    /// Adds or removes the reader's reaction.
    pub fn on_toggle(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }

    /// `aria-disabled`: the reader may not react here. Still focusable and named, reads as
    /// unavailable; a press calls `on_unavailable_press` (say why) instead of toggling.
    pub fn unavailable(mut self, unavailable: bool) -> Self {
        self.unavailable = unavailable;
        self
    }

    pub fn on_unavailable_press(
        mut self,
        handler: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_unavailable_press = Some(Rc::new(handler));
        self
    }

    /// The toggle is on its way: busy, presses ignored, focus stays.
    pub fn busy(mut self, busy: bool) -> Self {
        self.busy = busy;
        self
    }

    /// Shows who reacted with it. Asked for by a right-click, or the context-menu key or Shift+F10
    /// on the chip, never by a plain press. Works on an unavailable or busy chip too.
    pub fn on_show_people(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_show_people = Some(Rc::new(handler));
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

/// Whether a key asks for the chip's (or a row's) context menu: the Menu key or Shift+F10.
pub(crate) fn is_context_menu_key(keystroke: &Keystroke) -> bool {
    let m = keystroke.modifiers;
    match keystroke.key.as_str() {
        "menu" | "contextmenu" | "apps" => !m.control && !m.alt && !m.platform,
        "f10" => m.shift && !m.control && !m.alt && !m.platform,
        _ => false,
    }
}

impl RenderOnce for ReactionChip {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let row_tab = super::RowTabScope::active(cx);
        let sem = cx.sem().clone();
        let p = sem.roles;
        let on = Surface::or_current(self.on, cx);
        let state = Availability::of(false, self.busy, self.unavailable);
        let rest = if self.mine {
            blend(p.accent, tint_base_token(&p, on), STATE_HOVER_ON_FILL)
        } else {
            stand_out_token(&p, on)
        };
        let hover = hsla_of(blend(p.text, rest, STATE_HOVER));
        let pressed = hsla_of(blend(p.text, rest, STATE_PRESSED));
        let ink = if self.mine {
            sem.role.accent_text
        } else {
            sem.role.text_secondary
        };
        let focus = focus_handle(&self.id, window, cx);
        // Whether the key now pressing it is held (auto-repeat): an unavailable chip says why once.
        let repeating = window
            .use_keyed_state(super::child_id(&self.id, "repeat"), cx, |_, _| {
                Rc::new(Cell::new(false))
            })
            .read(cx)
            .clone();
        let ring = shows_focus(&focus, window);
        let acts = state.acts();

        let emoji_text = self.emoji.clone();
        let emoji: AnyElement = match self.src {
            Some(src) => img(src)
                .h(px(ICON_MD))
                .min_w(px(ICON_MD))
                .object_fit(ObjectFit::Contain)
                .with_fallback(move || {
                    div()
                        .whitespace_nowrap()
                        .text_size(px(ICON_MD))
                        .line_height(px(ICON_MD))
                        .child(emoji_text.clone())
                        .into_any_element()
                })
                .into_any_element(),
            None => div()
                .text_size(px(ICON_MD))
                .line_height(px(ICON_MD))
                .child(self.emoji)
                .into_any_element(),
        };

        let on_toggle = self.on_toggle;
        let on_unavailable = self.on_unavailable_press;
        let busy = state.busy;
        let unavailable = state.unavailable;
        let people_mouse = self.on_show_people.clone();
        let people_key = self.on_show_people;
        let (repeat_click, repeat_down, repeat_up) =
            (repeating.clone(), repeating.clone(), repeating);
        base::Button::new(self.id)
            .when(!row_tab, |button| button.tab_stop(false))
            .track_focus(&focus)
            .aria_toggled(if self.mine {
                Toggled::True
            } else {
                Toggled::False
            })
            .accessibility_label(reaction_name(&self.label, self.count))
            .when_some(state.announcement(), |chip, said| {
                chip.aria_description(said)
            })
            .relative()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(SPACE_XS))
            .h(px(CONTROL_SM))
            .pl(px(SPACE_SM))
            .pr(px(SPACE_MD))
            .rounded(px(RADIUS_FULL))
            .border(px(BORDER_SELECTED))
            .border_color(if self.mine {
                sem.role.accent
            } else {
                transparent_black()
            })
            .bg(hsla_of(rest))
            .text_color(ink)
            .text_size(px(TEXT_META.size))
            .line_height(px(TEXT_META.line_height))
            .font_weight(FontWeight(TEXT_BODY_STRONG.weight as f32))
            .when(unavailable, |chip| chip.opacity(STATE_DISABLED))
            .when(acts, |chip| {
                chip.cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .active(move |style| style.bg(pressed))
            })
            .on_click(move |event, window, cx| {
                if busy {
                    return;
                }
                if unavailable {
                    // A held key clicks on each repeat: say why once per press.
                    let repeat = matches!(event, ClickEvent::Keyboard(_)) && repeat_click.get();
                    if !repeat && let Some(handler) = &on_unavailable {
                        handler(window, cx);
                    }
                    return;
                }
                if let Some(handler) = &on_toggle {
                    handler(window, cx);
                }
            })
            .when_some(people_mouse, |chip, handler| {
                chip.on_mouse_down(MouseButton::Right, move |_, window, cx| {
                    // The chip's, not the row's (whose actions would open).
                    cx.stop_propagation();
                    handler(window, cx);
                })
            })
            .on_key_down(move |event, window, cx| {
                repeat_down.set(event.is_held);
                if is_context_menu_key(&event.keystroke)
                    && let Some(handler) = &people_key
                {
                    cx.stop_propagation();
                    handler(window, cx);
                }
            })
            .on_key_up(move |_, _, _| repeat_up.set(false))
            .when(ring, |chip| chip.child(outer_focus_ring(&p, RADIUS_FULL)))
            .child(div().flex().items_center().child(emoji))
            .child(div().child(drawn_reaction_count(self.count)))
    }
}
