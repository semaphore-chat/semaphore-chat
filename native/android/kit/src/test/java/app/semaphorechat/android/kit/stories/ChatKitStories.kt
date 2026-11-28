// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.stories

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.input.TextFieldValue
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.kit.chat.ComposerField
import app.semaphorechat.android.kit.chat.ComposerNotice
import app.semaphorechat.android.kit.chat.ComposerText
import app.semaphorechat.android.kit.chat.SuggestionItem
import app.semaphorechat.android.kit.chat.SuggestionList
import app.semaphorechat.android.kit.chat.SuggestionLook
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
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.unit.dp
import app.semaphorechat.android.kit.Kit
import app.semaphorechat.android.kit.chat.AttachmentImages
import app.semaphorechat.android.kit.chat.FileTile
import app.semaphorechat.android.kit.chat.ImageLoad
import app.semaphorechat.android.kit.chat.LocalAttachmentImages
import app.semaphorechat.android.kit.chat.MediaTile
import app.semaphorechat.android.kit.chat.UploadTile
import kotlinx.coroutines.flow.MutableStateFlow

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
    Story("kit-attachments") {
        ChatPage {
            WithImages {
                Column(Modifier.padding(horizontal = Tokens.Space.Md), verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    MediaTile("img-wide", "moodboard.png", "2.1 MB", 320.dp, 180.dp, video = false, thumbnail = true, onOpen = {})
                    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                        MediaTile("img-tall", "portrait.jpg", "800 KB", 135.dp, 240.dp, video = false, thumbnail = true, onOpen = {})
                        MediaTile("slow-1", "loading.png", "1 MB", 135.dp, 240.dp, video = false, thumbnail = true, onOpen = {})
                        MediaTile("img-strip", "strip.png", "10 KB", 48.dp, 240.dp, video = false, thumbnail = true, onOpen = {})
                    }
                    MediaTile("img-video", "launch.mp4", "8.4 MB", 320.dp, 180.dp, video = true, thumbnail = true, onOpen = {})
                }
            }
        }
    },
    Story("kit-attachments-files") {
        ChatPage {
            WithImages {
                Column(Modifier.padding(horizontal = Tokens.Space.Md), verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    MediaTile("v-none", "no-still.mp4", "3 MB", 240.dp, 160.dp, video = true, thumbnail = false, onOpen = {})
                    MediaTile("broken", "not-an-image.png", "12 Bytes", 240.dp, 160.dp, video = false, thumbnail = true, onOpen = {})
                    FileTile("Q3 plan — final.pdf", "2.13 MB", Icons.Paperclip, onOpen = {})
                    // A sender's right-to-left override is dropped, so this reads as it is written.
                    FileTile("invoice\u202Efdp.exe", "18 KB", Icons.Paperclip, onOpen = {})
                    FileTile("a file name long enough that it cannot fit on one phone line at all.tar.gz", "10 MB", Icons.Paperclip, onOpen = {})
                    FileTile("theme.ogg", "640 KB", Icons.Music, onOpen = {})
                }
            }
        }
    },
    Story("kit-uploads") {
        ChatPage {
            Column(Modifier.padding(horizontal = Tokens.Space.Md), verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                UploadTile("notes.txt", "12 KB", onRemove = {})
                UploadTile("holiday.jpg", "4.2 MB", progress = 0f, onRemove = {})
                UploadTile("holiday-2.jpg", "4.2 MB", progress = 0.6f, onRemove = {})
                UploadTile("big.zip", "9.9 MB", failed = "The file is too large for this server", onRetry = {}, onRemove = {})
                UploadTile("a file name long enough that it cannot fit on one phone line at all.tar.gz", "10 MB", failed = "Something went wrong. Please try again.", onRetry = {}, onRemove = {})
            }
        }
    },
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
            MessageRow("Mae", "u-mae", "8:24 PM", words("photo"), attachments = {
                WithImages { MediaTile("img-wide", "moodboard.png", "2.1 MB", 320.dp, 180.dp, video = false, thumbnail = true, onOpen = {}) }
            })
            MessageRow("Sam", "u-sam", "8:25 PM", emptyList(), removed = true)
        }
    },
    Story("kit-message-row-states") {
        ChatPage {
            MessageRow("You", "u-me", "8:30 PM", words("On its way"), state = RowState.Pending)
            MessageRow("You", "u-me", "8:30 PM", words("This one didn't make it"), state = RowState.Failed(null))
            MessageRow("You", "u-me", "8:31 PM", words("Slow down"), state = RowState.Failed("You are sending messages too quickly."))
            MessageRow("You", "u-me", "8:32 PM", words("Retry me"), state = RowState.Failed(null), onRetry = {}, onDelete = {})
            MessageRow("You", "u-me", "8:32 PM", words("Retrying"), state = RowState.Failed(null, retrying = true), onRetry = {}, onDelete = {}, continued = true)
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
    Story("kit-composer") {
        ChatPage {
            Column(Modifier.padding(horizontal = Tokens.Space.Md), verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                ComposerField(TextFieldValue(), {}, ComposerText.placeholder("design"), maxLines = 4, canSend = false, onSend = {})
                ComposerField(TextFieldValue("On it"), {}, ComposerText.placeholder("design"), maxLines = 4, canSend = true, onSend = {})
                ComposerField(TextFieldValue(), {}, ComposerText.placeholder("design"), maxLines = 4, canSend = false, onSend = {}, onAttach = {})
                ComposerField(TextFieldValue("With files"), {}, ComposerText.placeholder("design"), maxLines = 4, canSend = true, onSend = {}, onAttach = {})
                ComposerField(
                    TextFieldValue("Line one\nLine two\nLine three\nLine four\nLine five, past the cap"),
                    {},
                    ComposerText.placeholder("design"),
                    maxLines = 4,
                    canSend = true,
                    onSend = {},
                )
                ComposerNotice("You can't send messages in #announcements", Icons.Lock)
                ComposerNotice("Timed out, 12 min left", Icons.Info, reason = "Spamming links")
                SuggestionList(
                    "Suggestions",
                    listOf(
                        SuggestionItem("Priya Raman", "@priya", SuggestionLook.Person("u-priya")),
                        SuggestionItem("Sam", "@sam", SuggestionLook.Person("u-sam")),
                        SuggestionItem("here", null, SuggestionLook.Group),
                        SuggestionItem("design", null, SuggestionLook.Channel),
                    ),
                    shown = 6,
                    onPick = {},
                )
            }
        }
    },
)
