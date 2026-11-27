// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class ComposerModelsTest {
    private fun of(vararg kinds: SuggestionKind) = kinds.mapIndexed { i, kind -> MentionSuggestion(kind, "id$i", "label$i", "@x$i") }

    @Test
    fun theHeadingNamesWhatAllTheSuggestionsAre() {
        assertEquals("Suggestions", suggestionHeading(emptyList()))
        assertEquals("Members", suggestionHeading(of(SuggestionKind.User, SuggestionKind.User)))
        assertEquals("Channels", suggestionHeading(of(SuggestionKind.Channel)))
        assertEquals("Special Mentions", suggestionHeading(of(SuggestionKind.Special)))
        assertEquals("Mention Groups", suggestionHeading(of(SuggestionKind.Alias)))
        assertEquals("Suggestions", suggestionHeading(of(SuggestionKind.Special, SuggestionKind.User)))
    }
}
