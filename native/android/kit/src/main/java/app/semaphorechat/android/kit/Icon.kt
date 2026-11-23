// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import app.semaphorechat.android.design.Tokens

/** The icon sizes (`icon.*`). */
enum class IconSize(val side: Dp) {
    Xs(Tokens.Icon.Xs),
    Sm(Tokens.Icon.Sm),
    Md(Tokens.Icon.Md),
    Lg(Tokens.Icon.Lg),
    Xl(Tokens.Icon.Xl),
}

/**
 * One icon from the set (`design/icons`, generated into `Icons`), in the content colour unless
 * [colour] is given (the web kit's `Icon`). Decorative unless it has a [label].
 */
@Composable
fun Icon(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: IconSize = IconSize.Md,
    label: String? = null,
    colour: Color = LocalContentColor.current,
) {
    androidx.compose.material3.Icon(
        imageVector = icon,
        contentDescription = label,
        tint = colour,
        modifier = modifier.size(size.side),
    )
}
