// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import androidx.compose.ui.graphics.toArgb
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import uniffi.semaphore.Appearance
import uniffi.semaphore.AccentColor
import uniffi.semaphore.Rgb
import uniffi.semaphore.ThemeIntensity
import uniffi.semaphore.ThemeMode
import uniffi.semaphore.derivePalette

/**
 * The palette through the FFI, as the app calls it, against every case of the shared vectors
 * (`design/vectors/colour.json`): the Kotlin types, the packing and the Rust derivation agree
 * with the web and desktop. Over the host build of libsemaphore_mobile.so, as MobileCoreJvmTest.
 */
class PaletteJvmTest {
    private val vectors = File("../../../design/vectors/colour.json")

    private val roles = listOf(
        "ground", "surface", "fill", "hairline", "text", "textSecondary", "textDim", "accent",
        "onAccent", "accentText", "focus", "positive", "warning", "danger", "onDanger", "scrim",
    )

    /** The cases, parsed with a pattern: the file is generated and flat, and the JVM test has no JSON library. */
    private fun cases(): List<Pair<Triple<String, String, String>, Map<String, String>>> {
        val case = Regex(
            "\\{\\s*\"base\": \"(#[0-9A-Fa-f]{6})\",\\s*\"mode\": \"(\\w+)\",\\s*\"intensity\": \"(\\w+)\",\\s*\"roles\": \\{([^}]*)\\}",
        )
        val role = Regex("\"(\\w+)\": \"(#[0-9A-Fa-f]{6,8})\"")
        return case.findAll(vectors.readText()).map { match ->
            val (base, mode, intensity, body) = match.destructured
            Triple(base, mode, intensity) to role.findAll(body).associate { it.groupValues[1] to it.groupValues[2] }
        }.toList()
    }

    private fun packed(hex: String): Long {
        val digits = hex.removePrefix("#")
        val value = digits.toLong(16)
        return if (digits.length == 6) (value shl 8) or 0xFF else value
    }

    @Test
    fun derivePaletteThroughTheFfiMatchesEverySharedVector() {
        assumeTrue("needs semaphore.hostLibDir (native/scripts/android.sh)", System.getProperty("semaphore.hostLibDir") != null)
        val cases = cases()
        assertEquals(96, cases.size)
        for ((key, want) in cases) {
            val (base, mode, intensity) = key
            val rgb = base.removePrefix("#").toLong(16)
            val got = derivePalette(
                Rgb(((rgb shr 16) and 0xFF).toUByte(), ((rgb shr 8) and 0xFF).toUByte(), (rgb and 0xFF).toUByte()),
                if (mode == "dark") ThemeMode.DARK else ThemeMode.LIGHT,
                when (intensity) {
                    "minimal" -> ThemeIntensity.MINIMAL
                    "balanced" -> ThemeIntensity.BALANCED
                    else -> ThemeIntensity.VIBRANT
                },
            )
            val kit = got.toKitPalette(dark = mode == "dark")
            val gotRoles = listOf(
                got.ground, got.surface, got.fill, got.hairline, got.text, got.textSecondary,
                got.textDim, got.accent, got.onAccent, got.accentText, got.focus, got.positive,
                got.warning, got.danger, got.onDanger, got.scrim,
            ).map { it.toLong() }
            assertEquals("$key", roles.map { packed(want.getValue(it)) }, gotRoles)
            val kitRoles = listOf(
                kit.ground, kit.surface, kit.fill, kit.hairline, kit.text, kit.textSecondary,
                kit.textDim, kit.accent, kit.onAccent, kit.accentText, kit.focus, kit.positive,
                kit.warning, kit.danger, kit.onDanger, kit.scrim,
            ).map { it.toArgb() }
            val wantKit = roles.map { packed(want.getValue(it)) }.map {
                // 0xRRGGBBAA to ARGB.
                (((it and 0xFF) shl 24) or (it ushr 8)).toInt()
            }
            assertEquals("$key", wantKit, kitRoles)
            assertEquals("$key", mode == "dark", kit.dark)
        }
    }

    @Test
    fun aMatchSystemAppearanceFollowsTheSystem() {
        val appearance = Appearance(
            mode = ThemeMode.DARK,
            accent = AccentColor.TEAL,
            intensity = ThemeIntensity.MINIMAL,
            base = Rgb(0x8Eu, 0x75u, 0xFFu),
            matchSystem = true,
            newDesign = false,
            baseColourSettings = true,
        )
        assertEquals(ThemeMode.LIGHT, appearance.resolvedMode(systemDark = false))
        assertEquals(ThemeMode.DARK, appearance.resolvedMode(systemDark = true))
        assertEquals(ThemeMode.DARK, appearance.copy(matchSystem = false).resolvedMode(systemDark = false))
    }
}
