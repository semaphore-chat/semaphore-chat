//! `org.freedesktop.Notifications` on zbus, from a thread of its own.
//!
//! The thread runs `zbus::block_on` (async-io: never a Tokio runtime, see
//! `scripts/check-zbus-tokio.sh`), so no caller ever drives zbus: [`FreedesktopNotifier`]'s methods
//! only queue a command, from any thread, and return. The thread subscribes to the service's
//! signals before it sends anything, then handles commands and signals in arrival order:
//!
//! - `Notify` with `replaces_id` set to what the tag shows now, so a conversation has one
//!   notification, the newest; the id the server returns is the tag's from then on.
//! - `CloseNotification` for a withdraw.
//! - `ActivationToken` (sent just before `ActionInvoked`) is kept for that id, and `ActionInvoked`
//!   with the default action becomes `DesktopEvent::NotificationClicked` with it.
//! - `NotificationClosed` forgets the id (expired, dismissed, or after a click).

use super::plain_tag;
use crate::links::APP_ID;
use crate::{DesktopEvent, DesktopEventSink};
use futures_util::StreamExt as _;
use semaphore_core::model::OsNotification;
use semaphore_core::platform::{CoreError, Notifier};
use std::collections::HashMap;
use std::time::Duration;
use zbus::zvariant::Value;

pub(crate) const SERVICE: &str = "org.freedesktop.Notifications";
pub(crate) const PATH: &str = "/org/freedesktop/Notifications";
const DEFAULT_ACTION: &str = "default";
/// A notification service that doesn't answer in this long is treated as gone for that call.
const METHOD_TIMEOUT: Duration = Duration::from_secs(5);

enum Command {
    Show {
        tag: String,
        title: String,
        body: String,
    },
    Withdraw(String),
}

/// Desktop notifications on Linux. See the module docs; dropping it ends its thread.
pub struct FreedesktopNotifier {
    commands: async_channel::Sender<Command>,
}

impl FreedesktopNotifier {
    /// Starts the thread, which connects to the session bus. Never fails here: without a bus or a
    /// thread, every later call returns `CoreError::Unavailable`.
    pub fn start(sink: DesktopEventSink) -> Self {
        let (commands, receiver) = async_channel::unbounded();
        let spawned = std::thread::Builder::new()
            .name("notifier".into())
            .spawn(move || zbus::block_on(run(receiver, sink)));
        if let Err(error) = spawned {
            log::warn!("notifications: cannot start their thread: {error}");
            commands.close();
        }
        Self { commands }
    }

    fn send(&self, command: Command) -> Result<(), CoreError> {
        self.commands
            .try_send(command)
            .map_err(|_| CoreError::Unavailable {
                what: "the notification service (no session bus)".into(),
            })
    }
}

impl Drop for FreedesktopNotifier {
    fn drop(&mut self) {
        self.commands.close();
    }
}

impl Notifier for FreedesktopNotifier {
    fn notify(&self, title: String, body: String) -> Result<(), CoreError> {
        self.send(Command::Show {
            tag: plain_tag(),
            title,
            body,
        })
    }

    fn show(&self, notification: OsNotification) -> Result<(), CoreError> {
        self.send(Command::Show {
            tag: notification.tag,
            title: notification.title,
            body: notification.body,
        })
    }

    fn withdraw(&self, tag: &str) {
        let _ = self.send(Command::Withdraw(tag.to_owned()));
    }
}

/// Which notification shows each tag, and the activation tokens not yet claimed by a click.
#[derive(Default)]
struct Tracker {
    by_tag: HashMap<String, u32>,
    by_id: HashMap<u32, String>,
    tokens: HashMap<u32, String>,
}

impl Tracker {
    /// The id a new notification for this tag replaces (0: none).
    fn replaces(&self, tag: &str) -> u32 {
        self.by_tag.get(tag).copied().unwrap_or(0)
    }

    /// The server showed `tag` as `id` (the old id, or a new one if it didn't replace).
    fn shown(&mut self, tag: String, id: u32) {
        if let Some(old) = self.by_tag.insert(tag.clone(), id)
            && old != id
        {
            self.by_id.remove(&old);
            self.tokens.remove(&old);
        }
        self.by_id.insert(id, tag);
    }

    /// Forgets the tag; the id to close, if it showed.
    fn withdraw(&mut self, tag: &str) -> Option<u32> {
        let id = self.by_tag.remove(tag)?;
        self.by_id.remove(&id);
        self.tokens.remove(&id);
        Some(id)
    }

    fn token(&mut self, id: u32, token: String) {
        if self.by_id.contains_key(&id) {
            self.tokens.insert(id, token);
        }
    }

    /// An action on one of ours: the default one is a click.
    fn invoked(&mut self, id: u32, action: &str) -> Option<DesktopEvent> {
        let tag = self.by_id.get(&id)?.clone();
        let activation_token = self.tokens.remove(&id);
        (action == DEFAULT_ACTION).then_some(DesktopEvent::NotificationClicked {
            tag,
            activation_token,
        })
    }

    fn closed(&mut self, id: u32) {
        self.tokens.remove(&id);
        if let Some(tag) = self.by_id.remove(&id)
            && self.by_tag.get(&tag) == Some(&id)
        {
            self.by_tag.remove(&tag);
        }
    }
}

/// `&`, `<` and `>` as entities, for a server that reads the body as markup.
fn escape_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            other => out.push(other),
        }
    }
    out
}

enum Input {
    Command(Command),
    Signal(zbus::Result<zbus::Message>),
    /// Every `FreedesktopNotifier` is gone.
    Ended,
}

async fn connect() -> zbus::Result<(zbus::Connection, zbus::MessageStream)> {
    let connection = zbus::connection::Builder::session()?
        .method_timeout(METHOD_TIMEOUT)
        .build()
        .await?;
    let rule = zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(SERVICE)?
        .path(PATH)?
        .build();
    let signals = zbus::MessageStream::for_match_rule(rule, &connection, None).await?;
    Ok((connection, signals))
}

async fn capabilities(connection: &zbus::Connection) -> Vec<String> {
    let reply = connection
        .call_method(Some(SERVICE), PATH, Some(SERVICE), "GetCapabilities", &())
        .await;
    match reply.and_then(|reply| reply.body().deserialize::<Vec<String>>()) {
        Ok(capabilities) => capabilities,
        Err(error) => {
            log::info!("notifications: no capabilities from the service: {error}");
            Vec::new()
        }
    }
}

async fn run(commands: async_channel::Receiver<Command>, sink: DesktopEventSink) {
    let (connection, signals) = match connect().await {
        Ok(connected) => connected,
        Err(error) => {
            log::warn!("notifications: no session bus: {error}");
            commands.close();
            return;
        }
    };
    // Asked once: a service that starts later (activated by the first `Notify`) is asked then.
    let mut markup: Option<bool> = None;
    let mut tracker = Tracker::default();
    let inputs = futures_util::stream::select(
        commands
            .map(Input::Command)
            .chain(futures_util::stream::once(async { Input::Ended })),
        signals.map(Input::Signal),
    );
    let mut inputs = std::pin::pin!(inputs);
    while let Some(input) = inputs.next().await {
        match input {
            Input::Ended => break,
            Input::Command(Command::Show { tag, title, body }) => {
                let markup = match markup {
                    Some(markup) => markup,
                    None => {
                        let found = capabilities(&connection)
                            .await
                            .iter()
                            .any(|capability| capability == "body-markup");
                        markup = Some(found);
                        found
                    }
                };
                let body = if markup { escape_markup(&body) } else { body };
                match notify(&connection, tracker.replaces(&tag), &title, &body).await {
                    Ok(id) => tracker.shown(tag, id),
                    Err(error) => log::warn!("notifications: not shown: {error}"),
                }
            }
            Input::Command(Command::Withdraw(tag)) => {
                if let Some(id) = tracker.withdraw(&tag) {
                    let closed = connection
                        .call_method(Some(SERVICE), PATH, Some(SERVICE), "CloseNotification", &id)
                        .await;
                    if let Err(error) = closed {
                        log::debug!("notifications: close {id}: {error}");
                    }
                }
            }
            Input::Signal(Ok(message)) => {
                if let Some(event) = signal(&mut tracker, &message) {
                    sink(event);
                }
            }
            Input::Signal(Err(error)) => log::debug!("notifications: bad signal: {error}"),
        }
    }
}

async fn notify(
    connection: &zbus::Connection,
    replaces_id: u32,
    title: &str,
    body: &str,
) -> zbus::Result<u32> {
    let hints: HashMap<&str, Value<'_>> = HashMap::from([
        ("desktop-entry", Value::from(APP_ID)),
        ("category", Value::from("im.received")),
        // The app plays its own sound, or none.
        ("suppress-sound", Value::from(true)),
        ("urgency", Value::from(1u8)),
    ]);
    let reply = connection
        .call_method(
            Some(SERVICE),
            PATH,
            Some(SERVICE),
            "Notify",
            &(
                "Semaphore",
                replaces_id,
                APP_ID,
                title,
                body,
                vec![DEFAULT_ACTION, "Open"],
                hints,
                -1i32,
            ),
        )
        .await?;
    reply.body().deserialize::<u32>()
}

fn signal(tracker: &mut Tracker, message: &zbus::Message) -> Option<DesktopEvent> {
    let header = message.header();
    let member = header.member()?;
    let body = message.body();
    match member.as_str() {
        "ActivationToken" => {
            let (id, token): (u32, String) = body.deserialize().ok()?;
            tracker.token(id, token);
            None
        }
        "ActionInvoked" => {
            let (id, action): (u32, String) = body.deserialize().ok()?;
            tracker.invoked(id, &action)
        }
        "NotificationClosed" => {
            let (id, _reason): (u32, u32) = body.deserialize().ok()?;
            tracker.closed(id);
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clicked(tag: &str, token: Option<&str>) -> Option<DesktopEvent> {
        Some(DesktopEvent::NotificationClicked {
            tag: tag.into(),
            activation_token: token.map(Into::into),
        })
    }

    #[test]
    fn a_tag_replaces_its_own_notification_and_no_other() {
        let mut tracker = Tracker::default();
        assert_eq!(tracker.replaces("dm:a"), 0);
        tracker.shown("dm:a".into(), 7);
        tracker.shown("channel:b".into(), 8);
        assert_eq!(tracker.replaces("dm:a"), 7);
        assert_eq!(tracker.replaces("channel:b"), 8);
        // The server didn't replace (the old one had gone): the new id is the tag's.
        tracker.shown("dm:a".into(), 9);
        assert_eq!(tracker.replaces("dm:a"), 9);
        assert_eq!(tracker.invoked(7, DEFAULT_ACTION), None);
        assert_eq!(tracker.invoked(9, DEFAULT_ACTION), clicked("dm:a", None));
    }

    #[test]
    fn a_click_carries_the_token_sent_before_it_once() {
        let mut tracker = Tracker::default();
        tracker.shown("dm:a".into(), 3);
        tracker.token(3, "tok".into());
        // Not ours: ignored.
        tracker.token(99, "other".into());
        assert_eq!(tracker.invoked(99, DEFAULT_ACTION), None);
        assert_eq!(
            tracker.invoked(3, DEFAULT_ACTION),
            clicked("dm:a", Some("tok"))
        );
        assert_eq!(tracker.invoked(3, DEFAULT_ACTION), clicked("dm:a", None));
        assert_eq!(tracker.invoked(3, "something-else"), None);
    }

    #[test]
    fn closed_and_withdrawn_notifications_are_forgotten() {
        let mut tracker = Tracker::default();
        tracker.shown("dm:a".into(), 3);
        tracker.shown("dm:b".into(), 4);
        tracker.closed(3);
        assert_eq!(tracker.replaces("dm:a"), 0);
        assert_eq!(tracker.invoked(3, DEFAULT_ACTION), None);
        assert_eq!(tracker.withdraw("dm:b"), Some(4));
        assert_eq!(tracker.withdraw("dm:b"), None);
        // A late close for an id the tag no longer shows leaves the tag's current one alone.
        tracker.shown("dm:c".into(), 5);
        tracker.shown("dm:c".into(), 6);
        tracker.closed(5);
        assert_eq!(tracker.replaces("dm:c"), 6);
        assert!(tracker.by_id.len() == 1 && tracker.tokens.is_empty());
    }

    #[test]
    fn markup_characters_are_escaped() {
        assert_eq!(
            escape_markup("a < b & <i>c</i>"),
            "a &lt; b &amp; &lt;i&gt;c&lt;/i&gt;"
        );
    }
}
