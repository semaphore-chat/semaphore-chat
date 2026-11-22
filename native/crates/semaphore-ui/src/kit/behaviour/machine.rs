//! Runs a reducer the way `design/guide/behaviour.md` ("Applying a step") says, as the web's
//! `hosts/machine.ts`: send one event, store the new state, apply the effects one by one in order.
//! An event sent while a step is being applied (by an effect, or by an owner it calls) is queued
//! and runs after every effect of the step. The reducer is never re-entered.
//!
//! GPUI adds one rule of its own: an entity cannot be updated while it is being updated, so the
//! machine lives in the host's entity and [`drive`] takes each step inside a short update, then
//! applies the effects outside it. An owner called from an effect can send again; that send only
//! queues.

use gpui_kit::{App, Entity, Window};
use std::collections::VecDeque;

pub(crate) type Step<S, E, F, P> = fn(&S, &E, &P) -> (S, Vec<F>);

pub(crate) struct Machine<S, E, F, P> {
    state: S,
    params: P,
    step: Step<S, E, F, P>,
    queue: VecDeque<E>,
    busy: bool,
}

impl<S, E, F, P> Machine<S, E, F, P> {
    pub fn new(step: Step<S, E, F, P>, initial: S, params: P) -> Self {
        Self {
            state: initial,
            params,
            step,
            queue: VecDeque::new(),
            busy: false,
        }
    }

    pub fn state(&self) -> &S {
        &self.state
    }

    /// Queues `event`. True when the caller must run the steps (nothing is being applied).
    pub fn enqueue(&mut self, event: E) -> bool {
        self.queue.push_back(event);
        if self.busy {
            return false;
        }
        self.busy = true;
        true
    }

    /// Takes the next queued event's step and stores its state; `None` once the queue is empty
    /// (the machine is idle again).
    pub fn next(&mut self) -> Option<Vec<F>> {
        let Some(event) = self.queue.pop_front() else {
            self.busy = false;
            return None;
        };
        let (state, effects) = (self.step)(&self.state, &event, &self.params);
        self.state = state;
        Some(effects)
    }
}

/// Sends `event` to the machine `access` finds in `entity`, and applies every effect of it and of
/// the events queued while applying, in order.
pub(crate) fn drive<T: 'static, S, E, F, P>(
    entity: &Entity<T>,
    access: fn(&mut T) -> &mut Machine<S, E, F, P>,
    event: E,
    window: &mut Window,
    cx: &mut App,
    mut apply: impl FnMut(F, &mut Window, &mut App),
) {
    if !entity.update(cx, |host, _| access(host).enqueue(event)) {
        return;
    }
    while let Some(effects) = entity.update(cx, |host, _| access(host).next()) {
        for effect in effects {
            apply(effect, window, cx);
        }
    }
}

/// [`drive`] for effects that need no window (the toast queue, called from anywhere).
pub(crate) fn drive_app<T: 'static, S, E, F, P>(
    entity: &Entity<T>,
    access: fn(&mut T) -> &mut Machine<S, E, F, P>,
    event: E,
    cx: &mut App,
    mut apply: impl FnMut(F, &mut App),
) {
    if !entity.update(cx, |host, _| access(host).enqueue(event)) {
        return;
    }
    while let Some(effects) = entity.update(cx, |host, _| access(host).next()) {
        for effect in effects {
            apply(effect, cx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A counter whose `Bump` asks for a `Note`, which sends `Record` back.
    #[derive(Debug, Clone, PartialEq)]
    enum Ev {
        Bump,
        Record(u32),
    }

    #[allow(clippy::ptr_arg)] // the machine's state type is `Vec<String>`
    fn step(state: &Vec<String>, event: &Ev, _: &()) -> (Vec<String>, Vec<u32>) {
        let mut next = state.clone();
        match event {
            Ev::Bump => {
                next.push("bump".into());
                (next, vec![1, 2])
            }
            Ev::Record(n) => {
                next.push(format!("record {n}"));
                (next, Vec::new())
            }
        }
    }

    #[test]
    fn an_event_sent_while_applying_runs_after_every_effect_of_the_step() {
        let mut machine = Machine::new(step, Vec::new(), ());
        assert!(machine.enqueue(Ev::Bump));
        let mut applied = Vec::new();
        while let Some(effects) = machine.next() {
            for effect in effects {
                applied.push(format!("effect {effect}"));
                // An owner sends while the step is being applied: it only queues.
                assert!(!machine.enqueue(Ev::Record(effect)));
                applied.push(format!("state {}", machine.state().len()));
            }
        }
        assert_eq!(
            applied,
            ["effect 1", "state 1", "effect 2", "state 1"],
            "both effects of the step ran before either queued event"
        );
        assert_eq!(machine.state(), &["bump", "record 1", "record 2"]);
        assert!(
            machine.enqueue(Ev::Bump),
            "idle again once the queue drained"
        );
    }
}
