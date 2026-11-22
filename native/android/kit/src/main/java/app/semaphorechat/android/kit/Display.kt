// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import app.semaphorechat.android.design.Tokens

/** The web kit's `Badge` tones. */
enum class BadgeTone { Accent, Danger }

/** "99+" above [max]: the web's Badge text. */
internal fun badgeText(count: Int, max: Int): String = if (count > max) "$max+" else count.toString()

/**
 * A count, or a small dot with no number (the web kit's `Badge`). [label] is what it means
 * ("3 mentions"), its accessible name. On the accent surface an accent badge inverts.
 */
@Composable
fun Badge(
    label: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    max: Int = 99,
    dot: Boolean = false,
    tone: BadgeTone = BadgeTone.Accent,
) {
    val palette = Kit.palette
    val inverted = Kit.surface == KitSurface.Accent && tone == BadgeTone.Accent
    val background = when {
        inverted -> palette.onAccent
        tone == BadgeTone.Accent -> palette.accent
        else -> palette.danger
    }
    val ink = when {
        inverted -> palette.accent
        tone == BadgeTone.Accent -> palette.onAccent
        else -> palette.onDanger
    }
    val semantics = Modifier.clearAndSetSemantics { contentDescription = label }
    if (dot || count == null) {
        Box(modifier.then(semantics).size(Tokens.Space.Sm).clip(CircleShape).background(background))
        return
    }
    Box(
        modifier = modifier
            .then(semantics)
            .sizeIn(minWidth = Tokens.Icon.Lg, minHeight = Tokens.Icon.Lg)
            .height(Tokens.Icon.Lg)
            .clip(CircleShape)
            .background(background)
            .padding(horizontal = Tokens.Space.Xs),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(badgeText(count, max), style = kitTextStyle(TextVariant.Tag).copy(color = ink), maxLines = 1)
    }
}

/** The web kit's `Pill` tones. */
enum class PillTone { Neutral, Accent, Danger, Positive, Warning }

/** A short status label in a rounded chip (the web kit's `Pill`), with an optional leading dot. */
@Composable
fun Pill(
    label: String,
    modifier: Modifier = Modifier,
    tone: PillTone = PillTone.Neutral,
    dot: Boolean = false,
    small: Boolean = false,
) {
    val palette = Kit.palette
    val on = Kit.surface
    val fill = palette.standOutFill(on)
    val chip = if (on == KitSurface.Accent) palette.fill else fill
    val (background, colour) = when {
        on == KitSurface.Accent && tone == PillTone.Accent -> palette.onAccent to palette.accent
        on == KitSurface.Accent && tone == PillTone.Neutral -> fill to palette.onAccent
        else -> when (tone) {
            PillTone.Neutral -> fill to palette.textSecondary
            PillTone.Accent -> palette.accent to palette.onAccent
            PillTone.Danger -> chip to palette.danger
            PillTone.Positive -> chip to palette.positive
            PillTone.Warning -> chip to palette.warning
        }
    }
    Row(
        modifier = modifier
            .height(if (small) Tokens.Icon.Lg else Tokens.Icon.Xl)
            .clip(CircleShape)
            .background(background)
            .padding(horizontal = Tokens.Space.Sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
    ) {
        if (dot) Box(Modifier.size(Tokens.Space.Sm).clip(CircleShape).background(colour))
        BasicText(
            label,
            style = kitTextStyle(TextVariant.Tag).copy(color = colour),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The web kit's `Skeleton` shapes. */
sealed interface SkeletonShape {
    /** [lines] of text, the last one shorter. */
    data class TextLines(val lines: Int = 1) : SkeletonShape
    data class Circle(val size: AvatarSize = AvatarSize.Md) : SkeletonShape
    /** A control-height block, as wide as it is let. */
    data class Rect(val height: Dp) : SkeletonShape
}

/**
 * A placeholder for content that is loading (the web kit's `Skeleton`): the stand-out fill,
 * pulsing to half opacity, still in screenshots. Hidden from accessibility: pair it with a named
 * status nearby.
 */
@Composable
fun Skeleton(shape: SkeletonShape, modifier: Modifier = Modifier) {
    val palette = Kit.palette
    val fill = palette.standOutFill(Kit.surface)
    val alpha = if (LocalKitStill.current) {
        1f
    } else {
        val pulse by rememberInfiniteTransition(label = "skeleton").animateFloat(
            initialValue = 1f,
            targetValue = Tokens.State.Disabled,
            animationSpec = infiniteRepeatable(tween((Tokens.Motion.SlowMs * 2).toInt()), RepeatMode.Reverse),
            label = "pulse",
        )
        pulse
    }
    val hidden = modifier.clearAndSetSemantics { }.alpha(alpha)
    when (shape) {
        is SkeletonShape.Circle -> Box(hidden.size(shape.size.side).clip(CircleShape).background(fill))
        is SkeletonShape.Rect -> Box(
            hidden.fillMaxWidth().height(shape.height).clip(RoundedCornerShape(Tokens.Radius.Md)).background(fill),
        )
        is SkeletonShape.TextLines -> androidx.compose.foundation.layout.Column(hidden.fillMaxWidth()) {
            val (line, bar) = with(LocalDensity.current) {
                Tokens.Text.Body.lineHeight.toDp() to Tokens.Text.Body.size.toDp()
            }
            repeat(shape.lines) { index ->
                val last = index == shape.lines - 1 && shape.lines > 1
                Box(
                    Modifier.height(line).fillMaxWidth(),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(if (last) 0.6f else 1f)
                            .height(bar)
                            .clip(RoundedCornerShape(Tokens.Radius.Sm))
                            .background(fill),
                    )
                }
            }
        }
    }
}

/** One face in an [AvatarStack]. */
data class StackPerson(val id: String, val name: String, val speaking: Boolean = false)

/** Up to three talking by name; more are "A, B and 4 more" (the web's `talkingLine`). */
fun talkingLine(names: List<String>): String = when {
    names.size <= 3 -> when (names.size) {
        0 -> ""
        1 -> names[0]
        else -> names.dropLast(1).joinToString(", ") + " and " + names.last()
    }
    else -> names.take(2).joinToString(", ") + " and ${names.size - 2} more"
}

/**
 * Overlapping avatars with a "+N" after [max] (the web kit's `AvatarStack`). Each sits in a ring
 * of the surface behind; a speaker wears the speaking ring and doesn't overlap its neighbours.
 * One accessible name for the group, [label] or the names shown and "and N more".
 */
@Composable
fun AvatarStack(
    people: List<StackPerson>,
    modifier: Modifier = Modifier,
    max: Int = 3,
    size: AvatarSize = AvatarSize.Sm,
    label: String? = null,
) {
    if (people.isEmpty()) return
    val palette = Kit.palette
    val behind = palette.tintBase(Kit.surface)
    val shown = people.take(maxOf(0, max))
    val extra = people.size - shown.size
    val names = shown.joinToString(", ") { it.name }
    val name = label ?: when {
        extra == 0 -> names
        shown.isEmpty() -> "$extra people"
        else -> "$names and $extra more"
    }
    // Each slot overlaps the one before by space.sm; a speaker and the one after it sit a ring's
    // width apart instead, the speaker drawn above.
    val gaps = (shown.indices).map { index ->
        when {
            index == 0 -> Tokens.Space.None
            shown[index].speaking || shown[index - 1].speaking -> Tokens.Border.Selected * 2
            else -> -Tokens.Space.Sm
        }
    } + listOfNotNull(
        if (extra > 0) (if (shown.lastOrNull()?.speaking == true) Tokens.Border.Selected * 2 else -Tokens.Space.Sm) else null,
    )
    val raised = shown.map { it.speaking } + listOfNotNull(if (extra > 0) false else null)
    Layout(
        modifier = modifier.clearAndSetSemantics { contentDescription = name },
        content = {
            shown.forEach { person ->
                Box(if (person.speaking) Modifier else Modifier.ring(behind)) {
                    Avatar(
                        person.name,
                        colour = personColour(person.id),
                        size = size,
                        presence = if (person.speaking) Presence.Speaking else null,
                        decorative = true,
                    )
                }
            }
            if (extra > 0) {
                Box(
                    Modifier
                        .ring(behind)
                        .size(size.side)
                        .clip(CircleShape)
                        .background(palette.standOutFill(Kit.surface)),
                    contentAlignment = Alignment.Center,
                ) {
                    val style = if (size == AvatarSize.Xs || size == AvatarSize.Sm) TextVariant.Tag else TextVariant.Meta
                    BasicText("+$extra", style = kitTextStyle(style).copy(color = palette.textSecondary))
                }
            }
        },
    ) { measurables, constraints ->
        val placeables = measurables.map { it.measure(constraints.copy(minWidth = 0, minHeight = 0)) }
        val xs = IntArray(placeables.size)
        for (i in 1 until placeables.size) {
            xs[i] = xs[i - 1] + placeables[i - 1].width + gaps[i].roundToPx()
        }
        val width = placeables.lastIndex.let { if (it < 0) 0 else xs[it] + placeables[it].width }
        val height = placeables.maxOfOrNull { it.height } ?: 0
        layout(width, height) {
            placeables.forEachIndexed { i, placeable ->
                placeable.placeRelative(xs[i], (height - placeable.height) / 2, zIndex = if (raised[i]) 1f else 0f)
            }
        }
    }
}

/** A `border.selected` ring in [colour] just outside a circle, drawn outside the bounds. */
private fun Modifier.ring(colour: Color): Modifier = drawBehind {
    val ring = Tokens.Border.Selected.toPx()
    drawCircle(colour, radius = size.minDimension / 2 + ring)
}
