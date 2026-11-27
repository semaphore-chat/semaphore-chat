// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import app.semaphorechat.android.screens.BlockedKind
import app.semaphorechat.android.screens.ComposerAccess
import app.semaphorechat.android.screens.ComposerCaps
import app.semaphorechat.android.screens.MentionSuggestion
import app.semaphorechat.android.screens.SuggestionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import uniffi.semaphore.ChannelPermissions
import uniffi.semaphore.MentionKind
import uniffi.semaphore.SegKind
import uniffi.semaphore.TextSeg
import uniffi.semaphore.TextStyle

/**
 * The composer's text rules: the mention typed at the caret, inserting a picked one, and the byte
 * ranges core gets for the mentions, in UTF-8 where Kotlin counts UTF-16 units. Emoji, surrogate
 * pairs, combining marks and lone surrogates are tested densely; the last test hands the ranges to
 * Rust (`message_pieces`) and checks it cuts the same text Kotlin meant.
 */
class ComposerRulesTest {
    private val priya = MentionSuggestion(SuggestionKind.User, "u-priya", "Priya Raman", "@priya")
    private val priyaR = MentionSuggestion(SuggestionKind.User, "u-priyar", "Priya R", "@priya_r")
    private val design = MentionSuggestion(SuggestionKind.Channel, "ch-design", "design", "#design")
    private val here = MentionSuggestion(SuggestionKind.Special, "here", "here", "@here")

    /** Texts with every awkward kind of character: 1-, 2-, 3- and 4-byte ones, joiners, flags, marks. */
    private val awkward = listOf(
        "",
        "plain ascii",
        "é and ü",
        "日本語のテキスト",
        "😀",
        "a😀b",
        "😀😀😀",
        "👩‍👩‍👧‍👦 family",
        "🇬🇧🇯🇵 flags",
        "é combining",
        "👍🏽 toned",
        "\uD83D lone high",
        "lone low \uDE00",
        "\uDE00\uD83D reversed pair",
        "mixed é😀日 \uD83D x",
        "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 math",
    )

    /** A strict encoder, as the FFI's (`CodingErrorAction.REPORT`): malformed UTF-16 throws. */
    private fun strictBytes(text: String): Int =
        Charsets.UTF_8.newEncoder()
            .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
            .encode(java.nio.CharBuffer.wrap(text))
            .remaining()

    @Test
    fun loneSurrogatesBecomeTheReplacementCharacterAndPairsStay() {
        assertEquals("\uFFFD", wellFormed("\uD83D"))
        assertEquals("\uFFFD", wellFormed("\uDE00"))
        assertEquals("\uFFFD\uFFFD reversed", wellFormed("\uDE00\uD83D reversed"))
        assertEquals("a😀b", wellFormed("a😀b"))
        assertEquals("x\uFFFD😀\uFFFD", wellFormed("x\uD83D😀\uDE00"))
        val plain = "no surrogates é 日"
        assertTrue("untouched text is the same string", wellFormed(plain) === plain)
        for (text in awkward) {
            val clean = wellFormed(text)
            assertEquals("one char for one char", text.length, clean.length)
            // Strictly encodable now: what the FFI would have refused.
            strictBytes(clean)
        }
    }

    @Test
    fun utf8OffsetsAreWhatAStrictEncoderProducesAtEveryCodePointBoundary() {
        for (raw in awkward) {
            val text = wellFormed(raw)
            assertEquals("whole of \"$text\"", strictBytes(text), utf8Offset(text, text.length))
            assertEquals("a lone surrogate counts as the U+FFFD it becomes", utf8Offset(text, text.length), utf8Offset(raw, raw.length))
            var i = 0
            while (i <= text.length) {
                val pairSplit = i in 1 until text.length && text[i - 1].isHighSurrogate() && text[i].isLowSurrogate()
                if (!pairSplit) {
                    assertEquals("\"$text\" up to $i", strictBytes(text.substring(0, i)), utf8Offset(text, i))
                }
                i++
            }
        }
    }

    @Test
    fun anOffsetInsideAPairCountsUpToThePairAndOutOfRangeClamps() {
        val text = "a😀b"
        assertEquals(1, utf8Offset(text, 1))
        assertEquals("between the halves: up to the pair", 1, utf8Offset(text, 2))
        assertEquals(5, utf8Offset(text, 3))
        assertEquals(6, utf8Offset(text, 4))
        assertEquals(0, utf8Offset(text, -3))
        assertEquals(6, utf8Offset(text, 99))
        assertEquals("a lone surrogate counts as U+FFFD, 3 bytes", 3, utf8Offset("\uD83D", 1))
        assertEquals(4, utf8Offset("😀", 2))
        assertEquals(3, utf8Offset("日", 1))
        assertEquals(2, utf8Offset("é", 1))
    }

    @Test
    fun theMentionTypedAtTheCaret() {
        assertEquals(TypedMention('@', "", 0, 1), currentMention("@", 1))
        assertEquals(TypedMention('@', "pri", 4, 8), currentMention("hey @pri", 8))
        assertEquals(TypedMention('#', "des", 4, 8), currentMention("see #des and", 8))
        assertEquals(TypedMention('@', "pr", 2, 5), currentMention("😀@pr", 5))
        assertEquals(TypedMention('@', "a-b_c9", 0, 7), currentMention("@a-b_c9", 7))
        // The caret in the middle of a name: the query is what is before it.
        assertEquals(TypedMention('@', "pr", 0, 3), currentMention("@priya", 3))
        assertNull("a space ends it", currentMention("@pri ya", 7))
        assertNull("no trigger", currentMention("hello", 5))
        assertNull("non-ASCII ends a name, as the web's \\w", currentMention("@é", 2))
        assertNull("an emoji ends a name", currentMention("@😀", 3))
        assertNull("out of range", currentMention("@a", 5))
        assertNull(currentMention("@a", -1))
        assertEquals("an email matches, as on the web", TypedMention('@', "example", 3, 11), currentMention("ava@example", 11))
    }

    @Test
    fun insertingAPickedMentionReplacesWhatWasTyped() {
        assertEquals("hey @priya " to 11, insertMention("hey @pri", 8, "@priya"))
        assertEquals("hey @priya  there" to 11, insertMention("hey @pri there", 8, "@priya"))
        assertEquals("😀 #design " to 11, insertMention("😀 #de", 6, "#design"))
        assertEquals("no trigger: at the caret", "ab@priya c" to 9, insertMention("abc", 2, "@priya"))
        assertEquals("no prefix gets an @", "@sam " to 5, insertMention("@s", 2, "sam"))
        assertEquals("a caret inside a pair moves before it", "@priya 😀" to 7, insertMention("😀", 1, "@priya"))
        assertEquals("past the end clamps", "x@priya " to 8, insertMention("x", 50, "@priya"))
    }

    @Test
    fun picksStillInTheTextBecomeMentions() {
        val text = "@priya and @priya_r in #design, @here!"
        val found = findMentions(text, listOf(priya, priyaR, design, here))
        assertEquals(listOf("@priya", "@priya_r", "#design", "@here"), found.map { text.substring(it.start, it.end) })
        assertEquals(listOf(priya, priyaR, design, here), found.map { it.suggestion })
        // A picked name edited after picking no longer matches; a longer word isn't the mention.
        assertEquals(emptyList<FoundMention>(), findMentions("@priyanka @pri", listOf(priya)))
        // An email address's @ is not a mention start.
        assertEquals(emptyList<FoundMention>(), findMentions("mail me@priya now", listOf(priya)))
        assertEquals(emptyList<FoundMention>(), findMentions("a.@priya", listOf(priya)))
        assertEquals(1, findMentions("(@priya)", listOf(priya)).size)
        assertEquals(emptyList<FoundMention>(), findMentions("", listOf(priya)))
    }

    @Test
    fun draftMentionsAreByteRangesAroundEmojiAndPairs() {
        val cases = listOf(
            "@priya" to listOf(0u to 6u),
            "😀 @priya" to listOf(5u to 11u),
            "👩‍👩‍👧‍👦 @priya 😀 #design" to listOf(26u to 32u, 38u to 45u),
            "日本 @priya" to listOf(7u to 13u),
            "é́@priya" to listOf(4u to 10u),
            "\uD83D @priya" to listOf(4u to 10u),
            "🇬🇧@priya🇯🇵#design" to listOf(8u to 14u, 22u to 29u),
        )
        for ((text, ranges) in cases) {
            val mentions = draftMentions(wellFormed(text), listOf(priya, design))
            assertEquals(text, ranges, mentions.map { it.start to it.end })
            val bytes = wellFormed(text).toByteArray(Charsets.UTF_8)
            mentions.forEach { m ->
                val cut = String(bytes, m.start.toInt(), (m.end - m.start).toInt(), Charsets.UTF_8)
                assertEquals("the bytes of \"$text\" name the mention", if (m.kind == MentionKind.CHANNEL) "#design" else "@priya", cut)
            }
        }
        val kinds = draftMentions("@priya #design @here", listOf(priya, design, here))
        assertEquals(listOf(MentionKind.USER, MentionKind.CHANNEL, MentionKind.SPECIAL), kinds.map { it.kind })
        assertEquals(listOf("u-priya", "ch-design", "here"), kinds.map { it.id })
    }

    @Test
    fun aNameTypedOutInFullIsAMentionWhenTheLookupKnowsIt() {
        val known = mapOf("@priya" to priya, "#design" to design)
        val text = "hi @priya and #design, not @priyanka or @nobody"
        val found = findMentions(text, emptyList()) { known[it] }
        assertEquals(listOf("@priya", "#design"), found.map { text.substring(it.start, it.end) })
        // A pick wins over the lookup, and the lookup's answer must be the whole token.
        val wrong = MentionSuggestion(SuggestionKind.User, "u-x", "X", "@pri")
        assertEquals(emptyList<FoundMention>(), findMentions("@priya", emptyList()) { wrong })
        assertEquals(listOf(priyaR), findMentions("@priya_r", listOf(priyaR)) { priya }.map { it.suggestion })
        assertEquals("a lone @ looks nothing up", emptyList<FoundMention>(), findMentions("@ #", emptyList()) { error("asked") })
    }

    @Test
    fun timeLeftAndRoleLists() {
        assertEquals("1 s", timeLeftText(0))
        assertEquals("1 s", timeLeftText(1))
        assertEquals("42 s", timeLeftText(41_001))
        assertEquals("59 s", timeLeftText(59_000))
        assertEquals("1 min", timeLeftText(60_000))
        assertEquals("2 min", timeLeftText(60_001))
        assertEquals("12 min", timeLeftText(12 * 60_000L))
        assertEquals("1 h", timeLeftText(60 * 60_000L))
        assertEquals("2 h 5 min", timeLeftText((2 * 60 + 5) * 60_000L))
        assertEquals("", roleList(emptyList()))
        assertEquals("Mods", roleList(listOf("Mods")))
        assertEquals("Moderator and Admin", roleList(listOf("Moderator", "Admin")))
        assertEquals("A, B and C", roleList(listOf("A", "B", "C")))
    }

    private fun permissions(post: Boolean = true, roles: List<String> = emptyList(), until: Long? = null) = ChannelPermissions(
        post = post, attach = true, react = true, threadReply = true, connect = true, speak = true, video = true,
        share = true, managePermissions = false, postingRoleNames = roles, timedOutUntilMs = until,
    )

    @Test
    fun whoMayPost() {
        val now = 1_000_000L
        assertEquals(ComposerAccess.Open, composerAccess(null, "general", now))
        assertEquals(ComposerAccess.Open, composerAccess(permissions(), "general", now))
        assertEquals(
            ComposerAccess.Blocked("You can't send messages in #general", BlockedKind.NoPermission),
            composerAccess(permissions(post = false), "general", now),
        )
        assertEquals(
            ComposerAccess.Blocked("You can't send messages in this channel", BlockedKind.NoPermission),
            composerAccess(permissions(post = false), "", now),
        )
        assertEquals(
            ComposerAccess.Blocked("#news is read-only. Only Moderator and Admin can post.", BlockedKind.ReadOnly),
            composerAccess(permissions(post = false, roles = listOf("Moderator", "Admin")), "news", now),
        )
        assertEquals(
            "a timeout wins over everything",
            ComposerAccess.Blocked("Timed out, 2 min left", BlockedKind.TimedOut),
            composerAccess(permissions(post = false, until = now + 90_000), "general", now),
        )
        assertEquals("a timeout that is over", ComposerAccess.Open, composerAccess(permissions(until = now), "general", now))
    }

    @Test
    fun theCapsAreTheDesignCratesAndRustCutsWhatKotlinMeant() {
        assumeTrue("needs semaphore.hostLibDir (native/scripts/android.sh)", System.getProperty("semaphore.hostLibDir") != null)
        val caps = uniffi.semaphore.composerCaps()
        assertEquals(ComposerCaps.PHONE_ROWS, caps.phoneRows.toInt())
        assertEquals(ComposerCaps.KEYBOARD_ROWS, caps.keyboardRows.toInt())
        assertEquals(ComposerCaps.SUGGESTIONS_SHOWN, caps.suggestionsShown.toInt())

        val plain = TextStyle(bold = false, italic = false, strikethrough = false, code = false)
        // The FFI refuses a lone surrogate outright, which is why everything sent is made well formed.
        assertThrows(Exception::class.java) { uniffi.semaphore.messagePieces("\uD83D", emptyList()) }
        for (prefix in awkward) {
            val text = wellFormed("$prefix @priya ${prefix.reversed()} #design end")
            val mentions = draftMentions(text, listOf(priya, design))
            assertEquals(text, 2, mentions.size)
            // The mention ranges as segments: Rust slices the same characters out of the text.
            val segs = mentions.flatMap { m ->
                listOf(TextSeg(m.start, SegKind.Text, plain), TextSeg(m.end, SegKind.UserMention("x"), plain))
            } + TextSeg(text.toByteArray(Charsets.UTF_8).size.toUInt(), SegKind.Text, plain)
            val pieces = uniffi.semaphore.messagePieces(text, segs)
            val mentioned = pieces.filter { it.kind is SegKind.UserMention }.map { it.text }
            assertEquals(text, listOf("@priya", "#design"), mentioned)
            assertEquals(text, pieces.joinToString("") { it.text })
        }
    }
}
