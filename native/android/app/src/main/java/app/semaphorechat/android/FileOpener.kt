// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import app.semaphorechat.android.kit.chat.displayName
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.semaphore.FileRange
import uniffi.semaphore.SemaphoreCore

/** The `FileProvider`'s authority: `<applicationId>.files` (AndroidManifest.xml). */
fun fileAuthority(context: Context) = "${context.packageName}.files"

/** The directory under the cache that opened files are written to, and the only one the provider serves. */
const val OPEN_DIR = "open"

/** Bytes per ranged read while staging a file: memory stays this size however big the file is. */
const val OPEN_CHUNK = 256 * 1024L

/**
 * A file bigger than this isn't staged: at [OPEN_CHUNK] its bytes are not held in memory, so this
 * bounds the cache, not the heap (a phone's cache holds this one file). Files sent from this app
 * are far smaller; one sent from the web can be as big as the instance allows.
 */
const val MAX_OPEN_BYTES = 256L * 1024 * 1024

/**
 * A file name that is safe to write under a directory of ours: no path separators or `..` (a
 * sender picks the name), no bidi controls (the shared [displayName] strip, so it can't read as
 * another name) and no other control characters, at most [MAX_NAME_BYTES] UTF-8 bytes with its
 * extension kept, never empty or hidden.
 */
fun safeFileName(name: String): String {
    val cleaned = buildString {
        displayName(name).forEach { c ->
            append(
                when {
                    c == '/' || c == '\\' || c == ':' || c == '\u0000' -> '_'
                    Character.isISOControl(c) -> '_'
                    else -> c
                },
            )
        }
    }.trim().trimStart('.')
    val base = cleaned.ifEmpty { "file" }
    return truncateBytes(base, MAX_NAME_BYTES)
}

/** At most this many UTF-8 bytes of a name reach the file system (the file system's own limit is 255). */
private const val MAX_NAME_BYTES = 200

/** The extension kept when a name is cut: no longer than this, or it is not an extension. */
private const val MAX_EXTENSION = 16

/**
 * [name] cut to at most [maxBytes] UTF-8 bytes without splitting a character (a name can be all
 * emoji), its extension kept when it has one short enough to be one.
 */
private fun truncateBytes(name: String, maxBytes: Int): String {
    if (name.toByteArray(Charsets.UTF_8).size <= maxBytes) return name
    val dot = name.lastIndexOf('.')
    val extension = if (dot > 0 && name.length - dot <= MAX_EXTENSION) name.substring(dot) else ""
    val body = name.substring(0, name.length - extension.length)
    val room = maxBytes - extension.toByteArray(Charsets.UTF_8).size
    val cut = StringBuilder()
    var used = 0
    var at = 0
    while (at < body.length) {
        val point = body.codePointAt(at)
        val bytes = utf8Length(point)
        if (used + bytes > room) break
        cut.appendCodePoint(point)
        used += bytes
        at += Character.charCount(point)
    }
    return cut.toString() + extension
}

/** UTF-8 bytes [point] takes. */
private fun utf8Length(point: Int): Int = when {
    point < 0x80 -> 1
    point < 0x800 -> 2
    point < 0x10000 -> 3
    else -> 4
}

/**
 * Whether [name]'s extension names a type other than [type] (the message's MIME type). The intent's
 * data type is what a receiver trusts, so a file whose name says another type is handed to the
 * share sheet instead: it gives the bytes to an app to save or send, not to a viewer primed by a
 * name the sender chose. An extension Android doesn't know counts as a disagreement.
 */
fun typeMismatch(name: String, type: String): Boolean {
    val mime = type.substringBefore(';').trim()
    if (mime.isEmpty() || mime.equals("application/octet-stream", ignoreCase = true)) return false
    val extension = name.substringAfterLast('.', "").lowercase()
    if (extension.isEmpty()) return false
    val named = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: return true
    return !named.equals(mime, ignoreCase = true)
}

/** A file's bytes in `[start, end]` (end inclusive) and its whole size, when the server knows it. */
fun interface FileRanges {
    suspend fun read(fileId: String, start: Long, end: Long): FileRange
}

/**
 * Opens a sent file in another app: reads it through core's `file_range` in [OPEN_CHUNK] pieces
 * (the session's auth), writes them to `cache/open/<file id>/<safe name>` and hands that out
 * read-only through the provider, with an `ACTION_VIEW` for its type. Refuses a file over
 * [maxBytes], before its bytes are written when the server's first read says so. With no app for
 * the type, or a name whose extension disagrees with it, the share sheet offers the rest (Files to
 * save it, another app to send it to). Opened files are cleared at start and on sign-out ([clear]);
 * nothing goes to shared storage, and nothing written for a session that has since ended is
 * handed out.
 */
class FileOpener(
    private val context: Context,
    private val ranges: FileRanges,
    /** Most bytes one file may take in the cache. */
    private val maxBytes: Long = MAX_OPEN_BYTES,
    /** Where the Intent is started: the main thread, or a test's. */
    private val main: CoroutineDispatcher = Dispatchers.Main,
) {
    /** A file opened over core's `file_range` (the session's auth). */
    constructor(context: Context, core: SemaphoreCore, maxBytes: Long = MAX_OPEN_BYTES) :
        this(context, FileRanges { id, start, end -> core.fileRange(id, start.toULong(), end.toULong()) }, maxBytes)

    private val lock = Any()

    /** Bumped by [clear]: a stage started under an older one never yields a URI. */
    private var generation = 0

    private val root get() = File(context.cacheDir, OPEN_DIR)

    /** Says whether something opened it. */
    suspend fun open(fileId: String, name: String, mimeType: String): Boolean {
        val uri = try {
            stage(fileId, name) ?: return false
        } catch (cancelled: CancellationException) {
            // The screen went away: not a reason to report a failure.
            throw cancelled
        } catch (_: Throwable) {
            // A failed fetch, a full cache, a stream that broke: the tap says it couldn't open.
            return false
        }
        val type = mimeType.ifBlank { "application/octet-stream" }
        return withContext(main) {
            try {
                if (typeMismatch(name, type)) {
                    share(uri, type)
                } else {
                    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(view)
                    true
                }
            } catch (_: ActivityNotFoundException) {
                share(uri, type)
            } catch (_: RuntimeException) {
                // A receiver that won't start for another reason (no permission to this URI, a
                // malformed one) is a tap that didn't open: never a crash.
                false
            }
        }
    }

    /**
     * Reads the file into the cache and returns the URI another app may read, or null when the
     * session ended while it was read (nothing of another account's is then handed out).
     */
    suspend fun stage(fileId: String, name: String): Uri? {
        val started = synchronized(lock) { generation }
        val file = withContext(Dispatchers.IO) {
            // The id names the directory, so two files of one name never meet; a server id is a
            // UUID, but it goes through the same check as the name.
            File(File(root, safeFileName(fileId)).apply { mkdirs() }, safeFileName(name))
        }
        val done = try {
            withContext(Dispatchers.IO) { write(fileId, file, started) }
        } catch (cancelled: CancellationException) {
            file.parentFile?.deleteRecursively()
            throw cancelled
        } catch (refused: Throwable) {
            file.parentFile?.deleteRecursively()
            throw refused
        }
        if (!done || synchronized(lock) { generation != started }) {
            file.parentFile?.deleteRecursively()
            return null
        }
        return FileProvider.getUriForFile(context, fileAuthority(context), file)
    }

    /** Streams the file's bytes into [file]; false when the session ended before the last one. */
    private suspend fun write(fileId: String, file: File, started: Int): Boolean {
        var start = 0L
        var total: Long? = null
        java.io.BufferedOutputStream(file.outputStream(), OPEN_CHUNK.toInt()).use { out ->
            while (total == null || start < total!!) {
                if (synchronized(lock) { generation != started }) return false
                val range = ranges.read(fileId, start, start + OPEN_CHUNK - 1)
                val size = range.size?.toLong()
                // The server's own count: refused before more than the first piece is written.
                if (size != null && size > maxBytes) throw TooLargeFile(size)
                if (size != null) total = size
                val bytes = range.bytes
                if (bytes.isEmpty()) {
                    // No more bytes and no size: the file ended at what was written.
                    break
                }
                out.write(bytes)
                start += bytes.size
                if (start > maxBytes) throw TooLargeFile(start)
            }
        }
        return true
    }

    private fun share(uri: Uri, type: String): Boolean {
        val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return try {
            context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: RuntimeException) {
            false
        }
    }

    /** Deletes every opened file (at start and when the session ends: they were another account's). */
    fun clear() {
        synchronized(lock) { generation++ }
        root.deleteRecursively()
    }
}

/** A file the server says is bigger than one [FileOpener] stages. */
class TooLargeFile(val bytes: Long) : java.io.IOException("file too large")
