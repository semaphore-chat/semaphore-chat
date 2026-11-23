// Semaphore Chat's Android Compose kit. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.kit

import androidx.compose.ui.graphics.Color
import kotlin.math.atan2
import kotlin.math.cbrt
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * A colour made readable for one of two inks, and that ink: the web kit's `readableBackground`
 * (`frontend/src/kit/theme/readable.ts`), over the OKLCH maths of `shared/src/theme/oklch.ts`
 * (itself a port of `design/gen/colour_ref.py`).
 */
data class Readable(val background: Color, val ink: Color)

private const val TARGET = 4.5
private const val STEPS = 501
private const val STEP = 0.002
private const val CACHE_LIMIT = 256

/** 8-bit sRGB channels, as the web's maths takes them. */
private typealias Rgb = IntArray

private fun rgbOf(colour: Color): Rgb = intArrayOf(
    floor(colour.red * 255f + 0.5f).toInt(),
    floor(colour.green * 255f + 0.5f).toInt(),
    floor(colour.blue * 255f + 0.5f).toInt(),
)

private fun colourOf(rgb: Rgb): Color = Color(rgb[0], rgb[1], rgb[2])

private fun lin(channel: Int): Double {
    val c = channel / 255.0
    return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
}

private fun unlin(v: Double): Double = if (v <= 0.0031308) 12.92 * v else 1.055 * v.pow(1 / 2.4) - 0.055

/** 8-bit sRGB to OKLCH: `[L, C, h]`, the hue in radians. */
internal fun toOklch(rgb: Rgb): DoubleArray {
    val r = lin(rgb[0])
    val g = lin(rgb[1])
    val b = lin(rgb[2])
    val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    val bigL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    val a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    val bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return doubleArrayOf(bigL, hypot(a, bb), atan2(bb, a))
}

private fun toLinear(bigL: Double, c: Double, h: Double): DoubleArray {
    val a = c * cos(h)
    val b = c * sin(h)
    val l = (bigL + 0.3963377774 * a + 0.2158037573 * b).pow(3)
    val m = (bigL - 0.1055613458 * a - 0.0638541728 * b).pow(3)
    val s = (bigL - 0.0894841775 * a - 1.291485548 * b).pow(3)
    return doubleArrayOf(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    )
}

/** OKLCH to 8-bit sRGB; chroma is cut in 1% steps until it is in gamut. */
internal fun toRgb(bigL: Double, c: Double, h: Double): Rgb {
    val lightness = min(1.0, max(0.0, bigL))
    var linear = doubleArrayOf(0.0, 0.0, 0.0)
    for (k in 0 until 101) {
        linear = toLinear(lightness, c * (100 - k) / 100, h)
        if (linear.all { it >= -0.0005 && it <= 1.0005 }) break
    }
    return IntArray(3) { floor(unlin(min(1.0, max(0.0, linear[it]))) * 255 + 0.5).toInt() }
}

private fun luminance(rgb: Rgb): Double = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])

/** WCAG contrast ratio of two 8-bit sRGB colours. */
internal fun contrastRatio(a: Rgb, b: Rgb): Double {
    val la = luminance(a)
    val lb = luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
}

private val cache = object : LinkedHashMap<Triple<Color, Color, Color>, Readable?>() {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Triple<Color, Color, Color>, Readable?>?) =
        size > CACHE_LIMIT
}

/**
 * [colour] with its OKLCH lightness nudged only as far as needed for one of [inks] to read on it
 * at 4.5:1, plus that ink. A colour that already passes comes back unchanged. The nudge goes
 * lighter when the darker ink reads better on the original, else darker, keeps chroma and hue
 * (chroma drops only where the lightness leaves the gamut), and stops at black or white. `null`
 * when no lightness makes it readable with these inks; never a failing colour. Cached per colour
 * and inks.
 */
fun readableBackground(colour: Color, inks: Pair<Color, Color>): Readable? {
    val key = Triple(colour, inks.first, inks.second)
    synchronized(cache) {
        if (cache.containsKey(key)) return cache[key]
    }
    val result = search(colour, inks)
    synchronized(cache) { cache[key] = result }
    return result
}

private fun search(colour: Color, inks: Pair<Color, Color>): Readable? {
    val original = rgbOf(colour)
    val first = rgbOf(inks.first)
    val second = rgbOf(inks.second)
    val black = intArrayOf(0, 0, 0)
    val firstIsDarker = contrastRatio(first, black) <= contrastRatio(second, black)
    val darker = if (firstIsDarker) first else second
    val lighter = if (firstIsDarker) second else first
    val darkerInk = if (firstIsDarker) inks.first else inks.second
    val lighterInk = if (firstIsDarker) inks.second else inks.first
    fun darkerBest(rgb: Rgb) = contrastRatio(darker, rgb) >= contrastRatio(lighter, rgb)

    val (bigL, c, h) = toOklch(original).let { Triple(it[0], it[1], it[2]) }
    val direction = if (darkerBest(original)) 1 else -1
    for (i in 0 until STEPS) {
        val lightness = min(1.0, max(0.0, bigL + direction * STEP * i))
        val rgb = if (i == 0) original else toRgb(lightness, c, h)
        val pickDarker = darkerBest(rgb)
        val ink = if (pickDarker) darker else lighter
        if (contrastRatio(ink, rgb) >= TARGET) {
            return Readable(
                background = if (i == 0) colour else colourOf(rgb),
                ink = if (pickDarker) darkerInk else lighterInk,
            )
        }
        if (i > 0 && (lightness == 0.0 || lightness == 1.0)) break
    }
    return null
}
