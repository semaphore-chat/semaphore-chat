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
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
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
 * a post's tag, visibility and public version, one tap per conversation, withdrawing, sign-out
 * clearing, and when [NotificationPermission] asks.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NotifierRobolectricTest {
    private val app = RuntimeEnvironment.getApplication()
    private val manager = app.getSystemService(NotificationManager::class.java)

    /** A conversation id of core's shape. */
    private fun id(n: Int) = "0f6f0c1e-2f4a-4b31-9d6e-3c1a2b4c5d%02d".format(n)

    /** The shadow keeps "notifications enabled" from one test to the next; every test but the one
     * about it wants them on. */
    @Before
    fun notificationsOn() {
        shadowOf(manager).setNotificationsEnabled(true)
    }

    private fun mention(channel: String, body: String = "are you around?") = OsNotification(
        id = "n-$channel",
        tag = "channel:$channel",
        kind = NotificationKind.MENTION,
        title = "Priya mentioned you in #general",
        body = body,
        link = MessageLink(id(90), Conversation.Channel(channel), id(91)),
        parentMessageId = null,
        sound = NotifySound.MENTION,
    )

    private fun posted(tag: String) = manager.activeNotifications.firstOrNull { it.tag == tag }

    private fun tapOf(tag: String) =
        TapExtras.linkOf(shadowOf(checkNotNull(posted(tag)) { "not posted: $tag" }.notification.contentIntent).savedIntent.extras)

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
        notifier.show(mention(id(1)))
        val shown = checkNotNull(posted("channel:${id(1)}")) { "not posted" }
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
        assertEquals(MessageLink(id(90), Conversation.Channel(id(1)), id(91)), TapExtras.linkOf(tap.extras))
        // One summary for the group.
        assertTrue(posted(AndroidNotifier.SUMMARY_TAG)!!.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0)

        // A newer one in the same conversation replaces it.
        notifier.show(mention(id(1), body = "still there?"))
        assertEquals(1, manager.activeNotifications.count { it.tag == "channel:${id(1)}" })
        assertEquals("still there?", posted("channel:${id(1)}")!!.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
    }

    @Test
    fun eachConversationHasATapOfItsOwn() {
        val notifier = AndroidNotifier(app)
        notifier.show(mention(id(1)))
        notifier.show(mention(id(2)))
        // Intents with equal filters are one PendingIntent whatever their extras: without the
        // conversation's own data Uri, both taps would carry the second's link.
        assertNotEquals(
            posted("channel:${id(1)}")!!.notification.contentIntent,
            posted("channel:${id(2)}")!!.notification.contentIntent,
        )
        assertEquals(Conversation.Channel(id(1)), tapOf("channel:${id(1)}")?.conversation)
        assertEquals(Conversation.Channel(id(2)), tapOf("channel:${id(2)}")?.conversation)
    }

    @Test
    fun withdrawCancelsItsConversationAndSignOutCancelsEverything() {
        val notifier = AndroidNotifier(app)
        notifier.show(mention(id(1)))
        notifier.show(mention(id(2)))
        notifier.withdraw("channel:${id(1)}")
        assertEquals(null, posted("channel:${id(1)}"))
        assertNotNull(posted("channel:${id(2)}"))
        assertNotNull("the summary stays while one is left", posted(AndroidNotifier.SUMMARY_TAG))
        notifier.withdraw("channel:${id(2)}")
        assertTrue("the summary goes with the last", manager.activeNotifications.isEmpty())

        notifier.show(mention(id(3)))
        notifier.show(mention(id(4)))
        notifier.clearAll()
        assertTrue(manager.activeNotifications.isEmpty())
    }

    @Test
    fun nothingIsPostedWhileNotificationsAreOff() {
        shadowOf(manager).setNotificationsEnabled(false)
        AndroidNotifier(app).show(mention(id(1)))
        assertTrue(manager.activeNotifications.isEmpty())
        // A notifier that cannot post stops the connection service there is nothing to feed.
        assertEquals(
            ConnectionService::class.java.name,
            shadowOf(app).nextStoppedService?.component?.className,
        )
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
        // And the real one (the app's own prefs, this device's SDK): nothing granted yet, so it
        // asks.
        assertTrue(NotificationPermission.of(app).maybeAsk { asked++ })
        assertEquals(2, asked)
    }
}
