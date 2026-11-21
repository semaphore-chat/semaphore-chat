// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import app.semaphorechat.android.design.Tokens

/**
 * Motion off: spinners draw one still frame. The stories set it so a render is the same every
 * time; the app can set it for the system's "remove animations" setting.
 */
val LocalKitStill = staticCompositionLocalOf { false }

/** The web kit's spinner sizes: the icon sizes. */
enum class SpinnerSize(val diameter: Dp) {
    Xs(Tokens.Icon.Xs),
    Sm(Tokens.Icon.Sm),
    Md(Tokens.Icon.Md),
    Lg(Tokens.Icon.Lg),
    Xl(Tokens.Icon.Xl),
}

/**
 * An indeterminate spinner in the content colour (the web kit's `Spinner`). With a [label] it
 * is announced as busy progress; without one it is decoration beside text that says so.
 */
@Composable
fun Spinner(
    modifier: Modifier = Modifier,
    size: SpinnerSize = SpinnerSize.Sm,
    label: String? = null,
    colour: Color = LocalContentColor.current,
) {
    val still = LocalKitStill.current
    val angle = if (still) {
        0f
    } else {
        val turn by rememberInfiniteTransition(label = "spinner").animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(1_000, easing = LinearEasing), RepeatMode.Restart),
            label = "spinner angle",
        )
        turn
    }
    val semantics = if (label != null) {
        Modifier.semantics {
            contentDescription = label
            progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
        }
    } else {
        Modifier
    }
    Canvas(modifier = modifier.size(size.diameter).then(semantics)) {
        // MUI's thickness 5 in a 44-unit box, as the web draws it.
        val stroke = this.size.minDimension * 5f / 44f
        rotate(angle) {
            drawArc(
                color = colour,
                startAngle = -90f,
                sweepAngle = 270f,
                useCenter = false,
                topLeft = androidx.compose.ui.geometry.Offset(stroke / 2, stroke / 2),
                size = androidx.compose.ui.geometry.Size(
                    this.size.width - stroke,
                    this.size.height - stroke,
                ),
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
    }
}
