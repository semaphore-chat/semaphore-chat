//! The behaviour ports against the shared vectors in `behaviour_vectors`.
//!
//! Every generated vector is replayed from its initial state and params; after each step the
//! port's state and ordered effects are serialised canonically and compared with the vector's
//! strings. The failing assertion names the pattern, the vector and the step index.

use crate::behaviour::canon::{self, Value};
use crate::behaviour::{confirm_destructive as confirm, list_focus as list, load_state as load};
use crate::behaviour::{overlay_stack as overlay, toast_queue as toast};
use crate::behaviour_vectors;

/// A pattern's port, as the vector runner needs it: the pure functions plus the canonical
/// mapping of its typed values.
trait Port {
    type State: Clone + PartialEq + std::fmt::Debug;
    type Event;
    type Effect;
    type Params: Default;

    const NAME: &'static str;

    fn initial(params: &Self::Params) -> Self::State;
    fn step(
        state: &Self::State,
        event: &Self::Event,
        params: &Self::Params,
    ) -> (Self::State, Vec<Self::Effect>);
    fn params_from_json(value: &Value) -> Result<Self::Params, String>;
    fn state_from_json(value: &Value) -> Result<Self::State, String>;
    fn event_from_json(value: &Value) -> Result<Self::Event, String>;
    fn params_to_json(params: &Self::Params) -> String;
    fn state_to_json(state: &Self::State) -> String;
    fn effects_to_json(effects: &[Self::Effect]) -> String;
}

fn generated(name: &str) -> &'static behaviour_vectors::Pattern {
    behaviour_vectors::PATTERNS
        .iter()
        .find(|pattern| pattern.name == name)
        .unwrap_or_else(|| panic!("no generated pattern named {name}"))
}

fn read<T>(context: &str, text: &str, from_json: impl FnOnce(&Value) -> Result<T, String>) -> T {
    let value = canon::parse(text).unwrap_or_else(|error| panic!("{context}: {error}: {text}"));
    from_json(&value).unwrap_or_else(|error| panic!("{context}: {error}: {text}"))
}

fn check_vectors<P: Port>() {
    let pattern = generated(P::NAME);
    for vector in pattern.vectors {
        let params = read(
            &format!("{} / \"{}\" / params", P::NAME, vector.name),
            vector.params,
            P::params_from_json,
        );
        let mut state = read(
            &format!("{} / \"{}\" / initial", P::NAME, vector.name),
            vector.initial,
            P::state_from_json,
        );
        for (index, step) in vector.steps.iter().enumerate() {
            let context = format!("{} / \"{}\" / step {index}", P::NAME, vector.name);
            let event = read(
                &format!("{context} / event {}", step.event),
                step.event,
                P::event_from_json,
            );
            let (next, effects) = P::step(&state, &event, &params);
            assert_eq!(
                P::state_to_json(&next),
                step.state,
                "{context}: state after {}",
                step.event
            );
            assert_eq!(
                P::effects_to_json(&effects),
                step.effects,
                "{context}: effects of {}",
                step.event
            );
            state = next;
        }
    }
}

fn check_step_does_not_mutate<P: Port>() {
    let pattern = generated(P::NAME);
    for vector in pattern.vectors {
        let params = read(
            &format!("{} / \"{}\" / params", P::NAME, vector.name),
            vector.params,
            P::params_from_json,
        );
        let mut state = read(
            &format!("{} / \"{}\" / initial", P::NAME, vector.name),
            vector.initial,
            P::state_from_json,
        );
        for (index, step) in vector.steps.iter().enumerate() {
            let context = format!("{} / \"{}\" / step {index}", P::NAME, vector.name);
            let event = read(
                &format!("{context} / event {}", step.event),
                step.event,
                P::event_from_json,
            );
            let before = state.clone();
            let (next, _) = P::step(&state, &event, &params);
            assert_eq!(state, before, "{context}: step mutated its input state");
            state = next;
        }
    }
}

fn check_default_params<P: Port>() {
    let pattern = generated(P::NAME);
    let defaults = P::Params::default();
    assert_eq!(
        P::params_to_json(&defaults),
        pattern.params,
        "{}: Params::default() is not the generated default params",
        P::NAME
    );
    assert_eq!(
        P::state_to_json(&P::initial(&defaults)),
        pattern.initial,
        "{}: initial state for the default params",
        P::NAME
    );
}

// ---------------------------------------------------------------------------
// toastQueue
// ---------------------------------------------------------------------------

fn toast_tone_text(tone: toast::Tone) -> &'static str {
    match tone {
        toast::Tone::Neutral => "neutral",
        toast::Tone::Positive => "positive",
        toast::Tone::Danger => "danger",
    }
}

fn toast_tone_from_text(text: &str) -> Result<toast::Tone, String> {
    match text {
        "neutral" => Ok(toast::Tone::Neutral),
        "positive" => Ok(toast::Tone::Positive),
        "danger" => Ok(toast::Tone::Danger),
        other => Err(format!("unknown tone {other:?}")),
    }
}

fn toast_politeness_text(politeness: toast::Politeness) -> &'static str {
    match politeness {
        toast::Politeness::Polite => "polite",
        toast::Politeness::Assertive => "assertive",
    }
}

fn toast_to_json(item: &toast::Toast) -> Value {
    Value::object([
        (
            "action",
            item.action.as_deref().map_or(Value::Null, Value::string),
        ),
        ("id", Value::string(&item.id)),
        ("message", Value::string(&item.message)),
        ("tone", Value::string(toast_tone_text(item.tone))),
    ])
}

fn toast_from_json(value: &Value) -> Result<toast::Toast, String> {
    Ok(toast::Toast {
        id: canon::text(value, "id")?.to_owned(),
        tone: toast_tone_from_text(canon::text(value, "tone")?)?,
        message: canon::text(value, "message")?.to_owned(),
        action: canon::optional_text(value, "action")?.map(str::to_owned),
    })
}

fn toast_state_to_json(state: &toast::State) -> String {
    canon::to_canonical(&Value::object([
        ("paused", Value::Bool(state.paused)),
        (
            "queue",
            Value::Array(state.queue.iter().map(toast_to_json).collect()),
        ),
        (
            "showing",
            state.showing.as_ref().map_or(Value::Null, toast_to_json),
        ),
        (
            "timer",
            state
                .timer
                .map_or(Value::Null, |token| Value::int(i64::from(token))),
        ),
        ("token", Value::int(i64::from(state.token))),
        (
            "waits",
            Value::Array(
                state
                    .waits
                    .iter()
                    .map(|wait| wait.map_or(Value::Null, |token| Value::int(i64::from(token))))
                    .collect(),
            ),
        ),
    ]))
}

/// A whole number that fits a `u32`, or null.
fn optional_token(value: &Value, what: &str) -> Result<Option<u32>, String> {
    match value {
        Value::Null => Ok(None),
        Value::Int(number) => u32::try_from(*number)
            .map(Some)
            .map_err(|_| format!("{what}: expected a u32, got {number}")),
        _ => Err(format!("{what}: expected a number or null")),
    }
}

fn toast_state_from_json(value: &Value) -> Result<toast::State, String> {
    Ok(toast::State {
        showing: match canon::field(value, "showing")? {
            Value::Null => None,
            showing => Some(toast_from_json(showing)?),
        },
        queue: canon::items(value, "queue")?
            .iter()
            .map(toast_from_json)
            .collect::<Result<_, String>>()?,
        waits: canon::items(value, "waits")?
            .iter()
            .map(|wait| optional_token(wait, "waits"))
            .collect::<Result<_, String>>()?,
        paused: canon::flag(value, "paused")?,
        token: canon::number(value, "token")?,
        timer: optional_token(canon::field(value, "timer")?, "timer")?,
    })
}

fn toast_event_from_json(value: &Value) -> Result<toast::Event, String> {
    let (name, fields) = canon::event(value)?;
    Ok(match name {
        "show" => toast::Event::Show {
            toast: toast_from_json(canon::field(fields, "toast")?)?,
        },
        "dismiss" => toast::Event::Dismiss {
            id: canon::text(fields, "id")?.to_owned(),
            focus_inside: canon::flag(fields, "focusInside")?,
        },
        "timerFired" => toast::Event::TimerFired {
            token: canon::number(fields, "token")?,
        },
        "pause" => toast::Event::Pause,
        "resume" => toast::Event::Resume,
        other => return Err(format!("unknown event {other:?}")),
    })
}

fn toast_effect_to_json(effect: &toast::Effect) -> Value {
    match effect {
        toast::Effect::StartTimer { token, ms } => Value::object([(
            "startTimer",
            Value::object([
                ("ms", Value::int(i64::from(*ms))),
                ("token", Value::int(i64::from(*token))),
            ]),
        )]),
        toast::Effect::CancelTimer { token } => Value::object([(
            "cancelTimer",
            Value::object([("token", Value::int(i64::from(*token)))]),
        )]),
        toast::Effect::Announce {
            message,
            politeness,
            action,
        } => Value::object([(
            "announce",
            Value::object([
                (
                    "action",
                    action.as_deref().map_or(Value::Null, Value::string),
                ),
                ("message", Value::string(message)),
                (
                    "politeness",
                    Value::string(toast_politeness_text(*politeness)),
                ),
            ]),
        )]),
        toast::Effect::ReturnFocus => Value::object([("returnFocus", Value::object([]))]),
    }
}

fn toast_effects_to_json(effects: &[toast::Effect]) -> String {
    canon::to_canonical(&Value::Array(
        effects.iter().map(toast_effect_to_json).collect(),
    ))
}

fn toast_params_from_json(value: &Value) -> Result<toast::Params, String> {
    Ok(toast::Params {
        duration_ms: canon::number(value, "durationMs")?,
        duration_with_action_ms: canon::number(value, "durationWithActionMs")?,
        max_queued: canon::count(value, "maxQueued")?,
        max_wait_ms: canon::number(value, "maxWaitMs")?,
    })
}

fn toast_params_to_json(params: &toast::Params) -> String {
    canon::to_canonical(&Value::object([
        ("durationMs", Value::int(i64::from(params.duration_ms))),
        (
            "durationWithActionMs",
            Value::int(i64::from(params.duration_with_action_ms)),
        ),
        (
            "maxQueued",
            Value::int(i64::try_from(params.max_queued).unwrap_or(i64::MAX)),
        ),
        ("maxWaitMs", Value::int(i64::from(params.max_wait_ms))),
    ]))
}

struct ToastQueue;

impl Port for ToastQueue {
    type State = toast::State;
    type Event = toast::Event;
    type Effect = toast::Effect;
    type Params = toast::Params;

    const NAME: &'static str = "toastQueue";

    fn initial(params: &Self::Params) -> Self::State {
        toast::initial(params)
    }

    fn step(
        state: &Self::State,
        event: &Self::Event,
        params: &Self::Params,
    ) -> (Self::State, Vec<Self::Effect>) {
        toast::step(state, event, params)
    }

    fn params_from_json(value: &Value) -> Result<Self::Params, String> {
        toast_params_from_json(value)
    }

    fn state_from_json(value: &Value) -> Result<Self::State, String> {
        toast_state_from_json(value)
    }

    fn event_from_json(value: &Value) -> Result<Self::Event, String> {
        toast_event_from_json(value)
    }

    fn params_to_json(params: &Self::Params) -> String {
        toast_params_to_json(params)
    }

    fn state_to_json(state: &Self::State) -> String {
        toast_state_to_json(state)
    }

    fn effects_to_json(effects: &[Self::Effect]) -> String {
        toast_effects_to_json(effects)
    }
}

#[test]
fn toast_queue_reproduces_every_vector() {
    check_vectors::<ToastQueue>();
}

#[test]
fn toast_queue_step_does_not_mutate_its_input() {
    check_step_does_not_mutate::<ToastQueue>();
}

#[test]
fn toast_queue_default_params_are_the_generated_ones() {
    check_default_params::<ToastQueue>();
}

// ---------------------------------------------------------------------------
// overlayStack
// ---------------------------------------------------------------------------

fn overlay_kind_text(kind: overlay::LayerKind) -> &'static str {
    match kind {
        overlay::LayerKind::Tooltip => "tooltip",
        overlay::LayerKind::Menu => "menu",
        overlay::LayerKind::Popover => "popover",
        overlay::LayerKind::Dialog => "dialog",
        overlay::LayerKind::Sheet => "sheet",
    }
}

fn overlay_kind_from_text(text: &str) -> Result<overlay::LayerKind, String> {
    match text {
        "tooltip" => Ok(overlay::LayerKind::Tooltip),
        "menu" => Ok(overlay::LayerKind::Menu),
        "popover" => Ok(overlay::LayerKind::Popover),
        "dialog" => Ok(overlay::LayerKind::Dialog),
        "sheet" => Ok(overlay::LayerKind::Sheet),
        other => Err(format!("unknown layer kind {other:?}")),
    }
}

fn overlay_reason_text(reason: overlay::CloseReason) -> &'static str {
    match reason {
        overlay::CloseReason::Escape => "escape",
        overlay::CloseReason::PressOutside => "pressOutside",
        overlay::CloseReason::Scrim => "scrim",
        overlay::CloseReason::Tab => "tab",
        overlay::CloseReason::ParentClosed => "parentClosed",
    }
}

fn overlay_focus_from_text(text: &str) -> Result<overlay::CloseFocus, String> {
    match text {
        "inside" => Ok(overlay::CloseFocus::Inside),
        "lost" => Ok(overlay::CloseFocus::Lost),
        "outside" => Ok(overlay::CloseFocus::Outside),
        other => Err(format!("unknown close focus {other:?}")),
    }
}

fn overlay_layer_to_json(layer: &overlay::Layer) -> Value {
    Value::object([
        ("id", Value::string(&layer.id)),
        ("kind", Value::string(overlay_kind_text(layer.kind))),
        (
            "opener",
            layer.opener.as_deref().map_or(Value::Null, Value::string),
        ),
        (
            "openerLayer",
            layer
                .opener_layer
                .as_deref()
                .map_or(Value::Null, Value::string),
        ),
        (
            "parent",
            layer.parent.as_deref().map_or(Value::Null, Value::string),
        ),
    ])
}

fn overlay_layer_from_json(value: &Value) -> Result<overlay::Layer, String> {
    Ok(overlay::Layer {
        id: canon::text(value, "id")?.to_owned(),
        kind: overlay_kind_from_text(canon::text(value, "kind")?)?,
        parent: canon::optional_text(value, "parent")?.map(str::to_owned),
        opener: canon::optional_text(value, "opener")?.map(str::to_owned),
        opener_layer: canon::optional_text(value, "openerLayer")?.map(str::to_owned),
    })
}

fn overlay_state_to_json(state: &overlay::State) -> String {
    canon::to_canonical(&Value::object([(
        "layers",
        Value::Array(state.layers.iter().map(overlay_layer_to_json).collect()),
    )]))
}

fn overlay_state_from_json(value: &Value) -> Result<overlay::State, String> {
    Ok(overlay::State {
        layers: canon::items(value, "layers")?
            .iter()
            .map(overlay_layer_from_json)
            .collect::<Result<_, String>>()?,
    })
}

fn overlay_event_from_json(value: &Value) -> Result<overlay::Event, String> {
    let (name, fields) = canon::event(value)?;
    Ok(match name {
        "open" => overlay::Event::Open {
            layer: overlay_layer_from_json(canon::field(fields, "layer")?)?,
        },
        "closed" => overlay::Event::Closed {
            id: canon::text(fields, "id")?.to_owned(),
            opener_present: canon::flag(fields, "openerPresent")?,
            focus: overlay_focus_from_text(canon::text(fields, "focus")?)?,
        },
        "escape" => overlay::Event::Escape {
            composing: canon::flag(fields, "composing")?,
            focus_owns_escape: canon::flag(fields, "focusOwnsEscape")?,
        },
        "pressOutside" => overlay::Event::PressOutside {
            inside_id: canon::optional_text(fields, "insideId")?.map(str::to_owned),
        },
        "tab" => overlay::Event::Tab,
        other => return Err(format!("unknown event {other:?}")),
    })
}

fn overlay_effect_to_json(effect: &overlay::Effect) -> Value {
    match effect {
        overlay::Effect::RequestClose { id, reason } => Value::object([(
            "requestClose",
            Value::object([
                ("id", Value::string(id)),
                ("reason", Value::string(overlay_reason_text(*reason))),
            ]),
        )]),
        overlay::Effect::RestoreFocus { to } => Value::object([(
            "restoreFocus",
            Value::object([("to", to.as_deref().map_or(Value::Null, Value::string))]),
        )]),
        overlay::Effect::PassToScreen => Value::object([(
            "passToScreen",
            Value::object([("key", Value::string("Escape"))]),
        )]),
    }
}

fn overlay_effects_to_json(effects: &[overlay::Effect]) -> String {
    canon::to_canonical(&Value::Array(
        effects.iter().map(overlay_effect_to_json).collect(),
    ))
}

fn overlay_params_from_json(value: &Value) -> Result<overlay::Params, String> {
    canon::object(value, "overlayStack params")?;
    Ok(overlay::Params)
}

fn overlay_params_to_json(_params: &overlay::Params) -> String {
    canon::to_canonical(&Value::object([]))
}

struct OverlayStack;

impl Port for OverlayStack {
    type State = overlay::State;
    type Event = overlay::Event;
    type Effect = overlay::Effect;
    type Params = overlay::Params;

    const NAME: &'static str = "overlayStack";

    fn initial(params: &Self::Params) -> Self::State {
        overlay::initial(params)
    }

    fn step(
        state: &Self::State,
        event: &Self::Event,
        params: &Self::Params,
    ) -> (Self::State, Vec<Self::Effect>) {
        overlay::step(state, event, params)
    }

    fn params_from_json(value: &Value) -> Result<Self::Params, String> {
        overlay_params_from_json(value)
    }

    fn state_from_json(value: &Value) -> Result<Self::State, String> {
        overlay_state_from_json(value)
    }

    fn event_from_json(value: &Value) -> Result<Self::Event, String> {
        overlay_event_from_json(value)
    }

    fn params_to_json(params: &Self::Params) -> String {
        overlay_params_to_json(params)
    }

    fn state_to_json(state: &Self::State) -> String {
        overlay_state_to_json(state)
    }

    fn effects_to_json(effects: &[Self::Effect]) -> String {
        overlay_effects_to_json(effects)
    }
}

#[test]
fn overlay_stack_reproduces_every_vector() {
    check_vectors::<OverlayStack>();
}

#[test]
fn overlay_stack_step_does_not_mutate_its_input() {
    check_step_does_not_mutate::<OverlayStack>();
}

#[test]
fn overlay_stack_default_params_are_the_generated_ones() {
    check_default_params::<OverlayStack>();
}

// ---------------------------------------------------------------------------
// confirmDestructive
// ---------------------------------------------------------------------------

fn confirm_phase_text(phase: confirm::Phase) -> &'static str {
    match phase {
        confirm::Phase::Idle => "idle",
        confirm::Phase::Confirming => "confirming",
        confirm::Phase::Working => "working",
        confirm::Phase::Failed => "failed",
    }
}

fn confirm_phase_from_text(text: &str) -> Result<confirm::Phase, String> {
    match text {
        "idle" => Ok(confirm::Phase::Idle),
        "confirming" => Ok(confirm::Phase::Confirming),
        "working" => Ok(confirm::Phase::Working),
        "failed" => Ok(confirm::Phase::Failed),
        other => Err(format!("unknown phase {other:?}")),
    }
}

fn confirm_cancel_from_text(text: &str) -> Result<confirm::CancelReason, String> {
    match text {
        "button" => Ok(confirm::CancelReason::Button),
        "escape" => Ok(confirm::CancelReason::Escape),
        "scrim" => Ok(confirm::CancelReason::Scrim),
        other => Err(format!("unknown cancel reason {other:?}")),
    }
}

fn confirm_state_to_json(state: &confirm::State) -> String {
    canon::to_canonical(&Value::object([
        ("attempt", Value::int(i64::from(state.attempt))),
        (
            "error",
            state.error.as_deref().map_or(Value::Null, Value::string),
        ),
        ("phase", Value::string(confirm_phase_text(state.phase))),
    ]))
}

fn confirm_state_from_json(value: &Value) -> Result<confirm::State, String> {
    Ok(confirm::State {
        phase: confirm_phase_from_text(canon::text(value, "phase")?)?,
        error: canon::optional_text(value, "error")?.map(str::to_owned),
        attempt: canon::number(value, "attempt")?,
    })
}

fn confirm_event_from_json(value: &Value) -> Result<confirm::Event, String> {
    let (name, fields) = canon::event(value)?;
    Ok(match name {
        "request" => confirm::Event::Request,
        "confirm" => confirm::Event::Confirm,
        "cancel" => confirm::Event::Cancel {
            reason: confirm_cancel_from_text(canon::text(fields, "reason")?)?,
        },
        "succeeded" => confirm::Event::Succeeded {
            attempt: canon::number(fields, "attempt")?,
        },
        "failed" => confirm::Event::Failed {
            attempt: canon::number(fields, "attempt")?,
            message: canon::text(fields, "message")?.to_owned(),
        },
        other => return Err(format!("unknown event {other:?}")),
    })
}

fn confirm_effect_to_json(effect: &confirm::Effect) -> Value {
    match effect {
        confirm::Effect::Run { attempt } => Value::object([(
            "run",
            Value::object([("attempt", Value::int(i64::from(*attempt)))]),
        )]),
        confirm::Effect::Done => Value::object([("done", Value::object([]))]),
    }
}

fn confirm_effects_to_json(effects: &[confirm::Effect]) -> String {
    canon::to_canonical(&Value::Array(
        effects.iter().map(confirm_effect_to_json).collect(),
    ))
}

fn confirm_params_from_json(value: &Value) -> Result<confirm::Params, String> {
    canon::object(value, "confirmDestructive params")?;
    Ok(confirm::Params)
}

fn confirm_params_to_json(_params: &confirm::Params) -> String {
    canon::to_canonical(&Value::object([]))
}

struct ConfirmDestructive;

impl Port for ConfirmDestructive {
    type State = confirm::State;
    type Event = confirm::Event;
    type Effect = confirm::Effect;
    type Params = confirm::Params;

    const NAME: &'static str = "confirmDestructive";

    fn initial(params: &Self::Params) -> Self::State {
        confirm::initial(params)
    }

    fn step(
        state: &Self::State,
        event: &Self::Event,
        params: &Self::Params,
    ) -> (Self::State, Vec<Self::Effect>) {
        confirm::step(state, event, params)
    }

    fn params_from_json(value: &Value) -> Result<Self::Params, String> {
        confirm_params_from_json(value)
    }

    fn state_from_json(value: &Value) -> Result<Self::State, String> {
        confirm_state_from_json(value)
    }

    fn event_from_json(value: &Value) -> Result<Self::Event, String> {
        confirm_event_from_json(value)
    }

    fn params_to_json(params: &Self::Params) -> String {
        confirm_params_to_json(params)
    }

    fn state_to_json(state: &Self::State) -> String {
        confirm_state_to_json(state)
    }

    fn effects_to_json(effects: &[Self::Effect]) -> String {
        confirm_effects_to_json(effects)
    }
}

#[test]
fn confirm_destructive_reproduces_every_vector() {
    check_vectors::<ConfirmDestructive>();
}

#[test]
fn confirm_destructive_step_does_not_mutate_its_input() {
    check_step_does_not_mutate::<ConfirmDestructive>();
}

#[test]
fn confirm_destructive_default_params_are_the_generated_ones() {
    check_default_params::<ConfirmDestructive>();
}

// ---------------------------------------------------------------------------
// listFocus
// ---------------------------------------------------------------------------

fn list_row_to_json(row: &list::Row) -> Value {
    Value::object([
        ("disabled", Value::Bool(row.disabled)),
        ("id", Value::string(&row.id)),
        ("label", Value::string(&row.label)),
    ])
}

fn list_row_from_json(value: &Value) -> Result<list::Row, String> {
    Ok(list::Row {
        id: canon::text(value, "id")?.to_owned(),
        label: canon::text(value, "label")?.to_owned(),
        disabled: canon::flag(value, "disabled")?,
    })
}

fn list_state_to_json(state: &list::State) -> String {
    canon::to_canonical(&Value::object([
        (
            "focused",
            state.focused.as_deref().map_or(Value::Null, Value::string),
        ),
        (
            "rows",
            Value::Array(state.rows.iter().map(list_row_to_json).collect()),
        ),
        (
            "selected",
            state.selected.as_deref().map_or(Value::Null, Value::string),
        ),
        ("token", Value::int(i64::from(state.token))),
        ("typeahead", Value::string(&state.typeahead)),
    ]))
}

fn list_state_from_json(value: &Value) -> Result<list::State, String> {
    Ok(list::State {
        rows: canon::items(value, "rows")?
            .iter()
            .map(list_row_from_json)
            .collect::<Result<_, String>>()?,
        focused: canon::optional_text(value, "focused")?.map(str::to_owned),
        selected: canon::optional_text(value, "selected")?.map(str::to_owned),
        typeahead: canon::text(value, "typeahead")?.to_owned(),
        token: canon::number(value, "token")?,
    })
}

/// `type.char` is exactly one Unicode scalar value; anything else is a host bug, as in the
/// reference.
fn one_char(text: &str) -> Result<char, String> {
    let mut chars = text.chars();
    match (chars.next(), chars.next()) {
        (Some(char), None) => Ok(char),
        _ => Err(format!("char: expected one character, got {text:?}")),
    }
}

fn list_event_from_json(value: &Value) -> Result<list::Event, String> {
    let (name, fields) = canon::event(value)?;
    Ok(match name {
        "setRows" => list::Event::SetRows {
            rows: canon::items(fields, "rows")?
                .iter()
                .map(list_row_from_json)
                .collect::<Result<_, String>>()?,
        },
        "focusIn" => list::Event::FocusIn,
        "up" => list::Event::Up,
        "down" => list::Event::Down,
        "home" => list::Event::Home,
        "end" => list::Event::End,
        "type" => list::Event::Type {
            char: one_char(canon::text(fields, "char")?)?,
        },
        "timerFired" => list::Event::TimerFired {
            token: canon::number(fields, "token")?,
        },
        "activate" => list::Event::Activate,
        "press" => list::Event::Press {
            id: canon::text(fields, "id")?.to_owned(),
        },
        other => return Err(format!("unknown event {other:?}")),
    })
}

fn list_effect_to_json(effect: &list::Effect) -> Value {
    match effect {
        list::Effect::Select { id } => {
            Value::object([("select", Value::object([("id", Value::string(id))]))])
        }
        list::Effect::StartTimer { token, ms } => Value::object([(
            "startTimer",
            Value::object([
                ("ms", Value::int(i64::from(*ms))),
                ("token", Value::int(i64::from(*token))),
            ]),
        )]),
        list::Effect::CancelTimer { token } => Value::object([(
            "cancelTimer",
            Value::object([("token", Value::int(i64::from(*token)))]),
        )]),
        list::Effect::Deselect => Value::object([("deselect", Value::object([]))]),
    }
}

fn list_effects_to_json(effects: &[list::Effect]) -> String {
    canon::to_canonical(&Value::Array(
        effects.iter().map(list_effect_to_json).collect(),
    ))
}

fn list_params_from_json(value: &Value) -> Result<list::Params, String> {
    Ok(list::Params {
        wrap: canon::flag(value, "wrap")?,
        selection_follows_focus: canon::flag(value, "selectionFollowsFocus")?,
        typeahead_ms: canon::number(value, "typeaheadMs")?,
    })
}

fn list_params_to_json(params: &list::Params) -> String {
    canon::to_canonical(&Value::object([
        (
            "selectionFollowsFocus",
            Value::Bool(params.selection_follows_focus),
        ),
        ("typeaheadMs", Value::int(i64::from(params.typeahead_ms))),
        ("wrap", Value::Bool(params.wrap)),
    ]))
}

struct ListFocus;

impl Port for ListFocus {
    type State = list::State;
    type Event = list::Event;
    type Effect = list::Effect;
    type Params = list::Params;

    const NAME: &'static str = "listFocus";

    fn initial(params: &Self::Params) -> Self::State {
        list::initial(params)
    }

    fn step(
        state: &Self::State,
        event: &Self::Event,
        params: &Self::Params,
    ) -> (Self::State, Vec<Self::Effect>) {
        list::step(state, event, params)
    }

    fn params_from_json(value: &Value) -> Result<Self::Params, String> {
        list_params_from_json(value)
    }

    fn state_from_json(value: &Value) -> Result<Self::State, String> {
        list_state_from_json(value)
    }

    fn event_from_json(value: &Value) -> Result<Self::Event, String> {
        list_event_from_json(value)
    }

    fn params_to_json(params: &Self::Params) -> String {
        list_params_to_json(params)
    }

    fn state_to_json(state: &Self::State) -> String {
        list_state_to_json(state)
    }

    fn effects_to_json(effects: &[Self::Effect]) -> String {
        list_effects_to_json(effects)
    }
}

#[test]
fn list_focus_reproduces_every_vector() {
    check_vectors::<ListFocus>();
}

#[test]
fn list_focus_step_does_not_mutate_its_input() {
    check_step_does_not_mutate::<ListFocus>();
}

#[test]
fn list_focus_default_params_are_the_generated_ones() {
    check_default_params::<ListFocus>();
}

// ---------------------------------------------------------------------------
// loadState
// ---------------------------------------------------------------------------

fn load_status_text(status: load::Status) -> &'static str {
    match status {
        load::Status::Loading => "loading",
        load::Status::Empty => "empty",
        load::Status::Error => "error",
        load::Status::Ready => "ready",
        load::Status::Refreshing => "refreshing",
    }
}

fn load_status_from_text(text: &str) -> Result<load::Status, String> {
    match text {
        "loading" => Ok(load::Status::Loading),
        "empty" => Ok(load::Status::Empty),
        "error" => Ok(load::Status::Error),
        "ready" => Ok(load::Status::Ready),
        "refreshing" => Ok(load::Status::Refreshing),
        other => Err(format!("unknown status {other:?}")),
    }
}

fn load_state_to_json(state: &load::State) -> String {
    canon::to_canonical(&Value::object([
        (
            "error",
            state.error.as_deref().map_or(Value::Null, Value::string),
        ),
        ("fetching", Value::Bool(state.fetching)),
        ("refreshByUser", Value::Bool(state.refresh_by_user)),
        ("status", Value::string(load_status_text(state.status))),
        ("token", Value::int(i64::from(state.token))),
    ]))
}

fn load_state_from_json(value: &Value) -> Result<load::State, String> {
    Ok(load::State {
        status: load_status_from_text(canon::text(value, "status")?)?,
        error: canon::optional_text(value, "error")?.map(str::to_owned),
        token: canon::number(value, "token")?,
        fetching: canon::flag(value, "fetching")?,
        refresh_by_user: canon::flag(value, "refreshByUser")?,
    })
}

fn load_event_from_json(value: &Value) -> Result<load::Event, String> {
    let (name, fields) = canon::event(value)?;
    Ok(match name {
        "start" => load::Event::Start,
        "refresh" => load::Event::Refresh {
            by_user: canon::flag(fields, "byUser")?,
        },
        "retry" => load::Event::Retry,
        "succeeded" => load::Event::Succeeded {
            token: canon::number(fields, "token")?,
            empty: canon::flag(fields, "empty")?,
        },
        "failed" => load::Event::Failed {
            token: canon::number(fields, "token")?,
            message: canon::text(fields, "message")?.to_owned(),
        },
        other => return Err(format!("unknown event {other:?}")),
    })
}

fn load_effect_to_json(effect: &load::Effect) -> Value {
    match effect {
        load::Effect::Fetch { token } => Value::object([(
            "fetch",
            Value::object([("token", Value::int(i64::from(*token)))]),
        )]),
        load::Effect::Notify { id, message } => Value::object([(
            "notify",
            Value::object([
                ("id", Value::string(id)),
                ("message", Value::string(message)),
            ]),
        )]),
    }
}

fn load_effects_to_json(effects: &[load::Effect]) -> String {
    canon::to_canonical(&Value::Array(
        effects.iter().map(load_effect_to_json).collect(),
    ))
}

fn load_params_from_json(value: &Value) -> Result<load::Params, String> {
    Ok(load::Params {
        notify_id: canon::text(value, "notifyId")?.to_owned(),
    })
}

fn load_params_to_json(params: &load::Params) -> String {
    canon::to_canonical(&Value::object([(
        "notifyId",
        Value::string(&params.notify_id),
    )]))
}

struct LoadState;

impl Port for LoadState {
    type State = load::State;
    type Event = load::Event;
    type Effect = load::Effect;
    type Params = load::Params;

    const NAME: &'static str = "loadState";

    fn initial(params: &Self::Params) -> Self::State {
        load::initial(params)
    }

    fn step(
        state: &Self::State,
        event: &Self::Event,
        params: &Self::Params,
    ) -> (Self::State, Vec<Self::Effect>) {
        load::step(state, event, params)
    }

    fn params_from_json(value: &Value) -> Result<Self::Params, String> {
        load_params_from_json(value)
    }

    fn state_from_json(value: &Value) -> Result<Self::State, String> {
        load_state_from_json(value)
    }

    fn event_from_json(value: &Value) -> Result<Self::Event, String> {
        load_event_from_json(value)
    }

    fn params_to_json(params: &Self::Params) -> String {
        load_params_to_json(params)
    }

    fn state_to_json(state: &Self::State) -> String {
        load_state_to_json(state)
    }

    fn effects_to_json(effects: &[Self::Effect]) -> String {
        load_effects_to_json(effects)
    }
}

#[test]
fn load_state_reproduces_every_vector() {
    check_vectors::<LoadState>();
}

#[test]
fn load_state_step_does_not_mutate_its_input() {
    check_step_does_not_mutate::<LoadState>();
}

#[test]
fn load_state_default_params_are_the_generated_ones() {
    check_default_params::<LoadState>();
}
