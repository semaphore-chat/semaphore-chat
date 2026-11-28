// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import androidx.core.app.NotificationCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.semaphore.Conversation
import uniffi.semaphore.MessageLink
import uniffi.semaphore.NotificationKind
import uniffi.semaphore.NotifySound
import uniffi.semaphore.OsNotification

/** [NotificationPlan] and [TapExtras]: plain functions over core's [OsNotification]. */
class NotificationPlanTest {
    private fun channelNotification(sound: NotifySound? = NotifySound.MENTION, parent: String? = null) = OsNotification(
        id = "n1",
        tag = "channel:c1",
        title = "Priya mentioned you in #general",
        body = "are you around?",
        link = MessageLink(communityId = "k1", conversation = Conversation.Channel("c1"), messageId = "m1"),
        parentMessageId = parent,
        sound = sound,
    )

    private fun dmNotification() = OsNotification(
        id = "n2",
        tag = "dm:d1",
        title = "Priya",
        body = "hi",
        link = MessageLink(communityId = null, conversation = Conversation.DirectMessage("d1"), messageId = "m2"),
        parentMessageId = null,
        sound = NotifySound.DM,
    )

    @Test
    fun eachKindHasItsChannelAndItsLockScreenText() {
        val cases = listOf(
            Triple(NotificationKind.MENTION, NotifyChannels.MENTIONS, NotifyText.NEW_MENTION),
            Triple(NotificationKind.THREAD_REPLY, NotifyChannels.MENTIONS, NotifyText.NEW_REPLY),
            Triple(NotificationKind.CHANNEL_MESSAGE, NotifyChannels.CHANNEL_MESSAGES, NotifyText.NEW_MESSAGE),
        )
        cases.forEach { (kind, channel, text) ->
            val plan = NotificationPlan.of(channelNotification(), kind)
            assertEquals("$kind", kind, plan.kind)
            assertEquals("$kind", channel, plan.channel)
            assertEquals("$kind", text, plan.publicText)
        }
        val dm = NotificationPlan.of(dmNotification(), NotificationKind.DIRECT_MESSAGE)
        assertEquals(NotifyChannels.DIRECT_MESSAGES, dm.channel)
        assertEquals(NotifyText.NEW_MESSAGE, dm.publicText)
        assertEquals("dm:d1", dm.tag)
    }

    @Test
    fun aKindCoreDidNotNameIsInferred() {
        // A DM's conversation is a DM whatever core's list says (an incoming call has no row).
        assertEquals(NotificationKind.DIRECT_MESSAGE, NotificationPlan.of(dmNotification(), null).kind)
        assertEquals(NotificationKind.THREAD_REPLY, NotificationPlan.of(channelNotification(parent = "p1"), null).kind)
        assertEquals(NotificationKind.MENTION, NotificationPlan.of(channelNotification(), null).kind)
        // Core's own kind wins over the guess.
        assertEquals(NotificationKind.CHANNEL_MESSAGE, NotificationPlan.of(channelNotification(), NotificationKind.CHANNEL_MESSAGE).kind)
    }

    @Test
    fun silentWithNoSoundAndPrivateWithABodylessPublicVersion() {
        assertTrue(NotificationPlan.of(channelNotification(sound = null)).silent)
        NotifySound.entries.forEach { assertFalse("$it", NotificationPlan.of(channelNotification(sound = it)).silent) }
        val plan = NotificationPlan.of(channelNotification())
        assertEquals("channel:c1", plan.tag)
        assertEquals("Priya mentioned you in #general", plan.title)
        assertEquals("are you around?", plan.body)
        assertEquals(NotificationCompat.VISIBILITY_PRIVATE, plan.visibility)
        assertEquals("Semaphore", plan.publicTitle)
        // Nothing of the message, its author or its channel on the lock screen.
        listOf("Priya", "general", "around").forEach {
            assertFalse(it, plan.publicTitle.contains(it) || plan.publicText.contains(it))
        }
    }

    @Test
    fun tapExtrasRoundTripToTheLink() {
        val links = listOf(
            MessageLink("k1", Conversation.Channel("c1"), "m1"),
            MessageLink(null, Conversation.DirectMessage("d1"), null),
            MessageLink("k2", Conversation.Thread("p1"), "m3"),
        )
        links.forEach { link ->
            val extras = TapExtras.of(link, parentMessageId = null)
            assertEquals(link, TapExtras.linkOf { extras[it] })
        }
        val reply = NotificationPlan.of(channelNotification(parent = "p9")).extras
        assertEquals("p9", reply[TapExtras.PARENT])
        assertEquals(MessageLink("k1", Conversation.Channel("c1"), "m1"), TapExtras.linkOf { reply[it] })
        // Not a tap's extras: no link.
        assertNull(TapExtras.linkOf { null })
        assertNull(TapExtras.linkOf { mapOf(TapExtras.ID to "x", TapExtras.KIND to "other")[it] })
    }
}
