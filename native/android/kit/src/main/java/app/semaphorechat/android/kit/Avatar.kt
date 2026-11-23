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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
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
 * [colour] is the person's or community's own colour, nudged in lightness until the ground or the
 * text colour reads on it at 4.5:1 ([readableBackground]); the initials take that ink.
 * [Presence.Speaking] wears the speaking ring instead of a dot. [decorative] hides it from accessibility when the
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
    // null: a circle.
    val corner = when {
        shape == AvatarShape.Circle -> null
        size == AvatarSize.Xl -> Tokens.Radius.Card
        else -> Tokens.Radius.Md
    }
    val clip = corner?.let { RoundedCornerShape(it) } ?: CircleShape
    // The web's readableBackground: the colour nudged until the ground or the text reads on it
    // at 4.5:1. A colour no lightness can fix falls back to the plain fill.
    val own = colour?.let { readableBackground(it, palette.ground to palette.text) }
    val background = own?.background ?: palette.standOutFill(Kit.surface)
    val ink = own?.ink ?: palette.textSecondary
    val speaking = presence == Presence.Speaking
    val semantics = if (decorative) {
        Modifier.clearAndSetSemantics { }
    } else {
        Modifier.clearAndSetSemantics {
            contentDescription = name
            if (presence != null) stateDescription = presence.name.lowercase()
        }
    }
    Box(modifier = modifier.size(size.side).then(semantics)) {
        Box(
            modifier = Modifier
                .size(size.side)
                .then(if (speaking) Modifier.speakingRing(corner, behind, palette.positive) else Modifier)
                .clip(clip)
                .background(background),
            contentAlignment = Alignment.Center,
        ) {
            BasicText(text = initialsOf(name), style = initialsStyle(size).copy(color = ink))
        }
        // Speaking wears the ring instead of a dot, as on the web.
        if (presence != null && !speaking) {
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

/**
 * The speaking ring (the web kit's `speakingRing`): a gap in [behind], the colour of the layer
 * under the avatar, then a ring in [ring], each `border.selected` wide. Drawn outside the
 * avatar's bounds, as the web's box-shadow, so the avatar never grows; like a shadow's spread,
 * each band's corners grow by its outset. [corner] null is a circle.
 */
internal fun Modifier.speakingRing(corner: Dp?, behind: Color, ring: Color): Modifier = drawBehind {
    val gap = Tokens.Border.Selected.toPx()
    fun band(outset: Float, colour: Color) {
        val shape = corner?.let { RoundedCornerShape(it.toPx() + outset) } ?: CircleShape
        val outline = shape.createOutline(
            Size(size.width + outset * 2, size.height + outset * 2),
            layoutDirection,
            this,
        )
        translate(-outset, -outset) { drawOutline(outline, colour) }
    }
    band(gap * 2, ring)
    band(gap, behind)
}
