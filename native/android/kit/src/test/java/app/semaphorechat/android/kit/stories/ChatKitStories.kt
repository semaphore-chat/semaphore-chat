// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.stories

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.ui.Modifier
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Island
import app.semaphorechat.android.kit.SurfacePadding
import app.semaphorechat.android.kit.chat.ChatPiece
import app.semaphorechat.android.kit.chat.DayDivider
import app.semaphorechat.android.kit.chat.JumpToLatest
import app.semaphorechat.android.kit.chat.MentionTarget
import app.semaphorechat.android.kit.chat.MessageQuote
import app.semaphorechat.android.kit.chat.MessageQuoteItem
import app.semaphorechat.android.kit.chat.MessageRow
import app.semaphorechat.android.kit.chat.MessageText
import app.semaphorechat.android.kit.chat.PieceKind
import app.semaphorechat.android.kit.chat.PieceStyle
import app.semaphorechat.android.kit.chat.RowState
import app.semaphorechat.android.kit.chat.TypingLine

/** A chat surface: the list sits on an island with no padding of its own, as the chat screen's. */
@Composable
private fun ChatPage(content: @Composable ColumnScope.() -> Unit) {
    Island(modifier = Modifier.fillMaxWidth().padding(Tokens.Space.Md), padding = SurfacePadding.None) {
        Column(Modifier.padding(vertical = Tokens.Space.Sm), verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs), content = content)
    }
}

private fun words(text: String) = listOf(ChatPiece(text))

/** Every kind of run: the cases `message_pieces` hands the kit. */
val RICH_PIECES = listOf(
    ChatPiece("Plain, "),
    ChatPiece("bold", style = PieceStyle(bold = true)),
    ChatPiece(", "),
    ChatPiece("italic", style = PieceStyle(italic = true)),
    ChatPiece(", "),
    ChatPiece("struck", style = PieceStyle(strikethrough = true)),
    ChatPiece(" and "),
    ChatPiece("inline code", style = PieceStyle(code = true)),
    ChatPiece(". Hey "),
    ChatPiece("@Priya", PieceKind.Mention(MentionTarget.User("u-priya"))),
    ChatPiece(" and "),
    ChatPiece("@me", PieceKind.Mention(MentionTarget.User("u-me"), mine = true)),
    ChatPiece(", see "),
    ChatPiece("#design", PieceKind.Mention(MentionTarget.Channel("ch-design"))),
    ChatPiece(" and "),
    ChatPiece("https://lumen.studio/brief", PieceKind.Link("https://lumen.studio/brief")),
    ChatPiece(" "),
    ChatPiece("party", PieceKind.Emoji("party")),
    ChatPiece("\n"),
    ChatPiece("fn main() {\n    println!(\"a long line that has to scroll sideways on a phone\");\n}", PieceKind.CodeBlock),
    ChatPiece("\nA lookalike host shows as punycode: "),
    ChatPiece("https://xn--pple-43d.com/login", PieceKind.Link("https://xn--pple-43d.com/login")),
    ChatPiece(". A refused one is plain text: javascript:alert(1)"),
)

val CHAT_KIT_STORIES: List<Story> = listOf(
    Story("kit-message-text") {
        ChatPage { Column(Modifier.padding(horizontal = Tokens.Space.Md)) { MessageText(RICH_PIECES) } }
    },
    Story("kit-message-row") {
        ChatPage {
            MessageRow("Priya Raman", "u-priya", "8:19 PM", words("Has anyone looked at the new brief yet?"))
            MessageRow("Priya Raman", "u-priya", "8:19 PM", words("It's in the shared folder."), continued = true)
            MessageRow("Sam", "u-sam", "8:21 PM", words("Yes, the type looks great."), edited = true)
            MessageRow("Noor", "u-noor", "8:22 PM", listOf(ChatPiece("Ping "), ChatPiece("@me", PieceKind.Mention(MentionTarget.User("u-me"), mine = true))), mentioned = true)
            MessageRow(
                "Ivan",
                "u-ivan",
                "8:23 PM",
                words("Agreed, ship it."),
                quote = MessageQuoteItem("Sam", "Yes, the type looks great."),
                replyCount = 3,
            )
            MessageRow("Mae", "u-mae", "8:24 PM", words("photo"), extras = listOf("Attachment: moodboard.png, 2.1 MB"))
            MessageRow("Sam", "u-sam", "8:25 PM", emptyList(), removed = true)
        }
    },
    Story("kit-message-row-states") {
        ChatPage {
            MessageRow("You", "u-me", "8:30 PM", words("On its way"), state = RowState.Pending)
            MessageRow("You", "u-me", "8:30 PM", words("This one didn't make it"), state = RowState.Failed(null))
            MessageRow("You", "u-me", "8:31 PM", words("Slow down"), state = RowState.Failed("You are sending messages too quickly."))
            MessageRow(
                "A display name long enough that it cannot possibly fit on one phone line",
                "u-long",
                "12:59 AM",
                words("Averyveryverylongwordwithoutanyspacesthatmustwrapsomewhereinsteadofoverflowingtheedge and some normal words after it."),
            )
            MessageRow("Noor", "u-noor", "9:00 PM", words("مرحبا بالجميع، هذه رسالة من اليمين إلى اليسار"))
        }
    },
    Story("kit-chat-bits") {
        ChatPage {
            DayDivider("Today")
            DayDivider("Friday, September 18, 2025")
            Column(Modifier.padding(horizontal = Tokens.Space.Md), verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                MessageQuote(MessageQuoteItem("Priya", "The brief is in the shared folder, take a look when you can"))
                MessageQuote(MessageQuoteItem("Priya", "", deleted = true))
                JumpToLatest("Jump to latest", "Jump to latest", counted = false, onJump = {})
                JumpToLatest("3 new", "Jump to latest, 3 new messages", counted = true, onJump = {})
                JumpToLatest("99+ new", "Jump to latest, 99+ new messages", counted = true, onJump = {})
            }
            TypingLine("Priya is typing…")
            TypingLine("Priya and Sam are typing…")
            TypingLine("Priya and 4 others are typing…")
            TypingLine("")
        }
    },
)
