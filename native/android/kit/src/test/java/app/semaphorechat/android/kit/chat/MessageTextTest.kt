// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class MessageTextTest {
    @Test
    fun codeBlocksStandAloneAndTheirEdgeLineBreaksGo() {
        val blocks = blocksOf(
            listOf(
                ChatPiece("before\n"),
                ChatPiece("\ncode()\n", PieceKind.CodeBlock),
                ChatPiece("\nafter "),
                ChatPiece("@a", PieceKind.Mention(MentionTarget.None)),
            ),
        )
        assertEquals(
            listOf(
                TextBlock.Inline(listOf(ChatPiece("before"))),
                TextBlock.Code("code()"),
                TextBlock.Inline(listOf(ChatPiece("after "), ChatPiece("@a", PieceKind.Mention(MentionTarget.None)))),
            ),
            blocks,
        )
    }

    @Test
    fun onlyCodeOrNothingGivesNoEmptyParagraph() {
        assertEquals(listOf(TextBlock.Code("x")), blocksOf(listOf(ChatPiece("\n"), ChatPiece("x", PieceKind.CodeBlock), ChatPiece("\n"))))
        assertEquals(emptyList<TextBlock>(), blocksOf(emptyList()))
    }

    @Test
    fun anEmojiDrawsItsNameBetweenColons() {
        assertEquals(":party:", drawnText(ChatPiece("x", PieceKind.Emoji("party"))))
        assertEquals("plain", drawnText(ChatPiece("plain")))
    }
}
