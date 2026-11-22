// Semaphore Chat's Android client. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android

/**
 * Opens a message's web links. Every address goes through `check_link` again here, whatever drew
 * it, and only the address `check_link` returns is ever handed to [launch]: never the text the
 * link was written with, and nothing at all for a link it refuses (any scheme but http and https,
 * a user name or password). A refused link is never drawn as pressable either (`message_pieces`
 * turns it into plain text), so this is the second of two checks.
 */
class LinkOpener(
    private val launch: (String) -> Unit,
    private val check: (String) -> String? = { uniffi.semaphore.checkLink(it)?.href },
) {
    /** Opens [href] if `check_link` allows it, and says whether it did. */
    fun open(href: String): Boolean {
        val safe = check(href) ?: return false
        launch(safe)
        return true
    }
}
