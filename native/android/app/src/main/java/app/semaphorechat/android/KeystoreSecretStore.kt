// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

import android.security.keystore.KeyGenParameterSpec
import android.util.Log
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.security.InvalidKeyException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.UnrecoverableKeyException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import uniffi.semaphore_mobile.SecretStore
import uniffi.semaphore_mobile.SecretStoreException

/**
 * The core's secrets (refresh tokens, the device id), sealed with a key that never leaves the
 * Android Keystore.
 *
 * - One AES-256-GCM key, generated in the Keystore and not exportable.
 * - One file per secret in [dir], named by the SHA-256 of the secret's key: a 12-byte IV, then
 *   the ciphertext and its tag. The secret's key is the GCM associated data, so a file copied
 *   under another name doesn't decrypt.
 * - [dir] belongs under `noBackupFilesDir`, so no secret goes into a backup (the key couldn't
 *   follow it anyway).
 * - [save] and [delete] are durable when they return: a temp file, fsync, rename over the old one,
 *   fsync the directory. The refresh token rotates on every refresh, and a token lost to a crash
 *   after its rotation ends the session (the server takes the old one, presented again, as theft).
 *
 * - A key that stops working (`KeyPermanentlyInvalidatedException`, an unrecoverable or invalid
 *   key, as some devices report after an OS update) is replaced: the alias and every sealed file
 *   are deleted, a new key is made, and the call is tried once more. The secrets sealed with the
 *   old key are lost (the user signs in again), not every secret from then on.
 *
 * The core calls these one at a time on a thread of its own; `@Synchronized` only makes that
 * explicit. Needs a device: the JVM test uses an in-memory store instead.
 */
class KeystoreSecretStore(private val dir: File) : SecretStore {
    @Synchronized
    override fun load(key: String): String? = guard {
        withWorkingKey { secretKey ->
            val file = fileFor(key)
            if (!file.exists()) return@withWorkingKey null
            val sealed = file.readBytes()
            if (sealed.size < IV_BYTES) throw IllegalStateException("${file.name} is truncated")
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey,
                GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES),
            )
            cipher.updateAAD(key.toByteArray(Charsets.UTF_8))
            String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES), Charsets.UTF_8)
        }
    }

    @Synchronized
    override fun save(key: String, value: String) = guard { withWorkingKey { seal(it, key, value) } }

    private fun seal(secretKey: SecretKey, key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // The Keystore picks a fresh random IV for every encryption.
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        cipher.updateAAD(key.toByteArray(Charsets.UTF_8))
        val sealed = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val iv = cipher.iv
        check(iv.size == IV_BYTES) { "unexpected IV length ${iv.size}" }
        dir.mkdirs()
        val file = fileFor(key)
        val temp = File(dir, "${file.name}.tmp")
        FileOutputStream(temp).use { out ->
            out.write(iv)
            out.write(sealed)
            out.fd.sync()
        }
        Os.rename(temp.path, file.path)
        syncDir()
    }

    /**
     * Runs [work] with the key; if the Keystore says the key no longer works, replaces it (losing
     * what it sealed) and runs [work] once more. A second failure is the store's error.
     */
    private inline fun <T> withWorkingKey(work: (SecretKey) -> T): T =
        try {
            work(key())
        } catch (error: Exception) {
            if (error !is InvalidKeyException && error !is UnrecoverableKeyException) throw error
            Log.e(TAG, "the Keystore key stopped working; its secrets are lost, making a new one", error)
            resetKey()
            work(key())
        }

    /** Deletes the key and every file it sealed, so the next [key] makes a new one. */
    private fun resetKey() {
        KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(KEY_ALIAS)
        dir.listFiles()
            ?.filter { it.name.endsWith(".sealed") || it.name.endsWith(".tmp") }
            ?.forEach { it.delete() }
        if (dir.exists()) syncDir()
    }

    @Synchronized
    override fun delete(key: String) = guard {
        val file = fileFor(key)
        if (file.exists()) {
            Os.remove(file.path)
            syncDir()
        }
    }

    private fun fileFor(key: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
        return File(dir, digest.joinToString("") { "%02x".format(it) } + ".sealed")
    }

    /** Makes the rename itself durable. */
    private fun syncDir() {
        val fd = Os.open(dir.path, OsConstants.O_RDONLY, 0)
        try {
            Os.fsync(fd)
        } finally {
            Os.close(fd)
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** Any failure reaches the core as a store error, which costs persistence, not the session. */
    private inline fun <T> guard(work: () -> T): T =
        try {
            work()
        } catch (error: Exception) {
            throw SecretStoreException.Failed("${error.javaClass.simpleName}: ${error.message}")
        }

    private companion object {
        const val TAG = "semaphore"
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "semaphore-secrets-v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
