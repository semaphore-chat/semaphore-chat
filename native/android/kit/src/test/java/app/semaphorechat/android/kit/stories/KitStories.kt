// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.stories

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Alert
import app.semaphorechat.android.kit.AlertAction
import app.semaphorechat.android.kit.AlertSeverity
import app.semaphorechat.android.kit.Avatar
import app.semaphorechat.android.kit.AvatarShape
import app.semaphorechat.android.kit.AvatarSize
import app.semaphorechat.android.kit.Button
import app.semaphorechat.android.kit.ButtonSize
import app.semaphorechat.android.kit.ButtonVariant
import app.semaphorechat.android.kit.Card
import app.semaphorechat.android.kit.IconButton
import app.semaphorechat.android.kit.IconButtonVariant
import app.semaphorechat.android.kit.Island
import app.semaphorechat.android.kit.ListRow
import app.semaphorechat.android.kit.ListRowSize
import app.semaphorechat.android.kit.Presence
import app.semaphorechat.android.kit.Spinner
import app.semaphorechat.android.kit.SpinnerSize
import app.semaphorechat.android.kit.SurfacePadding
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextField
import app.semaphorechat.android.kit.TextFieldShape
import app.semaphorechat.android.kit.TextFieldType
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant
import app.semaphorechat.android.kit.personColour

/** A kit story: an id (`kit-<component>`) and what it draws on the ground. */
data class Story(val id: String, val content: @Composable () -> Unit)

private val none: () -> Unit = {}

/** A labelled group of states inside an island. */
@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
        Text(title, variant = TextVariant.Meta, tone = TextTone.Dim)
        content()
    }
}

@Composable
private fun Page(gap: androidx.compose.ui.unit.Dp = Tokens.Space.Lg, content: @Composable ColumnScope.() -> Unit) {
    Island(
        modifier = Modifier.fillMaxWidth().padding(Tokens.Space.Md),
        padding = SurfacePadding.Lg,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(gap), content = content)
    }
}

val KIT_STORIES: List<Story> = listOf(
    Story("kit-text") {
        Page {
            TextVariant.entries.forEach { Text("${it.name}: The quick brown fox", variant = it) }
            Section("Tones") {
                TextTone.entries.forEach { Text("${it.name} tone", tone = it) }
            }
            Section("Truncate") {
                Text(
                    "A very long line of text that does not fit on one line of a phone and is cut",
                    truncate = true,
                )
                Text("A very long line of text that wraps onto a second line when it is not truncated")
            }
        }
    },
    Story("kit-button") {
        Page {
            Section("Variants") {
                ButtonVariant.entries.forEach { Button(it.name, none, variant = it) }
            }
            Section("Sizes, icon, loading, disabled") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm), verticalAlignment = Alignment.CenterVertically) {
                    Button("Small", none, variant = ButtonVariant.Primary, size = ButtonSize.Sm)
                    Button("Medium", none, variant = ButtonVariant.Primary)
                    Button("Large", none, variant = ButtonVariant.Primary, size = ButtonSize.Lg)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    Button("Send", none, variant = ButtonVariant.Primary, startIcon = Icons.Send)
                    Button("Saving", none, variant = ButtonVariant.Primary, loading = true)
                    Button("Off", none, variant = ButtonVariant.Primary, enabled = false)
                }
                Button("Sign in", none, variant = ButtonVariant.Primary, fullWidth = true)
            }
        }
    },
    Story("kit-icon-button") {
        Page {
            Section("Variants") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    IconButtonVariant.entries.forEach { IconButton(Icons.Mic, it.name, none, variant = it) }
                }
            }
            Section("Sizes") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm), verticalAlignment = Alignment.CenterVertically) {
                    ButtonSize.entries.forEach { IconButton(Icons.Settings, it.name, none, size = it, variant = IconButtonVariant.Soft) }
                }
            }
            Section("Selected, badge, loading, disabled") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    IconButton(Icons.MicOff, "Mute", none, selected = true)
                    IconButton(Icons.Mic, "Mute", none, selected = false)
                    IconButton(Icons.Bell, "Notifications", none, badge = 3)
                    IconButton(Icons.Inbox, "Inbox", none, badge = 120)
                    IconButton(Icons.Send, "Send", none, loading = true, variant = IconButtonVariant.Primary)
                    IconButton(Icons.Plus, "Add", none, enabled = false)
                }
            }
        }
    },
    Story("kit-text-field") {
        Page {
            TextField("", {}, label = "Server", placeholder = "https://chat.example.com", type = TextFieldType.Url, required = true)
            TextField("priya", {}, label = "Username", helper = "The name you sign in with")
            TextField("hunter2", {}, label = "Password", type = TextFieldType.Password, error = "That password is wrong")
            TextField("", {}, label = "Search", labelHidden = true, placeholder = "Search", shape = TextFieldShape.Round, startIcon = Icons.Search)
            TextField("Read only", {}, label = "Disabled", enabled = false)
        }
    },
    Story("kit-list-row") {
        // A list's rows touch: the gaps are the rows' own height.
        Page(gap = Tokens.Space.None) {
            ListRow("general", leading = { app.semaphorechat.android.kit.Icon(Icons.Hash) }, onClick = none)
            ListRow("announcements", leading = { app.semaphorechat.android.kit.Icon(Icons.Megaphone) }, unread = true, onClick = none)
            ListRow("design", leading = { app.semaphorechat.android.kit.Icon(Icons.Hash) }, selected = true, onClick = none)
            ListRow("archive", leading = { app.semaphorechat.android.kit.Icon(Icons.Hash) }, muted = true, onClick = none)
            ListRow(
                "Priya Raman",
                secondary = "Typing a very long status message that will not fit",
                size = ListRowSize.Lg,
                leading = { Avatar("Priya Raman", colour = personColour("u-priya"), presence = Presence.Online) },
                trailingLabel = "12:04",
                onClick = none,
            )
            ListRow("Settings", leading = { app.semaphorechat.android.kit.Icon(Icons.Settings) }, chevron = true, onClick = none)
            ListRow("Joining voice", leading = { app.semaphorechat.android.kit.Icon(Icons.Headphones) }, busy = true)
            ListRow("Unavailable", leading = { app.semaphorechat.android.kit.Icon(Icons.Lock) }, enabled = false, onClick = none)
        }
    },
    Story("kit-avatar") {
        Page {
            Section("Sizes") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm), verticalAlignment = Alignment.CenterVertically) {
                    AvatarSize.entries.forEach { Avatar("Priya Raman", colour = personColour("u-priya"), size = it) }
                }
            }
            Section("People's colours") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    listOf("a", "A", "foobar", "u-sam", "u-lee", "u-ana", "u-kim").forEach {
                        Avatar(it, colour = personColour(it))
                    }
                }
            }
            Section("Presence: online, away, offline, speaking") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Md), verticalAlignment = Alignment.CenterVertically) {
                    Presence.entries.forEach { Avatar("Sam Lee", colour = personColour("u-sam"), presence = it) }
                }
            }
            Section("No colour, communities") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Md), verticalAlignment = Alignment.CenterVertically) {
                    Avatar("No Colour")
                    Avatar("Semaphore Club", shape = AvatarShape.Rounded, size = AvatarSize.Lg)
                    Avatar("Semaphore Club", shape = AvatarShape.Rounded, size = AvatarSize.Xl, colour = personColour("c-club"))
                }
            }
        }
    },
    Story("kit-spinner") {
        Page {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Lg), verticalAlignment = Alignment.CenterVertically) {
                SpinnerSize.entries.forEach { Spinner(size = it) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm), verticalAlignment = Alignment.CenterVertically) {
                Spinner(label = "Loading messages")
                Text("Loading messages", tone = TextTone.Secondary)
            }
        }
    },
    Story("kit-alert") {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.Md),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
        ) {
            Alert(AlertSeverity.Info, "A new version is ready.", title = "Update", action = AlertAction("Restart", none), onClose = none)
            Alert(AlertSeverity.Success, "Your profile was saved.")
            Alert(
                AlertSeverity.Warning,
                "You are offline. Messages you send now go out when the connection is back, which can take a while.",
                title = "Offline",
                action = AlertAction("Retry", none),
                secondaryAction = AlertAction("Details", none),
            )
            Alert(AlertSeverity.Danger, "Could not reach the server at chat.example.com", title = "Sign-in failed", oneLine = true, onClose = none)
            Island(padding = SurfacePadding.Md) {
                Alert(AlertSeverity.Info, "On an island the alert stands out in the fill colour.")
            }
        }
    },
    Story("kit-surfaces") {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.Md),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
        ) {
            Text("On the ground", tone = TextTone.Secondary)
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                Button("Soft on ground", none)
                Button("Ghost", none, variant = ButtonVariant.Ghost)
            }
            Island {
                Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md)) {
                    Text("Island", variant = TextVariant.Section)
                    Button("Soft on island", none)
                    Card {
                        Text("Card", variant = TextVariant.Name)
                        Text("A grouped block in the fill colour.", tone = TextTone.Secondary)
                        Button("Soft on card", none)
                    }
                    Card(selected = true, onClick = none) {
                        Text("Selected card", variant = TextVariant.Name)
                    }
                    Card(padding = SurfacePadding.Lg) {
                        Card { Text("A card on a card takes the surface colour") }
                    }
                }
            }
        }
    },
    Story("kit-sign-in") {
        Column(modifier = Modifier.fillMaxWidth().padding(Tokens.Space.Md)) {
            Island(padding = SurfacePadding.Lg) {
                Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Lg)) {
                    Text("Sign in", variant = TextVariant.Title, heading = true)
                    Text("Use the account you have on your community's server.", tone = TextTone.Secondary)
                    TextField("https://chat.example.com", {}, label = "Server", type = TextFieldType.Url)
                    TextField("priya", {}, label = "Username")
                    TextField("", {}, label = "Password", type = TextFieldType.Password, placeholder = "Password")
                    Alert(AlertSeverity.Danger, "That username and password do not match.", announce = false)
                    Button("Sign in", none, variant = ButtonVariant.Primary, size = ButtonSize.Lg, fullWidth = true)
                    Button("Forgot password", none, variant = ButtonVariant.Text, fullWidth = true)
                }
            }
        }
    },
)
