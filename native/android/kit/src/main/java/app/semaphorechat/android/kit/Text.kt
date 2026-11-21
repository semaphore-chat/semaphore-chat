// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.text.BasicText
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow

/** The web kit's `TextTone`: which role colours the text. */
enum class TextTone { Default, Secondary, Dim, Accent, Danger }

/** A tone's colour; [TextTone.Default] keeps the content colour the parent set. */
@Composable
internal fun toneColour(tone: TextTone): Color {
    val p = Kit.palette
    return when (tone) {
        TextTone.Default -> LocalContentColor.current
        TextTone.Secondary -> p.textSecondary
        TextTone.Dim -> p.textDim
        TextTone.Accent -> p.accentText
        TextTone.Danger -> p.danger
    }
}

/**
 * Text in one of the token styles (the web kit's `Text`). [heading] marks it as a heading for
 * accessibility, as the web's `as="h1"`..`"h6"` does. [truncate] keeps it to one line, cut with
 * an ellipsis.
 */
@Composable
fun Text(
    text: String,
    modifier: Modifier = Modifier,
    variant: TextVariant = TextVariant.Body,
    tone: TextTone = TextTone.Default,
    truncate: Boolean = false,
    heading: Boolean = false,
) {
    val colour = toneColour(tone)
    BasicText(
        text = text,
        modifier = if (heading) modifier.semantics { heading() } else modifier,
        style = kitTextStyle(variant).copy(color = colour),
        maxLines = if (truncate) 1 else Int.MAX_VALUE,
        overflow = if (truncate) TextOverflow.Ellipsis else TextOverflow.Clip,
        softWrap = !truncate,
    )
}
