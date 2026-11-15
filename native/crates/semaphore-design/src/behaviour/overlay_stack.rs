//! The overlay stack: the layers floating above a screen, in the order they opened.
//!
//! A direct port of the `overlayStack` reducers in `design/gen/behaviour_ref.py`; the rule
//! numbers below are that pattern's rules. Escape, a press outside and Tab are decided here,
//! once, so no screen handles them by hand.

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
    /// The layer it opened from.
    pub parent: Option<String>,
    /// The element that had focus when it opened.
    pub opener: Option<String>,
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
    ParentClosed,
}

/// One thing that happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Open {
        layer: Layer,
    },
    /// The owner has closed the layer, and whether its opener is still on the page.
    Closed {
        id: String,
        opener_present: bool,
    },
    Escape,
    /// `inside_id` is the innermost layer the press landed in, or `None` for the screen. A press
    /// on a popover's anchor counts as inside the popover.
    PressOutside {
        inside_id: Option<String>,
    },
    Tab,
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
                // Rule 1: layers stack in the order they open, and a tooltip always sits on
                // top: anything else goes just below the tooltips.
                let mut at = next.layers.len();
                if layer.kind != LayerKind::Tooltip {
                    while at > 0 && next.layers[at - 1].kind == LayerKind::Tooltip {
                        at -= 1;
                    }
                }
                next.layers.insert(at, layer.clone());
            }
        }
        Event::Escape => {
            // Rule 4: tooltips never block Escape: each is asked to close, topmost first, and
            // Escape then acts as if they were not there.
            for layer in next.layers.iter().rev() {
                if layer.kind == LayerKind::Tooltip {
                    effects.push(Effect::RequestClose {
                        id: layer.id.clone(),
                        reason: CloseReason::Escape,
                    });
                }
            }
            match next
                .layers
                .iter()
                .rev()
                .find(|layer| layer.kind != LayerKind::Tooltip)
            {
                // Rule 3: Escape asks the topmost layer to close, one layer per Escape.
                Some(layer) => effects.push(Effect::RequestClose {
                    id: layer.id.clone(),
                    reason: CloseReason::Escape,
                }),
                // Rule 5: with nothing (else) open, the screen gets the key.
                None => effects.push(Effect::PassToScreen),
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
        Event::Closed { id, opener_present } => {
            // Rule 12: a layer leaves the stack only when its owner reports closed.
            if let Some(target) = state.layers.iter().find(|layer| layer.id == *id) {
                // Rule 13: layers opened from it are asked to close first, innermost first,
                // one requestClose each, and leave with it.
                let children = descendants(&state.layers, &target.id);
                for child in &children {
                    effects.push(Effect::RequestClose {
                        id: child.id.clone(),
                        reason: CloseReason::ParentClosed,
                    });
                }
                let gone: Vec<&str> = std::iter::once(target.id.as_str())
                    .chain(children.iter().map(|child| child.id.as_str()))
                    .collect();
                next.layers = state
                    .layers
                    .iter()
                    .filter(|layer| !gone.contains(&layer.id.as_str()))
                    .cloned()
                    .collect();
                // Rule 15: closing a tooltip moves no focus.
                if target.kind != LayerKind::Tooltip {
                    // Rule 14: focus goes to the opener if it is still on the page, else to the
                    // layer it opened from, else to the screen (null).
                    let to =
                        if *opener_present && target.opener.is_some() {
                            target.opener.clone()
                        } else if target.parent.as_ref().is_some_and(|parent| {
                            next.layers.iter().any(|layer| layer.id == *parent)
                        }) {
                            target.parent.clone()
                        } else {
                            None
                        };
                    effects.push(Effect::RestoreFocus { to });
                }
            }
            // Rule 15: a closed event for an id not in the stack does nothing.
        }
    }

    (next, effects)
}
