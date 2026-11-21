// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import app.semaphorechat.android.design.Tokens
import java.text.BreakIterator

/** The web kit's avatar sizes (`avatar.*`). */
enum class AvatarSize(val side: Dp) {
    Xs(Tokens.Avatar.Xs),
    Sm(Tokens.Avatar.Sm),
    Md(Tokens.Avatar.Md),
    Lg(Tokens.Avatar.Lg),
    Xl(Tokens.Avatar.Xl),
}

/** `circle` for people, `rounded` for communities. */
enum class AvatarShape { Circle, Rounded }

/** The presence dot. */
enum class Presence { Online, Away, Offline, Speaking }

/**
 * A person's avatar colour from their id: `colour.people.colours[fnv1a32(utf8(id)) % 9]`, as
 * the web's `personColour` (`design/vectors/person-colour.json`). `null` for an empty id.
 */
fun personColour(id: String): Color? {
    if (id.isEmpty()) return null
    var hash = 0x811c9dc5L
    for (byte in id.encodeToByteArray()) {
        hash = hash xor (byte.toLong() and 0xFF)
        hash = (hash * 0x01000193L) and 0xFFFFFFFFL
    }
    val colours = Tokens.People.Colours
    return colours[(hash % colours.size).toInt()]
}

/** Up to two initials: the first letter of the first two words, or the first two of one word. */
internal fun initialsOf(name: String): String {
    fun letters(word: String): List<String> {
        val out = mutableListOf<String>()
        val graphemes = BreakIterator.getCharacterInstance()
        graphemes.setText(word)
        var start = graphemes.first()
        var end = graphemes.next()
        while (end != BreakIterator.DONE) {
            val grapheme = word.substring(start, end)
            if (grapheme.codePointAt(0).let { Character.isLetterOrDigit(it) }) out += grapheme
            start = end
            end = graphemes.next()
        }
        return out
    }
    val words = name.split(Regex("\\s+")).map(::letters).filter { it.isNotEmpty() }
    val picked = if (words.size >= 2) listOf(words[0][0], words[1][0]) else words.firstOrNull().orEmpty().take(2)
    return picked.joinToString("") { it.uppercase() }
}

private fun initialsStyle(size: AvatarSize): TextStyle = when (size) {
    AvatarSize.Xs -> kitTextStyle(TextVariant.Tag)
    AvatarSize.Xl -> kitTextStyle(TextVariant.Section)
    else -> kitTextStyle(TextVariant.Meta).copy(fontWeight = Tokens.Text.BodyStrong.weight)
}

/**
 * Initials in a circle or a rounded square (the web kit's `Avatar`; pictures come with D6).
 * [colour] is the person's or community's own colour; the initials then take whichever of the
 * ground and text colours reads better on it. [decorative] hides it from accessibility when the
 * name is already beside it.
 */
@Composable
fun Avatar(
    name: String,
    modifier: Modifier = Modifier,
    colour: Color? = null,
    size: AvatarSize = AvatarSize.Md,
    shape: AvatarShape = AvatarShape.Circle,
    presence: Presence? = null,
    decorative: Boolean = false,
) {
    val palette = Kit.palette
    val behind = palette.tintBase(Kit.surface)
    val clip = when {
        shape == AvatarShape.Circle -> CircleShape
        size == AvatarSize.Xl -> RoundedCornerShape(Tokens.Radius.Card)
        else -> RoundedCornerShape(Tokens.Radius.Md)
    }
    val background = colour ?: palette.standOutFill(Kit.surface)
    val ink = when {
        colour == null -> palette.textSecondary
        contrast(palette.ground, colour) >= contrast(palette.text, colour) -> palette.ground
        else -> palette.text
    }
    val semantics = if (decorative) {
        Modifier.clearAndSetSemantics { }
    } else {
        Modifier.clearAndSetSemantics { contentDescription = name }
    }
    Box(modifier = modifier.size(size.side).then(semantics)) {
        Box(
            modifier = Modifier.size(size.side).clip(clip).background(background),
            contentAlignment = Alignment.Center,
        ) {
            BasicText(text = initialsOf(name), style = initialsStyle(size).copy(color = ink))
        }
        if (presence != null) {
            val diameter = if (size == AvatarSize.Xs) Tokens.Space.Sm else Tokens.Space.Md
            val offline = presence == Presence.Offline
            val dot = when (presence) {
                Presence.Online, Presence.Speaking -> palette.positive
                Presence.Away -> palette.warning
                Presence.Offline -> behind
            }
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = Tokens.Border.Hairline, y = Tokens.Border.Hairline)
                    .size(diameter + Tokens.Border.Selected * 2)
                    .clip(CircleShape)
                    .background(behind),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(diameter)
                        .clip(CircleShape)
                        .background(dot)
                        .then(
                            if (offline) {
                                Modifier.border(Tokens.Border.Selected, palette.textDim, CircleShape)
                            } else {
                                Modifier
                            },
                        ),
                )
            }
        }
    }
}
