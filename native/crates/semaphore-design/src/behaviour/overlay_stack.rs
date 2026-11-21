//! The overlay stack: the layers floating above a screen, in the order they opened.
//!
//! A direct port of the `overlayStack` reducers in `design/gen/behaviour_ref.py`; the rule
//! numbers below are that pattern's rules. Escape, a press outside, Tab and the system Back are
//! decided here, once, so no screen handles them by hand.

/// What a layer is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerKind {
    Tooltip,
    Menu,
    Popover,
    Dialog,
    Sheet,
}

/// One layer in the stack.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layer {
    pub id: String,
    pub kind: LayerKind,
    /// The layer that owns it: it closes with that layer.
    pub parent: Option<String>,
    /// The element that had focus when it opened.
    pub opener: Option<String>,
    /// The layer the opener is in; `None` for the screen.
    pub opener_layer: Option<String>,
}

/// Where focus is as a layer closes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseFocus {
    /// Inside the layer (or in a layer it owns).
    Inside,
    /// Lost: on the page body, or removed with the layer.
    Lost,
    /// The user moved it outside the layer.
    Outside,
}

/// The overlay stack's state: bottom first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub layers: Vec<Layer>,
}

/// Why a layer is asked to close.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    Escape,
    PressOutside,
    Scrim,
    Tab,
    Back,
    ParentClosed,
}

/// One thing that happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Open {
        layer: Layer,
    },
    /// The owner has closed the layer: whether its opener is still on the page and where focus
    /// is as it closes.
    Closed {
        id: String,
        opener_present: bool,
        focus: CloseFocus,
    },
    /// An input method is composing text, or the focused control uses Escape itself.
    Escape {
        composing: bool,
        focus_owns_escape: bool,
    },
    /// `inside_id` is the innermost layer the press landed in, or `None` for the screen. A press
    /// on a popover's anchor counts as inside the popover.
    PressOutside {
        inside_id: Option<String>,
    },
    Tab,
    /// The system Back: Android's Back gesture or button, a browser's Back while a layer is open.
    Back,
}

/// What the stack asks of its surroundings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    RequestClose {
        id: String,
        reason: CloseReason,
    },
    /// `to` is an element or layer id; `None` is the screen's own focus target.
    RestoreFocus {
        to: Option<String>,
    },
    /// The screen gets the key; this pattern only ever passes `Escape`.
    PassToScreen,
    /// Nothing under the tooltips took the Back: the platform goes back a screen.
    PassToPlatform,
}

/// The overlay stack has no settings.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Params;

pub fn initial(_params: &Params) -> State {
    State { layers: Vec::new() }
}

/// `layer_id` and the ids of the layers it was opened from, innermost first.
fn ancestors<'a>(layers: &'a [Layer], layer_id: Option<&'a str>) -> Vec<&'a str> {
    let mut chain: Vec<&str> = Vec::new();
    let mut current = layer_id;
    while let Some(id) = current {
        if chain.contains(&id) {
            break;
        }
        chain.push(id);
        current = layers
            .iter()
            .find(|layer| layer.id == id)
            .and_then(|layer| layer.parent.as_deref());
    }
    chain
}

/// The layers opened from `layer_id`, directly or not, topmost (innermost) first.
fn descendants<'a>(layers: &'a [Layer], layer_id: &str) -> Vec<&'a Layer> {
    layers
        .iter()
        .rev()
        .filter(|layer| {
            layer.id != layer_id && ancestors(layers, Some(layer.id.as_str())).contains(&layer_id)
        })
        .collect()
}

pub fn step(state: &State, event: &Event, _params: &Params) -> (State, Vec<Effect>) {
    let mut next = state.clone();
    let mut effects = Vec::new();

    match event {
        Event::Open { layer } => {
            // Rule 2: opening a layer whose id is already in the stack does nothing.
            if !next.layers.iter().any(|item| item.id == layer.id) {
                let mut layer = layer.clone();
                // Rule 19: a parent or openerLayer that is not in the stack is stored as null.
                for id in [&mut layer.parent, &mut layer.opener_layer] {
                    if id
                        .as_ref()
                        .is_some_and(|id| !next.layers.iter().any(|item| item.id == *id))
                    {
                        *id = None;
                    }
                }
                // Rule 1: layers stack in the order they open, and a tooltip always sits on
                // top: anything else goes just below the tooltips.
                let mut at = next.layers.len();
                if layer.kind != LayerKind::Tooltip {
                    while at > 0 && next.layers[at - 1].kind == LayerKind::Tooltip {
                        at -= 1;
                    }
                }
                next.layers.insert(at, layer);
            }
        }
        Event::Escape {
            composing,
            focus_owns_escape,
        } => {
            // Rule 18: Escape during composition never reaches the stack, and a focused
            // control that owns Escape gets it first.
            if !*composing && !*focus_owns_escape {
                // Rule 4: a tooltip takes the Escape: every tooltip is asked to close,
                // topmost first, and the key goes no further.
                let tooltips: Vec<&Layer> = next
                    .layers
                    .iter()
                    .rev()
                    .filter(|layer| layer.kind == LayerKind::Tooltip)
                    .collect();
                if !tooltips.is_empty() {
                    for layer in tooltips {
                        effects.push(Effect::RequestClose {
                            id: layer.id.clone(),
                            reason: CloseReason::Escape,
                        });
                    }
                } else if let Some(top) = next
                    .layers
                    .iter()
                    .rev()
                    .find(|layer| layer.kind != LayerKind::Tooltip)
                {
                    // Rule 3: Escape asks the topmost layer to close, one layer per Escape.
                    effects.push(Effect::RequestClose {
                        id: top.id.clone(),
                        reason: CloseReason::Escape,
                    });
                } else {
                    // Rule 5: with nothing open, the screen gets the key.
                    effects.push(Effect::PassToScreen);
                }
            }
        }
        Event::PressOutside { inside_id } => {
            // Rule 6: a press is inside a layer when it lands in it or in any layer opened
            // from it, however deep.
            let inside = ancestors(&state.layers, inside_id.as_deref());
            for layer in state.layers.iter().rev() {
                if inside.contains(&layer.id.as_str()) {
                    break;
                }
                match layer.kind {
                    // Rule 10: presses never close a tooltip.
                    LayerKind::Tooltip => continue,
                    // Rule 7: a press outside a popover asks it to close and carries on below.
                    LayerKind::Popover => effects.push(Effect::RequestClose {
                        id: layer.id.clone(),
                        reason: CloseReason::PressOutside,
                    }),
                    // Rule 8: a press outside a menu asks it to close and goes no further.
                    LayerKind::Menu => {
                        effects.push(Effect::RequestClose {
                            id: layer.id.clone(),
                            reason: CloseReason::PressOutside,
                        });
                        break;
                    }
                    // Rule 9: a press outside a dialog or a sheet is a press on its scrim.
                    LayerKind::Dialog | LayerKind::Sheet => {
                        effects.push(Effect::RequestClose {
                            id: layer.id.clone(),
                            reason: CloseReason::Scrim,
                        });
                        break;
                    }
                }
            }
        }
        Event::Back => {
            // Rule 20: a tooltip never takes the Back: every tooltip is asked to close, topmost
            // first, and the Back carries on.
            for layer in next.layers.iter().rev() {
                if layer.kind == LayerKind::Tooltip {
                    effects.push(Effect::RequestClose {
                        id: layer.id.clone(),
                        reason: CloseReason::Back,
                    });
                }
            }
            match next
                .layers
                .iter()
                .rev()
                .find(|layer| layer.kind != LayerKind::Tooltip)
            {
                // Rule 20: Back asks the topmost layer under the tooltips to close, one per Back.
                Some(layer) => effects.push(Effect::RequestClose {
                    id: layer.id.clone(),
                    reason: CloseReason::Back,
                }),
                // Rule 21: with no layer open under the tooltips, the platform goes back.
                None => effects.push(Effect::PassToPlatform),
            }
        }
        Event::Tab => {
            // Rule 11: Tab closes a menu that is topmost under the tooltips; otherwise nothing.
            let top = next
                .layers
                .iter()
                .rev()
                .find(|layer| layer.kind != LayerKind::Tooltip);
            if let Some(layer) = top
                && layer.kind == LayerKind::Menu
            {
                effects.push(Effect::RequestClose {
                    id: layer.id.clone(),
                    reason: CloseReason::Tab,
                });
            }
        }
        Event::Closed {
            id,
            opener_present,
            focus,
        } => {
            // Rule 12: a layer leaves the stack only when its owner reports closed.
            if let Some(at) = state.layers.iter().position(|layer| layer.id == *id) {
                let target = &state.layers[at];
                // Rule 13: the layers it owns are told to close (a command), innermost first,
                // and leave with it.
                let children = descendants(&state.layers, &target.id);
                for child in &children {
                    effects.push(Effect::RequestClose {
                        id: child.id.clone(),
                        reason: CloseReason::ParentClosed,
                    });
                }
                let gone: Vec<&Layer> = std::iter::once(target)
                    .chain(children.iter().copied())
                    .collect();
                let above = &state.layers[at + 1..];
                next.layers = state
                    .layers
                    .iter()
                    .filter(|layer| !gone.iter().any(|item| item.id == layer.id))
                    .cloned()
                    .collect();
                // Rule 17: a layer whose opener was inside a closed layer takes over that
                // layer's opener and openerLayer. Each step consumes one closed layer, so a
                // chain longer than `gone` can only repeat one.
                for layer in &mut next.layers {
                    for _ in 0..gone.len() {
                        let Some(source) = layer
                            .opener_layer
                            .as_deref()
                            .and_then(|id| gone.iter().find(|item| item.id == id))
                        else {
                            break;
                        };
                        layer.opener = source.opener.clone();
                        layer.opener_layer = source.opener_layer.clone();
                    }
                }
                // Rule 16: never restore focus beneath a dialog or sheet that is still open.
                let remaining: Vec<&str> =
                    next.layers.iter().map(|layer| layer.id.as_str()).collect();
                let under_modal = above.iter().any(|layer| {
                    matches!(layer.kind, LayerKind::Dialog | LayerKind::Sheet)
                        && remaining.contains(&layer.id.as_str())
                });
                if target.kind != LayerKind::Tooltip
                    && !under_modal
                    && matches!(focus, CloseFocus::Inside | CloseFocus::Lost)
                {
                    // Rule 14: focus inside the layer or lost goes to the opener if it is
                    // still on the page, else the layer the opener was in, else the screen.
                    let to = if *opener_present && target.opener.is_some() {
                        target.opener.clone()
                    } else if target
                        .opener_layer
                        .as_deref()
                        .is_some_and(|layer| remaining.contains(&layer))
                    {
                        target.opener_layer.clone()
                    } else {
                        None
                    };
                    effects.push(Effect::RestoreFocus { to });
                }
                // Rule 14: focus the user moved outside the layer stays where it is.
            }
            // Rule 15: a closed event for an id not in the stack does nothing.
        }
    }

    (next, effects)
}
