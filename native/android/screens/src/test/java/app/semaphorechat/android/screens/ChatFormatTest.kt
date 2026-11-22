// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens

import app.semaphorechat.android.kit.chat.ChatPiece
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatFormatTest {
    private val utc = ZoneId.of("UTC")
    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int, zone: ZoneId = utc) =
        ZonedDateTime.of(year, month, day, hour, minute, 0, 0, zone).toInstant().toEpochMilli()

    private val now = at(2026, 9, 18, 20, 30)
    private val format = ChatFormat.fixed(now)

    private fun row(key: Long, author: String, ms: Long) =
        ChatMessage(key, "m$key", author, author, ms, listOf(ChatPiece("hi")))

    @Test
    fun theClockFollowsThe12Or24HourSetting() {
        assertEquals("8:19 PM", format.time(at(2026, 9, 18, 20, 19)))
        assertEquals("12:05 AM", format.time(at(2026, 9, 18, 0, 5)))
        assertEquals("20:19", ChatFormat.fixed(now, use24Hour = true).time(at(2026, 9, 18, 20, 19)))
        assertEquals("00:05", ChatFormat.fixed(now, use24Hour = true).time(at(2026, 9, 18, 0, 5)))
    }

    @Test
    fun daysReadTodayYesterdayThenTheDateWithTheYearOnlyWhenItIsAnother() {
        assertEquals("Today", format.dayLabel(at(2026, 9, 18, 0, 0)))
        assertEquals("Yesterday", format.dayLabel(at(2026, 9, 17, 23, 59)))
        assertEquals("Wednesday, September 16", format.dayLabel(at(2026, 9, 16, 12, 0)))
        assertEquals("Wednesday, December 31, 2025", format.dayLabel(at(2025, 12, 31, 12, 0)))
    }

    @Test
    fun theDayIsTheReadersZones() {
        // Now is 05:30 on the 19th in Tokyo; 14:00 UTC on the 18th is 23:00 there, so yesterday.
        val tokyo = ChatFormat(ZoneId.of("Asia/Tokyo"), use24Hour = true) { now }
        val message = at(2026, 9, 18, 14, 0)
        assertEquals("Today", format.dayLabel(message))
        assertEquals("Yesterday", tokyo.dayLabel(message))
        assertEquals("23:00", tokyo.time(message))
    }

    @Test
    fun rowsGroupByAuthorWithinFiveMinutesOnOneDay() {
        val base = at(2026, 9, 18, 10, 0)
        val first = row(1, "a", base)
        assertTrue(continues(first, row(2, "a", base + GROUP_WINDOW_MS - 1), format))
        assertFalse("at the window", continues(first, row(2, "a", base + GROUP_WINDOW_MS), format))
        assertFalse("another author", continues(first, row(2, "b", base + 1000), format))
        assertFalse("earlier, out of order", continues(first, row(2, "a", base - 1), format))
        assertFalse("no author", continues(row(1, "", base), row(2, "", base + 1), format))
        assertFalse("a reply starts a group", continues(first, row(2, "a", base + 1).copy(replyTo = QuoteItem("x", "y")), format))
        assertFalse("after a thread", continues(first.copy(replyCount = 1), row(2, "a", base + 1), format))
        val late = at(2026, 9, 17, 23, 59)
        assertFalse("across midnight", continues(row(1, "a", late), row(2, "a", late + 2 * 60_000), format))
    }

    @Test
    fun entriesPutADayBeforeEachNewDayAndMarkContinuedRows() {
        val y = at(2026, 9, 17, 9, 0)
        val t = at(2026, 9, 18, 9, 0)
        val entries = chatEntries(listOf(row(1, "a", y), row(2, "a", y + 1000), row(3, "a", t), row(4, "b", t + 1000)), format)
        assertEquals(listOf("day-1", "m-1", "m-2", "day-3", "m-3", "m-4"), entries.map { it.key })
        assertEquals(listOf("Yesterday", "Today"), entries.filterIsInstance<ChatEntry.Day>().map { it.label })
        assertEquals(listOf(false, true, false, false), entries.filterIsInstance<ChatEntry.Message>().map { it.continued })
        assertTrue(chatEntries(emptyList(), format).isEmpty())
    }

    @Test
    fun aDayThatComesBackGetsASeparatorWithAKeyOfItsOwn() {
        // Days D, D+1, D: out of day order, as a pending row stamped by a phone clock a day off.
        val d = at(2026, 9, 16, 12, 0)
        val next = at(2026, 9, 17, 12, 0)
        val entries = chatEntries(listOf(row(1, "a", d), row(2, "a", next), row(3, "a", d + 60_000)), format)
        val days = entries.filterIsInstance<ChatEntry.Day>()
        assertEquals(3, days.size)
        assertEquals(days[0].epochDay, days[2].epochDay)
        assertEquals("every key once", entries.size, entries.map { it.key }.toSet().size)
    }
}
