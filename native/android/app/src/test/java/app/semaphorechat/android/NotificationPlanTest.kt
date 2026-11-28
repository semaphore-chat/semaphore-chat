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
    // Core's ids are UUIDs, and [TapExtras.linkOf] accepts only that shape.
    private val community = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d01"
    private val channel = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d02"
    private val dm = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d03"
    private val parent = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d04"
    private val otherCommunity = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d05"
    private val message = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d06"
    private val otherMessage = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d07"
    private val threadMessage = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d08"

    private fun channelNotification(
        kind: NotificationKind = NotificationKind.MENTION,
        sound: NotifySound? = NotifySound.MENTION,
        parentId: String? = null,
    ) = OsNotification(
        id = "n1",
        tag = "channel:$channel",
        kind = kind,
        title = "Priya mentioned you in #general",
        body = "are you around?",
        link = MessageLink(communityId = community, conversation = Conversation.Channel(channel), messageId = message),
        parentMessageId = parentId,
        sound = sound,
    )

    private fun dmNotification() = OsNotification(
        id = "n2",
        tag = "dm:$dm",
        kind = NotificationKind.DIRECT_MESSAGE,
        title = "Priya",
        body = "hi",
        link = MessageLink(communityId = null, conversation = Conversation.DirectMessage(dm), messageId = otherMessage),
        parentMessageId = null,
        sound = NotifySound.DM,
    )

    @Test
    fun eachKindHasItsChannelAndItsLockScreenText() {
        val cases = listOf(
            Triple(NotificationKind.MENTION, NotifyChannels.MENTIONS, NotifyText.NEW_MENTION),
            Triple(NotificationKind.DIRECT_MESSAGE, NotifyChannels.DIRECT_MESSAGES, NotifyText.NEW_MESSAGE),
            Triple(NotificationKind.THREAD_REPLY, NotifyChannels.MENTIONS, NotifyText.NEW_REPLY),
            Triple(NotificationKind.CHANNEL_MESSAGE, NotifyChannels.CHANNEL_MESSAGES, NotifyText.NEW_MESSAGE),
            // Never planned (CoreStore drops a call) but the plan still has an answer for it.
            Triple(NotificationKind.INCOMING_CALL, NotifyChannels.MENTIONS, NotifyText.NEW_MESSAGE),
        )
        cases.forEach { (kind, channelName, text) ->
            val plan = NotificationPlan.of(channelNotification(kind))
            assertEquals("$kind", kind, plan.kind)
            assertEquals("$kind", channelName, plan.channel)
            assertEquals("$kind", text, plan.publicText)
        }
        assertEquals(NotificationKind.entries.toSet(), cases.map { it.first }.toSet())
        val direct = NotificationPlan.of(dmNotification())
        assertEquals(NotifyChannels.DIRECT_MESSAGES, direct.channel)
        assertEquals(NotifyText.NEW_MESSAGE, direct.publicText)
        assertEquals("dm:$dm", direct.tag)
        // Core's kind is the plan's, even for a thread reply in a channel (a thread's link is its
        // channel's, so the conversation alone could not tell them apart).
        assertEquals(
            NotificationKind.THREAD_REPLY,
            NotificationPlan.of(channelNotification(NotificationKind.THREAD_REPLY, parentId = parent)).kind,
        )
    }

    @Test
    fun silentWithNoSoundAndPrivateWithABodylessPublicVersion() {
        assertTrue(NotificationPlan.of(channelNotification(sound = null)).silent)
        NotifySound.entries.forEach { assertFalse("$it", NotificationPlan.of(channelNotification(sound = it)).silent) }
        val plan = NotificationPlan.of(channelNotification())
        assertEquals("channel:$channel", plan.tag)
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
            MessageLink(community, Conversation.Channel(channel), message),
            MessageLink(null, Conversation.DirectMessage(dm), null),
            MessageLink(otherCommunity, Conversation.Thread(parent), threadMessage),
        )
        links.forEach { link ->
            val extras = TapExtras.of(link, parentMessageId = null)
            assertEquals(link, TapExtras.linkOf { extras[it] })
        }
        val reply = NotificationPlan.of(channelNotification(parentId = parent)).extras
        assertEquals(parent, reply[TapExtras.PARENT])
        assertEquals(MessageLink(community, Conversation.Channel(channel), message), TapExtras.linkOf { reply[it] })
        // Not a tap's extras: no link.
        assertNull(TapExtras.linkOf { null })
        assertNull(TapExtras.linkOf { mapOf(TapExtras.ID to "x", TapExtras.KIND to "other")[it] })
    }

    @Test
    fun idsThatAreNotUUIDsAreNotATap() {
        val extras = TapExtras.of(MessageLink(community, Conversation.Channel(channel), message), parentMessageId = null)
        // The activity is exported: another app may start it with extras of its own shape.
        listOf(TapExtras.COMMUNITY, TapExtras.ID, TapExtras.MESSAGE).forEach { key ->
            val tampered = extras + (key to "../../etc/passwd")
            assertNull("$key", TapExtras.linkOf { tampered[it] })
        }
        val reply = NotificationPlan.of(channelNotification(parentId = parent)).extras
        assertNull(TapExtras.linkOf { (reply + (TapExtras.PARENT to "p9"))[it] })
        // A missing optional id stays a tap.
        val minimal = extras - TapExtras.MESSAGE - TapExtras.COMMUNITY
        assertEquals(
            MessageLink(null, Conversation.Channel(channel), null),
            TapExtras.linkOf { minimal[it] },
        )
    }
}
