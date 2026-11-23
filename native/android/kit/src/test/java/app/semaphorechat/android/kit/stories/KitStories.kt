// Semaphore Chat's Android Compose kit. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.kit.stories

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Alert
import app.semaphorechat.android.kit.AlertAction
import app.semaphorechat.android.kit.AlertSeverity
import app.semaphorechat.android.kit.Avatar
import app.semaphorechat.android.kit.AvatarStack
import app.semaphorechat.android.kit.Badge
import app.semaphorechat.android.kit.BadgeTone
import app.semaphorechat.android.kit.Dock
import app.semaphorechat.android.kit.DockDivider
import app.semaphorechat.android.kit.DockItem
import app.semaphorechat.android.kit.Pill
import app.semaphorechat.android.kit.PillTone
import app.semaphorechat.android.kit.Sheet
import app.semaphorechat.android.kit.Skeleton
import app.semaphorechat.android.kit.SkeletonShape
import app.semaphorechat.android.kit.StackPerson
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

private val none: () -> Unit = {}

/** A labelled group of states inside an island. */
@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
        Text(title, variant = TextVariant.Meta, tone = TextTone.Dim)
        content()
    }
}

/**
 * A page where the one control given the interaction source has keyboard focus, so the focus
 * ring is rendered. Only one control can hold focus, so a focused story has one.
 */
@Composable
private fun FocusedPage(content: @Composable ColumnScope.(MutableInteractionSource) -> Unit) {
    // A real focus needs a window with focus, which the render has not; the control sees the same
    // interaction a keyboard focus emits.
    val source = remember { MutableInteractionSource() }
    LaunchedEffect(Unit) {
        // Frames, not a delay: the control must be collecting before the interaction is emitted.
        androidx.compose.runtime.withFrameNanos { }
        androidx.compose.runtime.withFrameNanos { }
        source.emit(FocusInteraction.Focus())
    }
    Page { content(source) }
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
    Story("kit-focus-button") {
        FocusedPage { focus ->
            Section("Primary, focused") { Button("Sign in", none, interactionSource = focus, variant = ButtonVariant.Primary, size = ButtonSize.Lg, fullWidth = true) }
            Section("Soft, not focused") { Button("Cancel", none) }
        }
    },
    Story("kit-focus-icon-button") {
        FocusedPage { focus ->
            Section("Ghost, focused") { IconButton(Icons.Settings, "Settings", none, interactionSource = focus) }
            Section("Primary, not focused") { IconButton(Icons.Send, "Send", none, variant = IconButtonVariant.Primary) }
        }
    },
    Story("kit-focus-list-row") {
        FocusedPage { focus ->
            Section("Selected, focused") {
                ListRow("design", leading = { app.semaphorechat.android.kit.Icon(Icons.Hash) }, selected = true, interactionSource = focus, onClick = none)
            }
            Section("Plain, not focused") {
                ListRow("general", leading = { app.semaphorechat.android.kit.Icon(Icons.Hash) }, onClick = none)
            }
        }
    },
    Story("kit-focus-list-row-plain") {
        FocusedPage { focus ->
            Section("Plain, focused") {
                ListRow("general", leading = { app.semaphorechat.android.kit.Icon(Icons.Hash) }, interactionSource = focus, onClick = none)
            }
            Section("Card, not focused") { Card(onClick = none) { Text("A card", variant = TextVariant.Name) } }
        }
    },
    Story("kit-focus-card") {
        FocusedPage { focus ->
            Card(interactionSource = focus, onClick = none) { Text("Focused card", variant = TextVariant.Name) }
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
            ListRow(
                "design",
                leading = { app.semaphorechat.android.kit.Icon(Icons.Hash) },
                selected = true,
                trailing = {
                    IconButton(Icons.Settings, "Settings", none, size = ButtonSize.Sm)
                    IconButton(Icons.Bell, "Notifications", none, size = ButtonSize.Sm, variant = IconButtonVariant.Soft, badge = 3)
                },
                onClick = none,
            )
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
            Section("Speaking, rounded speaking, on a card") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Lg), verticalAlignment = Alignment.CenterVertically) {
                    Avatar("Sam Lee", colour = personColour("u-sam"), presence = Presence.Speaking)
                    Avatar("Sam Lee", colour = personColour("u-sam"), size = AvatarSize.Lg, presence = Presence.Speaking)
                    Avatar("Club", colour = personColour("c-club"), shape = AvatarShape.Rounded, size = AvatarSize.Lg, presence = Presence.Speaking)
                }
                Card {
                    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Lg)) {
                        Avatar("Noor Haddad", colour = personColour("u-noor"), presence = Presence.Speaking)
                        Avatar("Noor Haddad", colour = personColour("u-noor"), presence = Presence.Online)
                    }
                }
            }
            Section("Readable ink on every people colour") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                    Tokens.People.Colours.forEachIndexed { index, colour -> Avatar("P $index", colour = colour, size = AvatarSize.Sm) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                    listOf(0xFFFFFF, 0x000000, 0x777777, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0x808080).forEach {
                        Avatar("Mid Grey", colour = androidx.compose.ui.graphics.Color(0xFF000000 or it.toLong()), size = AvatarSize.Sm)
                    }
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
    Story("kit-badge") {
        Page {
            Section("Counts, accent and danger") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm), verticalAlignment = Alignment.CenterVertically) {
                    listOf(1, 9, 42, 99, 100, 12345).forEach { Badge("$it mentions", count = it) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm), verticalAlignment = Alignment.CenterVertically) {
                    listOf(1, 9, 42, 99, 100).forEach { Badge("$it mentions", count = it, tone = BadgeTone.Danger) }
                    Badge("new messages", dot = true)
                    Badge("new messages", dot = true, tone = BadgeTone.Danger)
                }
            }
            Section("On a card") {
                Card { Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) { Badge("3", count = 3); Badge("3", count = 3, tone = BadgeTone.Danger) } }
            }
        }
    },
    Story("kit-pill") {
        Page {
            PillTone.entries.forEach { tone ->
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm), verticalAlignment = Alignment.CenterVertically) {
                    Pill("You're here", tone = tone)
                    Pill("Live", tone = tone, dot = true)
                    Pill("Small", tone = tone, small = true)
                }
            }
            Pill("A pill with a label much too long to fit on the width of a phone screen at all")
        }
    },
    Story("kit-skeleton") {
        Page {
            Section("Text, one and three lines") {
                Skeleton(SkeletonShape.TextLines())
                Skeleton(SkeletonShape.TextLines(3))
            }
            Section("Circles and a block") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
                    AvatarSize.entries.forEach { Skeleton(SkeletonShape.Circle(it)) }
                }
                Skeleton(SkeletonShape.Rect(Tokens.Density.Touch.Control.Md))
            }
            Card { Skeleton(SkeletonShape.TextLines(2)) }
        }
    },
    Story("kit-avatar-stack") {
        val people = listOf("Priya Raman", "Sam Lee", "Noor Haddad", "Ivan Petrov", "Mae Chen").mapIndexed { i, n -> StackPerson("u-$i", n) }
        Page {
            Section("One, three, five (+2)") {
                AvatarStack(people.take(1))
                AvatarStack(people.take(3))
                AvatarStack(people)
            }
            Section("Speaking: first, middle, last") {
                AvatarStack(people.take(3).mapIndexed { i, p -> p.copy(speaking = i == 0) })
                AvatarStack(people.take(3).mapIndexed { i, p -> p.copy(speaking = i == 1) })
                AvatarStack(people.take(3).mapIndexed { i, p -> p.copy(speaking = i == 2) })
                AvatarStack(people.map { it.copy(speaking = true) }, max = 4, size = AvatarSize.Md)
            }
            Section("On a card") { Card { AvatarStack(people, size = AvatarSize.Xs) } }
        }
    },
    Story("kit-dock") {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.Md),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.Lg),
        ) {
            Dock("Communities", end = {
                DockDivider()
                IconButton(Icons.LayoutGrid, label = "All communities", onClick = none, variant = IconButtonVariant.Soft)
            }) {
                DockItem("Couch Co-op", "c-couch", none, newMessages = true)
                DockItem("Lumen Studio", "c-lumen", none, current = true, mentions = 1)
                DockItem("Trailheads", "c-trail", none, mentions = 120)
                DockItem("Synth Club", "c-synth", none)
            }
            Dock("Communities", end = {
                DockDivider()
                IconButton(Icons.LayoutGrid, label = "All communities", onClick = none, variant = IconButtonVariant.Soft)
            }) {
                (1..12).forEach { DockItem("Community $it", "c$it", none, current = it == 2, newMessages = it % 3 == 0) }
            }
            Dock("Communities", end = {
                IconButton(Icons.LayoutGrid, label = "All communities", onClick = none, variant = IconButtonVariant.Soft)
            }) {}
        }
    },
    Story("kit-sheet") {
        Column(Modifier.fillMaxWidth().padding(Tokens.Space.Md)) {
            Text("The screen under the sheet")
        }
        Sheet(open = true, onClose = none, title = "All communities") {
            ListRow("Lumen Studio", secondary = "1 mention", selected = true)
            ListRow("Trailheads", secondary = "New messages", unread = true)
            ListRow("Synth Club", secondary = "Quiet")
        }
    },
)
