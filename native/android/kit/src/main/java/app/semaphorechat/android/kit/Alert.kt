// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens

/** The web kit's `AlertSeverity`. */
enum class AlertSeverity { Info, Success, Warning, Danger }

/** An alert's action: a label and what it does. */
data class AlertAction(val label: String, val onClick: () -> Unit)

/**
 * A message in the flow of a screen (the web kit's `Alert`): an icon in the severity's colour,
 * an optional [title], the [message], up to two actions, and Dismiss when [onClose] is given.
 * [announce] makes it a polite live region (off for one that is there when the screen opens);
 * [oneLine] runs the title and text on one line, cut with an ellipsis.
 */
@Composable
fun Alert(
    severity: AlertSeverity,
    message: String,
    modifier: Modifier = Modifier,
    title: String? = null,
    action: AlertAction? = null,
    secondaryAction: AlertAction? = null,
    onClose: (() -> Unit)? = null,
    announce: Boolean = true,
    oneLine: Boolean = false,
) {
    val palette = Kit.palette
    val (icon, tint) = when (severity) {
        AlertSeverity.Info -> Icons.Info to palette.accentText
        AlertSeverity.Success -> Icons.CircleCheck to palette.positive
        AlertSeverity.Warning -> Icons.TriangleAlert to palette.warning
        AlertSeverity.Danger -> Icons.CircleAlert to palette.danger
    }
    val shape = RoundedCornerShape(Tokens.Radius.Card)
    val bodyLine = Tokens.Text.Body.lineHeight
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(if (announce) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier)
            .clip(shape)
            .background(palette.standOutFill(Kit.surface))
            .padding(
                if (oneLine) {
                    androidx.compose.foundation.layout.PaddingValues(horizontal = Tokens.Space.Md, vertical = Tokens.Space.Sm)
                } else {
                    androidx.compose.foundation.layout.PaddingValues(Tokens.Space.Lg)
                },
            ),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
        verticalAlignment = if (oneLine) Alignment.CenterVertically else Alignment.Top,
    ) {
        // Keeps the icon on the first line of text whatever the line height.
        Box(
            modifier = Modifier.height(with(androidx.compose.ui.platform.LocalDensity.current) { bodyLine.toDp() }),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(Tokens.Icon.Md))
        }
        CompositionLocalProvider(LocalKitSurface provides KitSurface.Fill) {
            if (oneLine) {
                Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                    if (title != null) Text(title, variant = TextVariant.BodyStrong, truncate = true)
                    Text(message, truncate = true, modifier = Modifier.weight(1f, fill = false))
                }
                action?.let { Button(it.label, it.onClick, variant = ButtonVariant.Text, size = ButtonSize.Sm) }
            } else {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                    if (title != null) Text(title, variant = TextVariant.BodyStrong)
                    Text(message)
                    if (action != null || secondaryAction != null) {
                        Row(
                            // The first text button lines its label up with the text above.
                            modifier = Modifier.padding(top = Tokens.Space.Sm).offset(x = -Tokens.Space.Md),
                            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
                        ) {
                            action?.let { Button(it.label, it.onClick, variant = ButtonVariant.Text, size = ButtonSize.Sm) }
                            secondaryAction?.let {
                                Button(it.label, it.onClick, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                            }
                        }
                    }
                }
            }
            if (onClose != null) {
                IconButton(
                    icon = Icons.X,
                    label = "Dismiss",
                    onClick = onClose,
                    size = ButtonSize.Sm,
                    modifier = Modifier.offset(y = if (oneLine) Tokens.Space.None else -Tokens.Space.Sm),
                )
            }
        }
    }
}
