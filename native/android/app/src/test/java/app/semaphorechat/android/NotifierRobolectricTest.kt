// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import uniffi.semaphore.Conversation
import uniffi.semaphore.MessageLink
import uniffi.semaphore.NotificationKind
import uniffi.semaphore.NotifySound
import uniffi.semaphore.OsNotification

/**
 * [AndroidNotifier] against Android's own NotificationManager (Robolectric's shadow): the channels,
 * a post's tag, visibility and public version, withdrawing, sign-out clearing, and when
 * [NotificationPermission] asks.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NotifierRobolectricTest {
    private val app = RuntimeEnvironment.getApplication()
    private val manager = app.getSystemService(NotificationManager::class.java)

    private fun mention(channel: String, body: String = "are you around?") = OsNotification(
        id = "n-$channel",
        tag = "channel:$channel",
        title = "Priya mentioned you in #general",
        body = body,
        link = MessageLink("k1", Conversation.Channel(channel), "m-$channel"),
        parentMessageId = null,
        sound = NotifySound.MENTION,
    )

    private fun posted(tag: String) = manager.activeNotifications.firstOrNull { it.tag == tag }

    @Test
    fun theChannelsAreCreated() {
        AndroidNotifier(app)
        val channels = manager.notificationChannels.associateBy { it.id }
        assertEquals(
            setOf(NotifyChannels.DIRECT_MESSAGES, NotifyChannels.MENTIONS, NotifyChannels.CHANNEL_MESSAGES, NotifyChannels.CONNECTION),
            channels.keys,
        )
        assertEquals("Direct messages", channels.getValue(NotifyChannels.DIRECT_MESSAGES).name)
        assertEquals("Mentions and replies", channels.getValue(NotifyChannels.MENTIONS).name)
        assertEquals("Channel messages", channels.getValue(NotifyChannels.CHANNEL_MESSAGES).name)
        listOf(NotifyChannels.DIRECT_MESSAGES, NotifyChannels.MENTIONS, NotifyChannels.CHANNEL_MESSAGES).forEach {
            assertEquals(it, NotificationManager.IMPORTANCE_HIGH, channels.getValue(it).importance)
        }
        assertEquals(NotificationManager.IMPORTANCE_LOW, channels.getValue(NotifyChannels.CONNECTION).importance)
    }

    @Test
    fun aPostCarriesItsTagPrivateVisibilityAndAPublicVersionWithoutTheMessage() {
        val notifier = AndroidNotifier(app)
        notifier.show(mention("c1"), NotificationKind.MENTION)
        val shown = checkNotNull(posted("channel:c1")) { "not posted" }
        assertEquals(0, shown.id)
        val notification = shown.notification
        assertEquals(NotifyChannels.MENTIONS, notification.channelId)
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility)
        assertEquals("Priya mentioned you in #general", notification.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("are you around?", notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        val public = checkNotNull(notification.publicVersion) { "no public version" }
        assertEquals("Semaphore", public.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("New mention", public.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertFalse(
            listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_BIG_TEXT)
                .any { public.extras.getCharSequence(it)?.contains("around") == true },
        )
        // The tap opens MainActivity with the link.
        val tap = shadowOf(notification.contentIntent).savedIntent
        assertEquals(MainActivity::class.java.name, tap.component?.className)
        assertEquals(MessageLink("k1", Conversation.Channel("c1"), "m-c1"), TapExtras.linkOf(tap.extras))
        // One summary for the group.
        assertTrue(posted(AndroidNotifier.SUMMARY_TAG)!!.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0)

        // A newer one in the same conversation replaces it.
        notifier.show(mention("c1", body = "still there?"), NotificationKind.MENTION)
        assertEquals(1, manager.activeNotifications.count { it.tag == "channel:c1" })
        assertEquals("still there?", posted("channel:c1")!!.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
    }

    @Test
    fun withdrawCancelsItsConversationAndSignOutCancelsEverything() {
        val notifier = AndroidNotifier(app)
        notifier.show(mention("c1"), NotificationKind.MENTION)
        notifier.show(mention("c2"), null)
        notifier.withdraw("channel:c1")
        assertEquals(null, posted("channel:c1"))
        assertNotNull(posted("channel:c2"))
        assertNotNull("the summary stays while one is left", posted(AndroidNotifier.SUMMARY_TAG))
        notifier.withdraw("channel:c2")
        assertTrue("the summary goes with the last", manager.activeNotifications.isEmpty())

        notifier.show(mention("c3"), NotificationKind.MENTION)
        notifier.show(mention("c4"), NotificationKind.MENTION)
        notifier.clearAll()
        assertTrue(manager.activeNotifications.isEmpty())
    }

    @Test
    fun nothingIsPostedWhileNotificationsAreOff() {
        shadowOf(manager).setNotificationsEnabled(false)
        AndroidNotifier(app).show(mention("c1"), NotificationKind.MENTION)
        assertTrue(manager.activeNotifications.isEmpty())
    }

    @Test
    fun thePermissionIsAskedOnceOnApi33AndNeverOnApi32() {
        val prefs = app.getSharedPreferences("test-permission", Context.MODE_PRIVATE).also { it.edit().clear().commit() }
        var asked = 0
        val on33 = NotificationPermission(prefs, sdkInt = 33, granted = { false })
        assertTrue(on33.maybeAsk { asked++ })
        assertEquals(1, asked)
        // Remembered: not again, whatever the answer was.
        assertFalse(on33.maybeAsk { asked++ })
        assertFalse(NotificationPermission(prefs, sdkInt = 33, granted = { false }).maybeAsk { asked++ })
        assertEquals(1, asked)

        val fresh = app.getSharedPreferences("test-permission-32", Context.MODE_PRIVATE).also { it.edit().clear().commit() }
        assertFalse(NotificationPermission(fresh, sdkInt = 32, granted = { false }).maybeAsk { asked++ })
        // Granted already (a 33 device that granted it in settings): nothing to ask.
        assertFalse(NotificationPermission(fresh, sdkInt = 34, granted = { true }).maybeAsk { asked++ })
        assertEquals(1, asked)
        // And the real one, on this (API 34) context, would ask: nothing granted yet.
        assertTrue(NotificationPermission.of(app).maybeAsk { asked++ })
        assertEquals(2, asked)
    }
}
