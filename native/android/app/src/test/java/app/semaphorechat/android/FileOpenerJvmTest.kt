// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import app.semaphorechat.android.kit.chat.ImageLoad
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uniffi.semaphore.FileRange

/**
 * [FileOpener] and [AttachmentLoader] against Android's own FileProvider, Intent and LruCache,
 * with the file's bytes from memory (no core, no server): what another app is handed, the cache
 * size refusal, a receiver that won't start, sign-out clearing, and a picture that failed being
 * fetched again.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FileOpenerJvmTest {
    private val app = RuntimeEnvironment.getApplication()

    /** Starts Intents into [started] instead of the system. */
    private class Recorder(base: Context) : ContextWrapper(base) {
        val started = mutableListOf<Intent>()

        override fun startActivity(intent: Intent) {
            started += intent
        }
    }

    /** No app takes Intents from here. */
    private class Refuser(base: Context) : ContextWrapper(base) {
        override fun startActivity(intent: Intent) {
            throw IllegalStateException("no receiver")
        }
    }

    /** The bytes, in the inclusive ranges asked for, and the whole size. */
    private fun bytesOf(bytes: ByteArray) = FileRanges { _, start, end ->
        val from = start.toInt().coerceIn(0, bytes.size)
        val to = (minOf(end, (bytes.size - 1).toLong()) + 1).toInt().coerceIn(from, bytes.size)
        FileRange(bytes.copyOfRange(from, to), bytes.size.toULong())
    }

    @Before
    fun cleanCache() {
        File(app.cacheDir, OPEN_DIR).deleteRecursively()
        // Robolectric gives every test its own data dir, and FileProvider keeps the roots it built
        // for an authority in a static map: the first test's cache dir would be the only one served.
        FileProvider::class.java.declaredFields
            .firstOrNull { java.lang.reflect.Modifier.isStatic(it.modifiers) && Map::class.java.isAssignableFrom(it.type) }
            ?.apply { isAccessible = true }
            ?.get(null)
            ?.let { (it as MutableMap<*, *>).clear() }
    }

    /** Nothing was left in the cache (the directory itself may stay, empty). */
    private fun assertCacheHasNoFiles() {
        assertFalse(File(app.cacheDir, OPEN_DIR).walk().any { it.isFile })
    }

    @After
    fun tidyCache() {
        File(app.cacheDir, OPEN_DIR).deleteRecursively()
    }

    @Test
    fun openingStreamsTheFileToWhereTheProviderServesIt() = runBlocking {
        val bytes = ByteArray((OPEN_CHUNK * 2).toInt() + 7) { (it % 251).toByte() }
        val asked = mutableListOf<Pair<Long, Long>>()
        val context = Recorder(app)
        val opener = FileOpener(
            context,
            FileRanges { _, start, end ->
                asked += start to end
                val from = start.toInt().coerceIn(0, bytes.size)
                val to = (minOf(end, (bytes.size - 1).toLong()) + 1).toInt().coerceIn(from, bytes.size)
                FileRange(bytes.copyOfRange(from, to), bytes.size.toULong())
            },
            main = Dispatchers.Unconfined,
        )

        assertTrue(opener.open("f1", "notes.txt", "application/octet-stream"))
        val view = context.started.single()
        assertEquals(Intent.ACTION_VIEW, view.action)
        assertEquals("application/octet-stream", view.type)
        assertEquals("content", view.data!!.scheme)
        assertEquals(fileAuthority(context), view.data!!.authority)
        assertTrue(view.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(view.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        // Read back through the provider, as the other app does.
        val served = app.contentResolver.openInputStream(view.data!!)!!.use { it.readBytes() }
        assertArrayEquals(bytes, served)
        // Streamed in OPEN_CHUNK pieces, not held whole.
        assertEquals(3, asked.size)
        assertEquals(OPEN_CHUNK - 1, asked.first().second)
    }

    @Test
    fun aFileTheServerSaysIsTooBigIsRefusedBeforeItsBytesAreWritten() = runBlocking {
        val context = Recorder(app)
        var reads = 0
        val opener = FileOpener(
            context,
            FileRanges { _, _, _ ->
                reads++
                FileRange(ByteArray(16), (MAX_OPEN_BYTES + 1).toULong())
            },
            main = Dispatchers.Unconfined,
        )

        assertFalse(opener.open("huge", "huge.bin", "application/octet-stream"))
        assertEquals("refused on the first piece's size", 1, reads)
        assertTrue(context.started.isEmpty())
        assertCacheHasNoFiles()
    }

    @Test
    fun aNameThatDisagreesWithItsTypeGoesToTheShareSheet() = runBlocking {
        assertFalse(typeMismatch("noextension", "image/png"))
        assertFalse(typeMismatch("x", "application/octet-stream"))
        assertFalse(typeMismatch("x", ""))
        assertTrue(typeMismatch("photo.jpg", "application/zip"))
        assertTrue(typeMismatch("photo.zzz", "image/jpeg"))

        val context = Recorder(app)
        val opener = FileOpener(context, bytesOf("zip".toByteArray()), main = Dispatchers.Unconfined)
        assertTrue(opener.open("f1", "photo.jpg", "application/zip"))
        val chooser = context.started.single()
        assertEquals(Intent.ACTION_CHOOSER, chooser.action)
        @Suppress("DEPRECATION")
        val send = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
        assertEquals(Intent.ACTION_SEND, send.action)
        assertEquals("application/zip", send.type)
        assertTrue(send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    }

    @Test
    fun aReceiverThatWontStartIsAFailedTapNotACrash() = runBlocking {
        val opener = FileOpener(Refuser(app), bytesOf("x".toByteArray()), main = Dispatchers.Unconfined)
        assertFalse(opener.open("f1", "a.bin", "application/octet-stream"))
    }

    @Test
    fun clearingRemovesOpenedFilesAndStopsOneInFlight() = runBlocking {
        val opener = FileOpener(app, bytesOf(ByteArray(8) { 1 }), main = Dispatchers.Unconfined)
        assertNotNull(opener.stage("f1", "a.txt"))
        assertTrue(File(app.cacheDir, OPEN_DIR).listFiles()!!.isNotEmpty())
        opener.clear()
        assertCacheHasNoFiles()

        // Signing out while a file is being read: its bytes are not handed out.
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val slow = FileOpener(
            app,
            FileRanges { _, _, _ ->
                entered.complete(Unit)
                gate.await()
                FileRange(ByteArray(4) { 2 }, 4u)
            },
            main = Dispatchers.Unconfined,
        )
        var result: Uri? = null
        val job = launch(Dispatchers.Default) { result = slow.stage("f2", "b.txt") }
        entered.await()
        slow.clear()
        gate.complete(Unit)
        job.join()
        assertNull(result)
        assertCacheHasNoFiles()
    }

    @Test
    fun aPictureThatFailedIsForgottenSoTheNextDrawFetchesAgain() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            var fetches = 0
            val loader = AttachmentLoader({ _, _ -> fetches++; throw IllegalStateException("offline") }, scope, maxSide = 320)
            val a = loader.image("f1", false, null)
            assertTrue(withTimeout(5_000) { a.first { it !is ImageLoad.Loading } } is ImageLoad.Failed)
            assertEquals(1, fetches)
            val b = loader.image("f1", false, null)
            assertNotSame("a failure is not cached", a, b)
            assertTrue(withTimeout(5_000) { b.first { it !is ImageLoad.Loading } } is ImageLoad.Failed)
            assertEquals(2, fetches)
            loader.clear()
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun aFullPictureOverTheDecodeLimitIsNeverFetchedButItsThumbnailIs() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        try {
            var fetches = 0
            val loader = AttachmentLoader({ _, _ -> fetches++; throw IllegalStateException("offline") }, scope, maxSide = 320)
            val refused = loader.image("big", false, MAX_IMAGE_BYTES + 1L)
            assertEquals(ImageLoad.Failed, refused.value)
            assertEquals("nothing fetched", 0, fetches)
            // The small copy is small whatever the file is.
            val thumb = loader.image("big", true, MAX_IMAGE_BYTES + 1L)
            assertTrue(withTimeout(5_000) { thumb.first { it !is ImageLoad.Loading } } is ImageLoad.Failed)
            assertEquals(1, fetches)
            loader.clear()
        } finally {
            scope.cancel()
        }
    }
}
