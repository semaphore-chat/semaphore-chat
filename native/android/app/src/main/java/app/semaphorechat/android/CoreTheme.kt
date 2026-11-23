// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import app.semaphorechat.android.kit.KitPalette
import app.semaphorechat.android.kit.SemaphoreTheme
import uniffi.semaphore.Appearance
import uniffi.semaphore.DerivedPalette
import uniffi.semaphore.ThemeMode
import uniffi.semaphore.derivePalette

/** The kit's palette from the core's derived roles (each `0xRRGGBBAA`). */
fun DerivedPalette.toKitPalette(dark: Boolean): KitPalette = KitPalette.fromPacked(
    listOf(
        ground, surface, fill, hairline, text, textSecondary, textDim, accent, onAccent,
        accentText, focus, positive, warning, danger, onDanger, scrim,
    ).map { it.toLong() },
    dark = dark,
)

/** The mode to draw in: the system's when the appearance follows it, otherwise its own. */
fun Appearance.resolvedMode(systemDark: Boolean): ThemeMode = when {
    matchSystem -> if (systemDark) ThemeMode.DARK else ThemeMode.LIGHT
    else -> mode
}

/**
 * [SemaphoreTheme] for the core's [appearance]: the palette is derived in Rust (the same code
 * as desktop and the shared vectors), and the system bars follow the mode.
 */
@Composable
fun CoreTheme(appearance: Appearance, content: @Composable () -> Unit) {
    val mode = appearance.resolvedMode(isSystemInDarkTheme())
    val palette = remember(appearance.base, mode, appearance.intensity) {
        derivePalette(appearance.base, mode, appearance.intensity).toKitPalette(mode == ThemeMode.DARK)
    }
    val activity = LocalContext.current as? ComponentActivity
    LaunchedEffect(activity, palette) {
        val bar = palette.ground.toArgb()
        val style = if (palette.dark) SystemBarStyle.dark(bar) else SystemBarStyle.light(bar, bar)
        activity?.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }
    SemaphoreTheme(palette = palette, content = content)
}
