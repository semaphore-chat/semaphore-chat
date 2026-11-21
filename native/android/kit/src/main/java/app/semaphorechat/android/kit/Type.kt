// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import app.semaphorechat.android.design.TokenTextStyle
import app.semaphorechat.android.design.Tokens

/** The weights the text styles use (`text.*.weight`). */
private val WEIGHTS = listOf(FontWeight.W400, FontWeight.W500, FontWeight.W600, FontWeight.W700)

/**
 * One family from a variable font (design/fonts): one [Font] per weight the text styles use,
 * each pinning the weight axis, so the instance drawn is the one the web's static file is.
 */
@OptIn(ExperimentalTextApi::class)
private fun variableFamily(upright: Int, italic: Int? = null): FontFamily = FontFamily(
    WEIGHTS.flatMap { weight ->
        val settings = FontVariation.Settings(FontVariation.weight(weight.weight))
        listOfNotNull(
            Font(upright, weight, FontStyle.Normal, variationSettings = settings),
            italic?.let { Font(it, weight, FontStyle.Italic, variationSettings = settings) },
        )
    },
)

/** `font.body`: Figtree, upright and italic. */
val FigtreeFamily: FontFamily = variableFamily(R.font.figtree_wght, R.font.figtree_italic_wght)

/** `font.heading`: Bricolage Grotesque, at its default optical size and width. */
val BricolageFamily: FontFamily = variableFamily(R.font.bricolage_grotesque_wght)

private fun family(name: String): FontFamily = when (name) {
    Tokens.Font.Heading -> BricolageFamily
    Tokens.Font.Body -> FigtreeFamily
    else -> error("no bundled font for $name")
}

/** The `text` token styles, by name: `TextVariant.BodyStrong` is `text.bodyStrong`. */
enum class TextVariant(val token: TokenTextStyle) {
    Title(Tokens.Text.Title),
    Section(Tokens.Text.Section),
    Name(Tokens.Text.Name),
    Body(Tokens.Text.Body),
    BodyStrong(Tokens.Text.BodyStrong),
    Meta(Tokens.Text.Meta),
    Small(Tokens.Text.Small),
    Tag(Tokens.Text.Tag),
}

/**
 * A token style as a Compose [TextStyle]: the family, size, line height and weight. The line
 * height is centred and not trimmed, as CSS lays a line out, so a row is the same height here.
 */
fun kitTextStyle(variant: TextVariant): TextStyle = TextStyle(
    fontFamily = family(variant.token.family),
    fontSize = variant.token.size,
    lineHeight = variant.token.lineHeight,
    fontWeight = variant.token.weight,
    lineHeightStyle = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Center,
        trim = LineHeightStyle.Trim.None,
    ),
)

/** Material's type scale over the kit's styles, for the stock components only. */
internal fun kitTypography(): Typography {
    val base = Typography()
    val body = kitTextStyle(TextVariant.Body)
    val strong = kitTextStyle(TextVariant.BodyStrong)
    val meta = kitTextStyle(TextVariant.Meta)
    val title = kitTextStyle(TextVariant.Title)
    val section = kitTextStyle(TextVariant.Section)
    return base.copy(
        headlineSmall = title,
        titleLarge = title,
        titleMedium = section,
        titleSmall = section,
        bodyLarge = body,
        bodyMedium = body,
        bodySmall = meta,
        labelLarge = strong,
        labelMedium = meta,
        labelSmall = kitTextStyle(TextVariant.Small),
    )
}
