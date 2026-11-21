// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import app.semaphorechat.android.design.Tokens

/** The web kit's text field types, as Android keyboards. */
enum class TextFieldType(val keyboard: KeyboardType) {
    Text(KeyboardType.Text),
    Password(KeyboardType.Password),
    Email(KeyboardType.Email),
    Search(KeyboardType.Text),
    Url(KeyboardType.Uri),
    Number(KeyboardType.Number),
}

/** `field` for forms, `round` for search and the composer. */
enum class TextFieldShape { Field, Round }

/**
 * A labelled one-line text field (the web kit's `TextField`): the [label] above (or only for
 * accessibility with [labelHidden]), the box in the stand-out fill, then the [error] in the
 * danger colour or the [helper]. A required field marks its label.
 */
@Composable
fun TextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    helper: String? = null,
    error: String? = null,
    required: Boolean = false,
    enabled: Boolean = true,
    labelHidden: Boolean = false,
    shape: TextFieldShape = TextFieldShape.Field,
    type: TextFieldType = TextFieldType.Text,
    startIcon: ImageVector? = null,
) {
    val palette = Kit.palette
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val boxShape = if (shape == TextFieldShape.Round) CircleShape else RoundedCornerShape(Tokens.Radius.Field)
    val edge = when {
        error != null -> palette.danger
        focused -> palette.focus
        else -> Color.Transparent
    }
    val text = kitTextStyle(TextVariant.Body)
    Column(
        modifier = modifier.fillMaxWidth().alpha(if (enabled) 1f else Tokens.State.Disabled),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
    ) {
        if (!labelHidden) {
            BasicText(
                text = if (required) "$label *" else label,
                style = kitTextStyle(TextVariant.Meta).copy(
                    color = palette.textSecondary,
                    fontWeight = Tokens.Text.BodyStrong.weight,
                ),
            )
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            singleLine = true,
            textStyle = text.copy(color = palette.text),
            cursorBrush = SolidColor(palette.accent),
            keyboardOptions = KeyboardOptions(keyboardType = type.keyboard),
            visualTransformation = if (type == TextFieldType.Password) {
                PasswordVisualTransformation()
            } else {
                VisualTransformation.None
            },
            interactionSource = interaction,
            modifier = Modifier
                .fillMaxWidth()
                .semantics {
                    contentDescription = label
                    if (error != null) error(error)
                },
            decorationBox = { inner ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Kit.density.controlLg)
                        .clip(boxShape)
                        .background(palette.standOutFill(Kit.surface))
                        .border(Tokens.Border.Selected, edge, boxShape)
                        .padding(horizontal = Tokens.Space.Lg),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (startIcon != null) {
                        Icon(startIcon, contentDescription = null, tint = palette.textDim, modifier = Modifier.size(Tokens.Icon.Md))
                    }
                    Box(modifier = Modifier.weight(1f).padding(vertical = Tokens.Space.Sm)) {
                        if (value.isEmpty() && placeholder != null) {
                            BasicText(text = placeholder, style = text.copy(color = palette.textDim), maxLines = 1)
                        }
                        inner()
                    }
                }
            },
        )
        val note = error ?: helper
        if (note != null) {
            BasicText(
                text = note,
                style = kitTextStyle(TextVariant.Meta).copy(
                    color = if (error != null) palette.danger else palette.textDim,
                ),
            )
        }
    }
}
