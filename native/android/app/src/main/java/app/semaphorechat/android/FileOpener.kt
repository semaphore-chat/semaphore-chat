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
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.semaphore.SemaphoreCore

/** The `FileProvider`'s authority: `<applicationId>.files` (AndroidManifest.xml). */
fun fileAuthority(context: Context) = "${context.packageName}.files"

/** The directory under the cache that opened files are written to, and the only one the provider serves. */
const val OPEN_DIR = "open"

/**
 * A file name that is safe to write under a directory of ours: no path separators or `..` (a
 * sender picks the name), no control or bidi characters, at most [MAX_NAME] characters with its
 * extension kept, never empty or hidden.
 */
fun safeFileName(name: String): String {
    val cleaned = buildString {
        name.forEach { c ->
            append(
                when {
                    c == '/' || c == '\\' || c == ':' || c == '\u0000' -> '_'
                    Character.isISOControl(c) -> '_'
                    c in BIDI -> '_'
                    else -> c
                },
            )
        }
    }.trim().trimStart('.')
    val base = cleaned.ifEmpty { "file" }
    if (base.length <= MAX_NAME) return base
    val dot = base.lastIndexOf('.')
    val ext = if (dot > 0 && base.length - dot <= 16) base.substring(dot) else ""
    return base.take(MAX_NAME - ext.length) + ext
}

private const val MAX_NAME = 120
/** The bidi controls that can make `exe.txt` read as `txt.exe` (as `strip_bidi` removes from messages). */
private val BIDI = setOf('‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '‎', '‏', '؜')

/**
 * Opens a sent file in another app: fetches it through core's `file` (the session's auth), writes
 * it to `cache/open/<file id>/<safe name>` and hands that out read-only through the provider,
 * with an `ACTION_VIEW` for its type. With no app for the type, the share sheet offers the rest
 * (Files to save it, another app to send it to). Opened files are cleared at start and on sign-out
 * ([clear]); nothing goes to shared storage.
 */
class FileOpener(private val context: Context, private val core: SemaphoreCore) {
    private val root get() = File(context.cacheDir, OPEN_DIR)

    /** Says whether something opened it. */
    suspend fun open(fileId: String, name: String, mimeType: String): Boolean {
        val uri = try {
            stage(fileId, name)
        } catch (_: Exception) {
            return false
        }
        val type = mimeType.ifBlank { "application/octet-stream" }
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return withContext(Dispatchers.Main) {
            try {
                context.startActivity(view)
                true
            } catch (_: ActivityNotFoundException) {
                share(uri, type)
            }
        }
    }

    /** Fetches the file and writes it where the provider serves it: the URI another app may read. */
    suspend fun stage(fileId: String, name: String): Uri {
        val bytes = core.file(fileId, false)
        val file = withContext(Dispatchers.IO) {
            // The id names the directory, so two files of one name never meet; a server id is a
            // UUID, but it goes through the same check as the name.
            val dir = File(root, safeFileName(fileId)).apply { mkdirs() }
            File(dir, safeFileName(name)).apply { writeBytes(bytes) }
        }
        return FileProvider.getUriForFile(context, fileAuthority(context), file)
    }

    private fun share(uri: Uri, type: String): Boolean {
        val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return try {
            context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    /** Deletes every opened file (at start and when the session ends: they were another account's). */
    fun clear() {
        root.deleteRecursively()
    }
}
