// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens.stories

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import app.semaphorechat.android.screens.BlockedKind
import app.semaphorechat.android.screens.ComposerAccess
import app.semaphorechat.android.screens.ComposerModel
import app.semaphorechat.android.screens.MentionSuggestion
import app.semaphorechat.android.screens.SuggestionKind
import app.semaphorechat.android.kit.chat.ChatPiece
import app.semaphorechat.android.kit.chat.MentionTarget
import app.semaphorechat.android.kit.chat.PieceKind
import app.semaphorechat.android.kit.chat.PieceStyle
import app.semaphorechat.android.kit.stories.Story
import app.semaphorechat.android.screens.ChannelIcon
import app.semaphorechat.android.screens.ChatActions
import app.semaphorechat.android.screens.ChatConnection
import app.semaphorechat.android.screens.ChatFace
import app.semaphorechat.android.screens.ChatFormat
import app.semaphorechat.android.screens.ChatHeaderModel
import app.semaphorechat.android.screens.ChatMessage
import app.semaphorechat.android.screens.ChatModel
import app.semaphorechat.android.screens.ChatScreen
import app.semaphorechat.android.screens.JumpLabel
import app.semaphorechat.android.screens.MessageState
import app.semaphorechat.android.screens.QuoteItem

/** Friday 18 September 2026, 20:30 UTC: "now" in every chat story. */
private const val NOW = 1_789_763_400_000L
private const val MINUTE = 60_000L
private const val DAY = 24 * 60 * MINUTE

private val FORMAT = ChatFormat.fixed(NOW)
private val HEADER = ChatHeaderModel("design", ChannelIcon.Hash, "Lumen Studio")

private fun text(value: String) = listOf(ChatPiece(value))

private fun message(
    key: Long,
    author: String,
    authorId: String,
    minutesAgo: Long,
    pieces: List<ChatPiece>,
    state: MessageState = MessageState.Sent,
) = ChatMessage(key, "m$key", authorId, author, NOW - minutesAgo * MINUTE, pieces, state = state)

/** A day ago and today, grouped and not, with every kind of row the read side draws. */
private val CONVERSATION: List<ChatMessage> = listOf(
    message(1, "Sam", "u-sam", DAY / MINUTE + 30, text("Kick-off notes are in the doc.")),
    message(2, "Sam", "u-sam", DAY / MINUTE + 29, text("Shout if anything is missing.")),
    message(3, "Priya Raman", "u-priya", 42, text("Morning! Has anyone looked at the new brief yet?")).copy(replyCount = 2),
    message(4, "Priya Raman", "u-priya", 41, text("It's in the shared folder.")),
    message(
        5,
        "Noor",
        "u-noor",
        30,
        listOf(
            ChatPiece("@Mike", PieceKind.Mention(MentionTarget.User("u-me"), mine = true)),
            ChatPiece(" can you check the "),
            ChatPiece("type scale", style = PieceStyle(bold = true)),
            ChatPiece(" in "),
            ChatPiece("#design-system", PieceKind.Mention(MentionTarget.Channel("ch-ds"))),
            ChatPiece("? "),
            ChatPiece("https://lumen.studio/type", PieceKind.Link("https://lumen.studio/type")),
        ),
    ).copy(mentionsMe = true),
    message(6, "Ivan", "u-ivan", 20, text("Looks good to me.")).copy(replyTo = QuoteItem("Priya Raman", "It's in the shared folder."), edited = true),
    message(7, "Mae", "u-mae", 12, text("moodboard")).copy(extras = listOf("Attachment: moodboard.png, 2.1 MB")),
    message(8, "Sam", "u-sam", 8, emptyList()).copy(removed = true),
    message(
        9,
        "Ivan",
        "u-ivan",
        5,
        listOf(
            ChatPiece("Use "),
            ChatPiece("npm run tokens", style = PieceStyle(code = true)),
            ChatPiece(" then:\n"),
            ChatPiece("pnpm --filter design build\npnpm --filter design test -- --watch=false", PieceKind.CodeBlock),
        ),
    ),
    message(10, "You", "u-me", 1, text("On it, give me ten minutes.")),
)

@Composable
private fun Chat(
    chat: ChatModel,
    header: ChatHeaderModel = HEADER,
    draft: TextFieldValue = TextFieldValue(),
    composer: ComposerModel = ComposerModel(),
) {
    ChatScreen(header, chat, FORMAT, ChatActions(), draft = draft, composer = composer)
}

private fun suggestion(kind: SuggestionKind, id: String, label: String, insert: String) = MentionSuggestion(kind, id, label, insert)

private fun ready(messages: List<ChatMessage>, atStart: Boolean = false) =
    ChatModel(face = ChatFace.Ready, messages = messages, atStart = atStart)

val CHAT_STORIES: List<Story> = listOf(
    Story("screen-chat-loading") { Chat(ChatModel()) },
    Story("screen-chat-failed") { Chat(ChatModel(face = ChatFace.Failed("Can't reach the server. Check your connection and try again."))) },
    Story("screen-chat-empty") { Chat(ready(emptyList(), atStart = true)) },
    Story("screen-chat-list") { Chat(ready(CONVERSATION)) },
    Story("screen-chat-start") { Chat(ready(CONVERSATION.take(3), atStart = true)) },
    Story("screen-chat-loading-older") { Chat(ready(CONVERSATION.take(3)).copy(loadingOlder = true)) },
    Story("screen-chat-older-failed") {
        Chat(ready(CONVERSATION.take(3)).copy(olderFailed = "The server answered with an error. Try again in a moment."))
    },
    Story("screen-chat-sending") {
        Chat(
            ready(
                CONVERSATION.take(4) + listOf(
                    message(20, "You", "u-me", 1, text("This one is on its way"), MessageState.Pending).copy(clientNonce = "n20"),
                    message(21, "You", "u-me", 0, text("This one didn't make it"), MessageState.Failed("You are sending messages too quickly.")).copy(clientNonce = "n21"),
                ),
            ),
        )
    },
    Story("screen-chat-typing-jump") {
        Chat(ready(CONVERSATION).copy(typing = "Priya and Sam are typing…", jump = JumpLabel("3 new", "Jump to latest, 3 new messages", true)))
    },
    Story("screen-chat-reconnecting") { Chat(ready(CONVERSATION).copy(connection = ChatConnection.Reconnecting)) },
    Story("screen-chat-offline") {
        Chat(ready(CONVERSATION).copy(connection = ChatConnection.Offline, jump = JumpLabel("Jump to latest", "Jump to latest", false)))
    },
    Story("screen-chat-long") {
        val long = ChatHeaderModel("a-channel-name-that-goes-on-and-on-past-the-edge", ChannelIcon.Lock, "A community with a name far too long for a phone")
        Chat(
            ready(
                (1L..40L).map { n ->
                    message(n, if (n % 3 == 0L) "Priya Raman" else "Sam", if (n % 3 == 0L) "u-priya" else "u-sam", 200 - n * 4, text("Message number $n in a long conversation"))
                },
            ),
            long,
        )
    },
    Story("screen-chat-retrying") {
        Chat(
            ready(
                CONVERSATION.take(4) + listOf(
                    message(21, "You", "u-me", 0, text("Not sent, retrying"), MessageState.Failed("Not sent", retrying = true)).copy(clientNonce = "n21"),
                ),
            ),
        )
    },
    Story("screen-composer-typed") {
        Chat(ready(CONVERSATION), draft = TextFieldValue("On it, give me ten 🙂", TextRange(21)))
    },
    Story("screen-composer-long") {
        val long = (1..8).joinToString("\n") { "Line $it of a long message that wraps on a phone screen" }
        Chat(ready(CONVERSATION), draft = TextFieldValue(long, TextRange(long.length)))
    },
    Story("screen-composer-cant-post") {
        Chat(
            ready(CONVERSATION),
            HEADER.copy(name = "announcements", icon = ChannelIcon.Megaphone),
            composer = ComposerModel(ComposerAccess.Blocked("You can't send messages in #announcements", BlockedKind.NoPermission)),
        )
    },
    Story("screen-composer-read-only") {
        Chat(
            ready(CONVERSATION),
            HEADER.copy(name = "announcements", icon = ChannelIcon.Megaphone),
            composer = ComposerModel(ComposerAccess.Blocked("#announcements is read-only. Only Moderator and Admin can post.", BlockedKind.ReadOnly)),
        )
    },
    Story("screen-composer-timed-out") {
        Chat(ready(CONVERSATION), composer = ComposerModel(ComposerAccess.Blocked("Timed out, 12 min left", BlockedKind.TimedOut)))
    },
    Story("screen-composer-mentions") {
        Chat(
            ready(CONVERSATION),
            draft = TextFieldValue("Thanks @pr", TextRange(10)),
            composer = ComposerModel(
                suggestions = listOf(
                    suggestion(SuggestionKind.User, "u-priya", "Priya Raman", "@priya"),
                    suggestion(SuggestionKind.User, "u-prem", "Prem", "@prem"),
                    suggestion(SuggestionKind.User, "u-pr", "A member whose display name is far too long for one line", "@prudence_with_a_long_username"),
                ),
            ),
        )
    },
    Story("screen-composer-channels") {
        Chat(
            ready(CONVERSATION),
            draft = TextFieldValue("See #", TextRange(5)),
            composer = ComposerModel(
                suggestions = (1..9).map { suggestion(SuggestionKind.Channel, "ch-$it", "design-$it", "#design-$it") },
            ),
        )
    },
    Story("screen-composer-mentions-keyboard") {
        // The room a 360x800 phone leaves with the keyboard up: the list shrinks, the field stays.
        Box(Modifier.fillMaxWidth().height(500.dp)) {
            Chat(
                ready(CONVERSATION),
                draft = TextFieldValue("Thanks @", TextRange(8)),
                composer = ComposerModel(
                    suggestions = listOf(
                        suggestion(SuggestionKind.Special, "here", "here", "@here"),
                        suggestion(SuggestionKind.Special, "channel", "channel", "@channel"),
                    ) + (1..10).map { suggestion(SuggestionKind.User, "u-$it", "Member $it", "@member$it") },
                ),
            )
        }
    },
)
