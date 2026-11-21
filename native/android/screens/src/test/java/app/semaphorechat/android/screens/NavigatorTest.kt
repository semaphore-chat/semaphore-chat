// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigatorTest {
    @Test
    fun backPopsToTheRootAndThenLeavesItToThePlatform() {
        val navigator = Navigator(Route.Community("c1"))
        navigator.push(Route.Channel("c1", "general"))
        assertTrue(navigator.canPop)
        assertEquals("c1", navigator.community)
        assertTrue(navigator.pop())
        assertEquals(Route.Community("c1"), navigator.top)
        assertFalse(navigator.canPop)
        assertFalse("the root goes to the platform", navigator.pop())
        assertEquals(listOf<Route>(Route.Community("c1")), navigator.stack.value)
    }

    @Test
    fun pushingTheTopAgainAddsNothing() {
        val navigator = Navigator(Route.Connect)
        navigator.push(Route.SignIn)
        navigator.push(Route.SignIn)
        assertEquals(listOf(Route.Connect, Route.SignIn), navigator.stack.value)
    }

    @Test
    fun switchingCommunityStartsItsStackAfresh() {
        val navigator = Navigator(Route.Community("c1"))
        navigator.push(Route.Channel("c1", "general"))
        navigator.openCommunity("c2")
        assertEquals(listOf<Route>(Route.Community("c2")), navigator.stack.value)
        navigator.reset(Route.Connect)
        assertNull(navigator.community)
    }

    @Test
    fun theTextsTheScreensDeriveFromTheModels() {
        assertEquals("Quiet", communityStateLine(CommunitySummary("a", "A")))
        assertEquals("New messages", communityStateLine(CommunitySummary("a", "A", unread = true)))
        assertEquals("1 mention", communityStateLine(CommunitySummary("a", "A", mentions = 1, unread = true)))
        assertEquals("3 mentions", communityStateLine(CommunitySummary("a", "A", mentions = 3)))
        assertEquals(
            "clips, unread, 2 mentions",
            channelRowLabel(TextChannelItem("c", "clips", unread = true, mentions = 2)),
        )
        assertEquals("Nobody here", peopleLine(emptyList()))
        assertEquals("2 people here", peopleLine(listOf(PersonItem("a", "A"), PersonItem("b", "B"))))
        val all = listOf(CommunitySummary("1", "Lumen Studio"), CommunitySummary("2", "Synth Club"))
        assertEquals(listOf("Synth Club"), filterCommunities(all, " synth ").map { it.name })
        assertEquals(all, filterCommunities(all, ""))
        assertEquals("chat.example.com", hostOf("https://chat.example.com/"))
        assertTrue(ServerSummary("http://x", null, false, false).insecure)
        assertFalse(ServerSummary("https://x", null, false, false).insecure)
    }
}
