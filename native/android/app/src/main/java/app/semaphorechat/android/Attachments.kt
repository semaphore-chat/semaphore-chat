// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.content.ContentResolver
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import app.semaphorechat.android.kit.chat.AttachmentImages
import app.semaphorechat.android.kit.chat.ImageLoad
import app.semaphorechat.android.screens.ComposerCaps
import app.semaphorechat.android.screens.fileSizeText
import java.io.IOException
import java.io.InputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import uniffi.semaphore.SemaphoreCore

/**
 * A file picked for the next message. Its bytes are read only when it is sent ([read]), so ten
 * picked files cost nothing until then. [sizeBytes] is what the picker said, or null when it
 * didn't say.
 */
class PickedFile(
    val name: String,
    val sizeBytes: Long?,
    val mimeType: String,
    val read: () -> ByteArray,
)

/** A file couldn't be read, or turned out bigger than its size said. Never carries its contents. */
class UnreadableFile(val name: String) : IOException("unreadable file")

/**
 * Why picking [picked] on top of [queued] files is refused, as desktop's `attachment_problem` says
 * it, or null: attaching turned off here, a file over the size limit, or too many files. The
 * whole pick is refused, as on desktop.
 */
fun attachProblem(queued: Int, picked: List<PickedFile>, canAttach: Boolean, channelName: String): String? {
    if (!canAttach) {
        return if (channelName.isEmpty()) "Attaching files is turned off in this channel" else "Attaching files is turned off in #$channelName"
    }
    picked.firstOrNull { (it.sizeBytes ?: 0) > ComposerCaps.MAX_FILE_BYTES }?.let {
        return "File \"${it.name}\" exceeds the ${fileSizeText(ComposerCaps.MAX_FILE_BYTES)} size limit"
    }
    if (queued + picked.size > ComposerCaps.MAX_FILES) return "Maximum ${ComposerCaps.MAX_FILES} files per message"
    return null
}

/**
 * Reads [input] whole, refusing past [limit] bytes: a picker's size can be missing or wrong, so the
 * limit holds while reading, not only before.
 */
fun readCapped(input: InputStream, limit: Long, name: String): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        if (total > limit) throw UnreadableFile(name)
        out.write(buffer, 0, read)
    }
    return out.toByteArray()
}

/** What a content URI says about itself: its name, its size (when known) and its type. */
fun pickedFile(resolver: ContentResolver, uri: Uri): PickedFile {
    var name: String? = null
    var size: Long? = null
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (nameAt >= 0 && !cursor.isNull(nameAt)) name = cursor.getString(nameAt)
            if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt).takeIf { it >= 0 }
        }
    }
    val shown = name?.takeIf { it.isNotBlank() } ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "file"
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    return PickedFile(shown, size, mime) {
        val input = resolver.openInputStream(uri) ?: throw UnreadableFile(shown)
        input.use { readCapped(it, ComposerCaps.MAX_FILE_BYTES, shown) }
    }
}

/** An image file bigger than this isn't decoded (desktop's `MAX_IMAGE_BYTES`, semaphore-app/src/files.rs). */
const val MAX_IMAGE_BYTES = 16 * 1024 * 1024
/** Pixels in one frame of a still image past which it isn't decoded (desktop's `MAX_IMAGE_PIXELS`). */
const val MAX_IMAGE_PIXELS = 64_000_000L
/** The same for GIF and WebP, which may be animated (desktop's `MAX_ANIMATED_PIXELS`). */
const val MAX_ANIMATED_PIXELS = 4_000_000L

/**
 * Whether an image of [byteCount] bytes and [width]×[height] pixels (read from its header) may be
 * decoded, by desktop's rules: never past the byte or pixel limits, and a tighter pixel limit for
 * the formats that animate.
 */
fun imageDecodable(byteCount: Int, width: Int, height: Int, mimeType: String?): Boolean {
    if (byteCount > MAX_IMAGE_BYTES || width <= 0 || height <= 0) return false
    val pixels = width.toLong() * height.toLong()
    val animated = mimeType == "image/gif" || mimeType == "image/webp"
    return pixels <= if (animated) MAX_ANIMATED_PIXELS else MAX_IMAGE_PIXELS
}

/** The power-of-two step that brings a [width]×[height] image within [maxSide] on its longer side. */
fun sampleSize(width: Int, height: Int, maxSide: Int): Int {
    var sample = 1
    while (maxOf(width, height) / (sample * 2) >= maxSide) sample *= 2
    return sample
}

/**
 * The tiles' pictures, through core's `file` (the session's auth and refresh). Decoded pictures
 * are kept in a memory cache bounded by their bytes; nothing is written to disk. A picture that
 * isn't an image, is too big by desktop's rules, or fails to fetch is [ImageLoad.Failed], and the
 * tile draws its file row instead. At most [PARALLEL] fetches run at once.
 */
class AttachmentLoader(
    private val core: SemaphoreCore,
    private val scope: CoroutineScope,
    /** Pixels on the longer side a decoded picture needs at most (a 320 dp box on this screen). */
    private val maxSide: Int,
) : AttachmentImages {
    private val lock = Any()
    private val flows = HashMap<Pair<String, Boolean>, MutableStateFlow<ImageLoad>>()
    private val gate = Semaphore(PARALLEL)
    private val decoded = object : LruCache<Pair<String, Boolean>, ImageBitmap>(cacheBytes()) {
        override fun sizeOf(key: Pair<String, Boolean>, value: ImageBitmap) = value.width * value.height * 4
        override fun entryRemoved(evicted: Boolean, key: Pair<String, Boolean>, old: ImageBitmap, new: ImageBitmap?) {
            // Fetched again the next time a tile asks.
            if (evicted) synchronized(lock) { flows.remove(key) }
        }
    }

    override fun image(fileId: String, thumbnail: Boolean): StateFlow<ImageLoad> {
        val key = fileId to thumbnail
        synchronized(lock) {
            flows[key]?.let { return it }
            val flow = MutableStateFlow<ImageLoad>(ImageLoad.Loading)
            flows[key] = flow
            scope.launch(Dispatchers.IO) { flow.value = load(key) }
            return flow
        }
    }

    private suspend fun load(key: Pair<String, Boolean>): ImageLoad {
        decoded.get(key)?.let { return ImageLoad.Ready(it) }
        val bytes = try {
            gate.withPermit { core.file(key.first, key.second) }
        } catch (_: Exception) {
            // Not only CoreException: a failed picture must never end the process.
            return ImageLoad.Failed
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (!imageDecodable(bytes.size, bounds.outWidth, bounds.outHeight, bounds.outMimeType)) return ImageLoad.Failed
        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxSide) }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return ImageLoad.Failed
        val image = bitmap.asImageBitmap()
        decoded.put(key, image)
        return ImageLoad.Ready(image)
    }

    /** The session ended: forget every picture, which was another account's. */
    fun clear() {
        synchronized(lock) { flows.clear() }
        decoded.evictAll()
    }

    private companion object {
        const val PARALLEL = 4

        /** An eighth of the heap, as Android's guidance for a bitmap cache suggests. */
        fun cacheBytes(): Int = (Runtime.getRuntime().maxMemory() / 8).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }
}
