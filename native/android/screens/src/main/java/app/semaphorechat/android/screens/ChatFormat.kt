// Semaphore Chat's Android screens. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Times and days as the chat writes them, in English like the rest of the app: the clock follows
 * the phone's 12/24-hour setting (as Discord mobile does), the days the web's rules (desktop's
 * `messages/format.rs`). The zone, the setting and "now" are parameters, so the stories and the
 * tests don't depend on the device.
 */
class ChatFormat(
    private val zone: ZoneId,
    private val use24Hour: Boolean,
    private val nowMs: () -> Long,
) {
    private val clock12 = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
    private val clock24 = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH)
    private val thisYear = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.ENGLISH)
    private val otherYear = DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", Locale.ENGLISH)

    private fun zoned(ms: Long) = Instant.ofEpochMilli(ms).atZone(zone)

    /** "8:19 PM", or "20:19" with the 24-hour clock. */
    fun time(ms: Long): String = zoned(ms).format(if (use24Hour) clock24 else clock12)

    /** The calendar day, for comparing two rows. */
    fun day(ms: Long): LocalDate = zoned(ms).toLocalDate()

    /** "Today", "Yesterday", "Friday, September 18", with the year when it isn't this year. */
    fun dayLabel(ms: Long): String {
        val today = day(nowMs())
        val day = day(ms)
        return when {
            day == today -> "Today"
            day == today.minusDays(1) -> "Yesterday"
            day.year == today.year -> zoned(ms).format(thisYear)
            else -> zoned(ms).format(otherYear)
        }
    }

    companion object {
        /** A fixed clock in UTC, for stories and tests. */
        fun fixed(nowMs: Long, use24Hour: Boolean = false) = ChatFormat(ZoneOffset.UTC, use24Hour) { nowMs }
    }
}

/** Rows this close together, by one author on one day, are one group (desktop's `GROUP_WINDOW_MS`). */
const val GROUP_WINDOW_MS: Long = 5 * 60 * 1000

/** What the list draws, oldest first: the day separators and the messages. */
sealed interface ChatEntry {
    val key: String

    data class Day(val label: String, val epochDay: Long) : ChatEntry {
        override val key get() = "day-$epochDay"
    }

    /** [continued]: drawn without the avatar and the header, under the row before. */
    data class Message(val message: ChatMessage, val continued: Boolean) : ChatEntry {
        override val key get() = "m-${message.key}"
    }
}

/**
 * Whether [row] continues [previous]'s group: the same author, less than [GROUP_WINDOW_MS] later on
 * the same day, [row] not a reply and [previous] with no thread (desktop's `should_group`).
 */
fun continues(previous: ChatMessage, row: ChatMessage, format: ChatFormat): Boolean {
    if (row.authorId.isEmpty() || row.authorId != previous.authorId) return false
    val gap = row.sentAtMs - previous.sentAtMs
    return gap in 0 until GROUP_WINDOW_MS &&
        format.day(row.sentAtMs) == format.day(previous.sentAtMs) &&
        row.replyTo == null &&
        previous.replyCount == 0
}

/** [messages] (oldest first) with a separator before each new day, and each row's grouping. */
fun chatEntries(messages: List<ChatMessage>, format: ChatFormat): List<ChatEntry> {
    val entries = ArrayList<ChatEntry>(messages.size + 8)
    var previous: ChatMessage? = null
    for (message in messages) {
        val day = format.day(message.sentAtMs)
        val newDay = previous == null || format.day(previous.sentAtMs) != day
        if (newDay) entries += ChatEntry.Day(format.dayLabel(message.sentAtMs), day.toEpochDay())
        val continued = !newDay && previous != null && continues(previous, message, format)
        entries += ChatEntry.Message(message, continued)
        previous = message
    }
    return entries
}
