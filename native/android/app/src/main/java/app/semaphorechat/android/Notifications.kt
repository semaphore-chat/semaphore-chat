// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import uniffi.semaphore.Conversation
import uniffi.semaphore.MessageLink
import uniffi.semaphore.NotificationKind
import uniffi.semaphore.OsNotification

/**
 * Where core's notifications go. Core decides whether one is due (`notify.rs::decide`: the
 * per-channel levels, the DM switch, `desktopEnabled` as the master switch, do-not-disturb, the
 * focused conversation, and the sound); this only shows, withdraws and clears.
 */
interface Notifier {
    /** [kind] is core's, when its notification list knows the id; else [NotificationPlan] infers it. */
    fun show(notification: OsNotification, kind: NotificationKind?)

    /** The conversation was read, here or elsewhere: its notification goes. */
    fun withdraw(tag: String)

    /** The session ended: every message notification goes. */
    fun clearAll()

    object None : Notifier {
        override fun show(notification: OsNotification, kind: NotificationKind?) = Unit
        override fun withdraw(tag: String) = Unit
        override fun clearAll() = Unit
    }
}

/** The app's notification channels, created once ([AndroidNotifier.createChannels]). */
object NotifyChannels {
    const val DIRECT_MESSAGES = "direct_messages"
    const val MENTIONS = "mentions_replies"
    const val CHANNEL_MESSAGES = "channel_messages"
    const val CONNECTION = "connection"
}

/** What the lock screen may show of a message notification: the app's name and the kind. */
object NotifyText {
    const val APP = "Semaphore"
    const val NEW_MESSAGE = "New message"
    const val NEW_MENTION = "New mention"
    const val NEW_REPLY = "New reply"
}

/**
 * A notification tap's extras: the [MessageLink] (and the thread, for a reply) as plain strings,
 * so the immutable `PendingIntent` carries no parcelable of ours.
 */
object TapExtras {
    const val COMMUNITY = "semaphore.link.community"
    const val KIND = "semaphore.link.kind"
    const val ID = "semaphore.link.id"
    const val MESSAGE = "semaphore.link.message"
    const val PARENT = "semaphore.link.parent"

    private const val CHANNEL = "channel"
    private const val DM = "dm"
    private const val THREAD = "thread"

    fun of(link: MessageLink, parentMessageId: String?): Map<String, String> = buildMap {
        link.communityId?.let { put(COMMUNITY, it) }
        when (val conversation = link.conversation) {
            is Conversation.Channel -> { put(KIND, CHANNEL); put(ID, conversation.id) }
            is Conversation.DirectMessage -> { put(KIND, DM); put(ID, conversation.id) }
            is Conversation.Thread -> { put(KIND, THREAD); put(ID, conversation.parentMessageId) }
        }
        link.messageId?.let { put(MESSAGE, it) }
        parentMessageId?.let { put(PARENT, it) }
    }

    /** The link back out of [of]'s extras, or null when they aren't a tap's. */
    fun linkOf(get: (String) -> String?): MessageLink? {
        val id = get(ID) ?: return null
        val conversation = when (get(KIND)) {
            CHANNEL -> Conversation.Channel(id)
            DM -> Conversation.DirectMessage(id)
            THREAD -> Conversation.Thread(id)
            else -> return null
        }
        return MessageLink(communityId = get(COMMUNITY), conversation = conversation, messageId = get(MESSAGE))
    }

    fun put(intent: Intent, extras: Map<String, String>): Intent = intent.apply { extras.forEach { (k, v) -> putExtra(k, v) } }

    fun linkOf(extras: Bundle?): MessageLink? = extras?.let { bundle -> linkOf { bundle.getString(it) } }
}

/**
 * How one of core's [OsNotification]s is posted: pure, so the JVM test checks it without Android.
 * The lock screen gets [publicTitle] and [publicText] only (`VISIBILITY_PRIVATE` with a public
 * version): no name, no channel, no words.
 */
data class NotificationPlan(
    val tag: String,
    val kind: NotificationKind,
    val channel: String,
    val title: String,
    val body: String,
    /** Core chose no sound (`playSound` off, or a call's ring). */
    val silent: Boolean,
    val visibility: Int,
    val publicTitle: String,
    val publicText: String,
    val extras: Map<String, String>,
) {
    companion object {
        /**
         * Core's [OsNotification] carries no kind, so it is core's own (from its notification
         * list) when known; otherwise a DM's conversation says DM, a thread parent says reply, and
         * anything else is a mention (a channel notifies only mentions unless set to All).
         */
        fun kindOf(notification: OsNotification, known: NotificationKind?): NotificationKind = when {
            notification.link.conversation is Conversation.DirectMessage -> NotificationKind.DIRECT_MESSAGE
            known != null -> known
            notification.parentMessageId != null -> NotificationKind.THREAD_REPLY
            else -> NotificationKind.MENTION
        }

        fun channelOf(kind: NotificationKind): String = when (kind) {
            NotificationKind.DIRECT_MESSAGE -> NotifyChannels.DIRECT_MESSAGES
            NotificationKind.MENTION, NotificationKind.THREAD_REPLY -> NotifyChannels.MENTIONS
            NotificationKind.CHANNEL_MESSAGE -> NotifyChannels.CHANNEL_MESSAGES
        }

        fun publicTextOf(kind: NotificationKind): String = when (kind) {
            NotificationKind.MENTION -> NotifyText.NEW_MENTION
            NotificationKind.THREAD_REPLY -> NotifyText.NEW_REPLY
            NotificationKind.DIRECT_MESSAGE, NotificationKind.CHANNEL_MESSAGE -> NotifyText.NEW_MESSAGE
        }

        fun of(notification: OsNotification, known: NotificationKind? = null): NotificationPlan {
            val kind = kindOf(notification, known)
            return NotificationPlan(
                tag = notification.tag,
                kind = kind,
                channel = channelOf(kind),
                title = notification.title,
                body = notification.body,
                silent = notification.sound == null,
                visibility = NotificationCompat.VISIBILITY_PRIVATE,
                publicTitle = NotifyText.APP,
                publicText = publicTextOf(kind),
                extras = TapExtras.of(notification.link, notification.parentMessageId),
            )
        }
    }
}

/**
 * Asks for `POST_NOTIFICATIONS` once (API 33+), the first time a session is signed in, and never
 * again in D7: "asked" is remembered in [prefs] whatever the answer. Below 33 the permission is
 * granted at install and nothing is asked.
 */
class NotificationPermission(
    private val prefs: SharedPreferences,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
    private val granted: () -> Boolean,
) {
    /** Calls [request] (the activity's `RequestPermission` launcher) when it should ask; returns whether it did. */
    fun maybeAsk(request: () -> Unit): Boolean {
        if (sdkInt < 33 || granted() || prefs.getBoolean(ASKED, false)) return false
        prefs.edit().putBoolean(ASKED, true).apply()
        request()
        return true
    }

    companion object {
        const val PREFS = "notifications"
        const val ASKED = "asked_post_notifications"
        const val PERMISSION = Manifest.permission.POST_NOTIFICATIONS

        fun of(context: Context) = NotificationPermission(
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE),
            granted = { ContextCompat.checkSelfPermission(context, PERMISSION) == PackageManager.PERMISSION_GRANTED },
        )
    }
}

/**
 * [Notifier] over the system's NotificationManager. One notification per conversation (core's
 * tag, id 0), so a newer message replaces the older one and a read withdraws it, under one group
 * summary. Logs ids and kinds only: never a title, a body or a name.
 */
class AndroidNotifier(private val context: Context) : Notifier {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        createChannels(context)
    }

    override fun show(notification: OsNotification, kind: NotificationKind?) {
        val plan = NotificationPlan.of(notification, kind)
        if (!manager.areNotificationsEnabled()) {
            Log.i(TAG, "not posting ${notification.id} (${plan.kind}): notifications are off")
            return
        }
        val tap = PendingIntent.getActivity(
            context,
            plan.tag.hashCode(),
            TapExtras.put(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), plan.extras),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val public = NotificationCompat.Builder(context, plan.channel)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(plan.publicTitle)
            .setContentText(plan.publicText)
            .build()
        val built = NotificationCompat.Builder(context, plan.channel)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(plan.title)
            .setContentText(plan.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(plan.body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(plan.visibility)
            .setPublicVersion(public)
            .setSilent(plan.silent)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setGroup(GROUP)
            .build()
        try {
            manager.notify(plan.tag, 0, built)
            manager.notify(SUMMARY_TAG, 0, summary())
            Log.i(TAG, "posted ${notification.id} (${plan.kind})")
        } catch (refused: SecurityException) {
            // The permission was revoked between the check and the post.
            Log.w(TAG, "not posting ${notification.id} (${plan.kind}): ${refused.javaClass.simpleName}")
        }
    }

    override fun withdraw(tag: String) {
        manager.cancel(tag, 0)
        // The summary goes with the last of its group.
        val left = manager.activeNotifications.count { it.tag != null && it.tag != SUMMARY_TAG && it.notification.group == GROUP && it.tag != tag }
        if (left == 0) manager.cancel(SUMMARY_TAG, 0)
        Log.i(TAG, "withdrew a ${tag.substringBefore(':')} notification")
    }

    override fun clearAll() {
        manager.activeNotifications
            .filter { it.notification.group == GROUP || it.tag == SUMMARY_TAG }
            .forEach { manager.cancel(it.tag, it.id) }
        Log.i(TAG, "cleared the session's notifications")
    }

    private fun summary() = NotificationCompat.Builder(context, NotifyChannels.MENTIONS)
        .setSmallIcon(android.R.drawable.stat_notify_chat)
        .setContentTitle(NotifyText.APP)
        .setContentText(NotifyText.NEW_MESSAGE)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setGroup(GROUP)
        .setGroupSummary(true)
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setSilent(true)
        .setAutoCancel(true)
        .build()

    companion object {
        private const val TAG = "SemaphoreNotify"
        const val GROUP = "semaphore.messages"
        const val SUMMARY_TAG = "summary"

        /** The four channels (API 26+ always has them). Idempotent: the system keeps the user's changes. */
        fun createChannels(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannels(
                listOf(
                    NotificationChannel(NotifyChannels.DIRECT_MESSAGES, "Direct messages", NotificationManager.IMPORTANCE_HIGH),
                    NotificationChannel(NotifyChannels.MENTIONS, "Mentions and replies", NotificationManager.IMPORTANCE_HIGH),
                    NotificationChannel(NotifyChannels.CHANNEL_MESSAGES, "Channel messages", NotificationManager.IMPORTANCE_HIGH),
                    NotificationChannel(NotifyChannels.CONNECTION, "Connection", NotificationManager.IMPORTANCE_LOW).apply {
                        description = "Keeps the chat connected while the app is in the background"
                        setShowBadge(false)
                    },
                ).onEach { it.lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE },
            )
        }
    }
}
