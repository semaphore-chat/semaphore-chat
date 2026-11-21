// Semaphore Chat's Android screens. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.Alert
import app.semaphorechat.android.kit.AlertAction
import app.semaphorechat.android.kit.AlertSeverity
import app.semaphorechat.android.kit.Avatar
import app.semaphorechat.android.kit.AvatarShape
import app.semaphorechat.android.kit.AvatarSize
import app.semaphorechat.android.kit.AvatarStack
import app.semaphorechat.android.kit.Badge
import app.semaphorechat.android.kit.BadgeTone
import app.semaphorechat.android.kit.Button
import app.semaphorechat.android.kit.ButtonVariant
import app.semaphorechat.android.kit.Card
import app.semaphorechat.android.kit.Dock
import app.semaphorechat.android.kit.DockDivider
import app.semaphorechat.android.kit.DockItem
import app.semaphorechat.android.kit.Icon
import app.semaphorechat.android.kit.IconButton
import app.semaphorechat.android.kit.IconButtonVariant
import app.semaphorechat.android.kit.IconSize
import app.semaphorechat.android.kit.Island
import app.semaphorechat.android.kit.ListRow
import app.semaphorechat.android.kit.ListRowSize
import app.semaphorechat.android.kit.Sheet
import app.semaphorechat.android.kit.Skeleton
import app.semaphorechat.android.kit.SkeletonShape
import app.semaphorechat.android.kit.StackPerson
import app.semaphorechat.android.kit.SurfacePadding
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextField
import app.semaphorechat.android.kit.TextFieldShape
import app.semaphorechat.android.kit.TextFieldType
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant
import app.semaphorechat.android.kit.personColour
import app.semaphorechat.android.kit.talkingLine

/** The Lounge's texts, shared with the tests. */
object LoungeText {
    const val DOCK = "Communities"
    const val ALL = "All communities"
    const val CHANNELS = "Channels"
    const val VOICE = "Voice rooms"
    const val NO_COMMUNITIES = "You're not in any community yet. Create one, or join one with an invite link."
    const val NO_CHANNELS = "No channels yet. They show here once someone creates one."
    const val NO_TEXT_CHANNELS = "No text channels yet."
    const val CHANNELS_FAILED = "Couldn't load channels"
    const val COMMUNITIES_FAILED = "Couldn't load your communities"
    const val BACK = "Back to the community"
    const val FIND = "Find a community"
    const val NO_MATCH = "No community matches that."
}

private const val SKELETON_ROWS = 6
private const val DOCK_SKELETONS = 3

/** "clips, unread, 2 mentions": a channel row's accessible name, as the web's `trailingLabel`. */
fun channelRowLabel(channel: TextChannelItem): String = listOfNotNull(
    channel.name,
    if (channel.unread) "unread" else null,
    when {
        channel.mentions == 1 -> "1 mention"
        channel.mentions > 1 -> "${channel.mentions} mentions"
        else -> null
    },
).joinToString(", ")

/** The people line of a voice room card (the web's `VoiceRoomCard`). */
fun peopleLine(people: List<PersonItem>): String = when (people.size) {
    0 -> "Nobody here"
    1 -> "1 person here"
    else -> "${people.size} people here"
}

/** The communities the sheet's search keeps: a case-insensitive match anywhere in the name. */
fun filterCommunities(communities: List<CommunitySummary>, query: String): List<CommunitySummary> {
    val needle = query.trim()
    return if (needle.isEmpty()) communities else communities.filter { it.name.contains(needle, ignoreCase = true) }
}

/**
 * The phone Lounge (the web's ThreeIslands at phone width): one pane, the community home, above
 * the dock. With no communities, the pane says how to get one. The dock's "All" opens the
 * "All communities" sheet, which the system Back closes first.
 */
@Composable
fun LoungeScreen(
    communities: Load<List<CommunitySummary>>,
    home: CommunityHomeModel?,
    allOpen: Boolean,
    sheetQuery: String,
    onSheetQuery: (String) -> Unit,
    onOpenCommunity: (String) -> Unit,
    onOpenAll: () -> Unit,
    onCloseAll: () -> Unit,
    onOpenChannel: (String) -> Unit,
    onRetry: () -> Unit,
    onOpenWeb: () -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(Tokens.Space.Sm),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
        ) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                Pane(communities, home, onOpenChannel, onRetry, onOpenWeb)
            }
            CommunityDock(communities, home?.community?.id, onOpenCommunity, onOpenAll)
        }
        AllCommunitiesSheet(
            open = allOpen,
            communities = communities,
            current = home?.community?.id,
            query = sheetQuery,
            onQuery = onSheetQuery,
            onOpenCommunity = onOpenCommunity,
            onClose = onCloseAll,
        )
    }
}

@Composable
private fun Pane(
    communities: Load<List<CommunitySummary>>,
    home: CommunityHomeModel?,
    onOpenChannel: (String) -> Unit,
    onRetry: () -> Unit,
    onOpenWeb: () -> Unit,
) {
    Island(modifier = Modifier.fillMaxSize(), padding = SurfacePadding.Md) {
        when {
            home != null -> CommunityHome(home, onOpenChannel, onRetry)
            communities is Load.Failed -> Alert(
                AlertSeverity.Danger,
                title = LoungeText.COMMUNITIES_FAILED,
                message = communities.message,
                action = AlertAction("Try again", onRetry),
            )
            communities is Load.Ready && communities.value.isEmpty() -> NoCommunities(onOpenWeb)
            else -> Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md)) {
                Skeleton(SkeletonShape.Rect(Tokens.Avatar.Lg + Tokens.Space.Lg * 2))
                repeat(SKELETON_ROWS) { Skeleton(SkeletonShape.TextLines()) }
            }
        }
    }
}

@Composable
private fun NoCommunities(onOpenWeb: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Md, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("No communities yet", variant = TextVariant.Title, heading = true)
        Text(LoungeText.NO_COMMUNITIES, tone = TextTone.Secondary)
        Text("Creating and joining communities is on the web for now.", variant = TextVariant.Meta, tone = TextTone.Dim)
        Button("Open on the web", onClick = onOpenWeb, startIcon = Icons.ExternalLink)
    }
}

/** The web's `CommunityLeft` on a phone: the header card, "Channels", then "Voice rooms". */
@Composable
private fun CommunityHome(home: CommunityHomeModel, onOpenChannel: (String) -> Unit, onRetry: () -> Unit) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
        item(key = "header") {
            Card(modifier = Modifier.padding(bottom = Tokens.Space.Sm)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Md),
                ) {
                    Avatar(
                        home.community.name,
                        colour = personColour(home.community.id),
                        size = AvatarSize.Lg,
                        shape = AvatarShape.Rounded,
                        decorative = true,
                    )
                    Text(home.community.name, variant = TextVariant.Title, heading = true, truncate = true)
                }
            }
        }
        sectionTitle(LoungeText.CHANNELS)
        when (val channels = home.channels) {
            Load.Loading -> items(SKELETON_ROWS) { Skeleton(SkeletonShape.TextLines(), Modifier.padding(Tokens.Space.Sm)) }
            is Load.Failed -> item(key = "failed") {
                Alert(
                    AlertSeverity.Danger,
                    title = LoungeText.CHANNELS_FAILED,
                    message = channels.message,
                    action = AlertAction("Try again", onRetry),
                )
            }
            is Load.Ready -> {
                val (text, voice) = channels.value
                if (text.isEmpty()) {
                    item(key = "empty") {
                        Text(
                            if (voice.isEmpty()) LoungeText.NO_CHANNELS else LoungeText.NO_TEXT_CHANNELS,
                            tone = TextTone.Secondary,
                            modifier = Modifier.padding(Tokens.Space.Sm),
                        )
                    }
                }
                items(text, key = { "c-${it.id}" }) { channel -> ChannelRow(channel, onOpenChannel) }
                if (voice.isNotEmpty()) {
                    sectionTitle(LoungeText.VOICE)
                    items(voice, key = { "v-${it.id}" }) { room -> VoiceRoomCard(room) }
                }
            }
        }
    }
}

private fun LazyListScope.sectionTitle(title: String) {
    item(key = "section-$title") {
        Box(Modifier.padding(start = Tokens.Space.Sm, top = Tokens.Space.Sm, bottom = Tokens.Space.Xs).semantics { heading() }) {
            Text(title, variant = TextVariant.Section, tone = TextTone.Secondary)
        }
    }
}

@Composable
private fun ChannelRow(channel: TextChannelItem, onOpenChannel: (String) -> Unit) {
    val icon = when (channel.icon) {
        ChannelIcon.Hash -> Icons.Hash
        ChannelIcon.Lock -> Icons.Lock
        ChannelIcon.Megaphone -> Icons.Megaphone
    }
    ListRow(
            channel.name,
            leading = { Icon(icon, size = IconSize.Md) },
            trailing = if (channel.mentions > 0) {
                { Badge(label = mentionLabel(channel.mentions), count = channel.mentions, tone = BadgeTone.Accent) }
            } else {
                null
            },
            unread = channel.unread || channel.mentions > 0,
            onClick = { onOpenChannel(channel.id) },
        )
}

private fun mentionLabel(count: Int) = if (count == 1) "1 mention" else "$count mentions"

/** A voice room on the community home (the web's `VoiceRoomCard`, without Join until voice). */
@Composable
private fun VoiceRoomCard(room: VoiceRoomItem) {
    Card(modifier = Modifier.padding(vertical = Tokens.Space.Xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
            Icon(Icons.Volume2, size = IconSize.Md)
            Box(Modifier.weight(1f)) { Text(room.name, variant = TextVariant.Name, truncate = true) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm)) {
            AvatarStack(room.people.map { StackPerson(it.id, it.name, it.speaking) })
            Text(peopleLine(room.people), variant = TextVariant.Meta, tone = TextTone.Secondary)
        }
        val talking = room.people.filter { it.speaking }.map { it.name }
        if (talking.isNotEmpty()) {
            Text("Talking: ${talkingLine(talking)}", variant = TextVariant.Meta, tone = TextTone.Accent, truncate = true)
        }
    }
}

/** The dock as the phone's bottom bar: the communities, then "All". */
@Composable
private fun CommunityDock(
    communities: Load<List<CommunitySummary>>,
    current: String?,
    onOpenCommunity: (String) -> Unit,
    onOpenAll: () -> Unit,
) {
    val shown = (communities as? Load.Ready)?.value.orEmpty()
    val hasItems = shown.isNotEmpty() || communities == Load.Loading
    Dock(
        label = LoungeText.DOCK,
        end = {
            if (hasItems) DockDivider()
            IconButton(Icons.LayoutGrid, label = LoungeText.ALL, onClick = onOpenAll, variant = IconButtonVariant.Soft)
        },
    ) {
        if (communities == Load.Loading) {
            repeat(DOCK_SKELETONS) {
                Box(Modifier.padding(Tokens.Space.Xs)) { Skeleton(SkeletonShape.Circle(AvatarSize.Md)) }
            }
        }
        shown.forEach { community ->
            DockItem(
                name = community.name,
                colourId = community.id,
                current = community.id == current,
                mentions = community.mentions,
                newMessages = community.unread,
                onClick = { onOpenCommunity(community.id) },
            )
        }
    }
}

/** The web's `AllCommunitiesSheet`: find, then every community with its state line. */
@Composable
private fun AllCommunitiesSheet(
    open: Boolean,
    communities: Load<List<CommunitySummary>>,
    current: String?,
    query: String,
    onQuery: (String) -> Unit,
    onOpenCommunity: (String) -> Unit,
    onClose: () -> Unit,
) {
    Sheet(open = open, onClose = onClose, title = LoungeText.ALL) {
        val all = (communities as? Load.Ready)?.value
        when {
            all == null && communities is Load.Failed -> Alert(AlertSeverity.Danger, communities.message)
            all == null -> repeat(DOCK_SKELETONS) { Skeleton(SkeletonShape.TextLines()) }
            all.isEmpty() -> Text(LoungeText.NO_COMMUNITIES, tone = TextTone.Secondary)
            else -> {
                TextField(
                    query,
                    onQuery,
                    label = LoungeText.FIND,
                    labelHidden = true,
                    placeholder = LoungeText.FIND,
                    shape = TextFieldShape.Round,
                    type = TextFieldType.Search,
                    startIcon = Icons.Search,
                )
                val shown = filterCommunities(all, query)
                if (shown.isEmpty()) {
                    Text(LoungeText.NO_MATCH, tone = TextTone.Secondary)
                }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                    items(shown, key = { it.id }) { community ->
                        ListRow(
                            community.name,
                            secondary = communityStateLine(community),
                            size = ListRowSize.Lg,
                            selected = community.id == current,
                            unread = community.unread || community.mentions > 0,
                            leading = {
                                Avatar(
                                    community.name,
                                    colour = personColour(community.id),
                                    shape = AvatarShape.Rounded,
                                    decorative = true,
                                )
                            },
                            trailing = if (community.mentions > 0) {
                                {
                                    Badge(
                                        label = mentionLabel(community.mentions),
                                        count = community.mentions,
                                        tone = BadgeTone.Danger,
                                    )
                                }
                            } else {
                                null
                            },
                            onClick = {
                                onOpenCommunity(community.id)
                                onClose()
                            },
                        )
                    }
                }
            }
        }
    }
}

/**
 * A channel, on a phone (the web's phone chat route): its header with Back to the community.
 * The messages come with D6; this is the route and the Back for now.
 */
@Composable
fun ChannelScreen(name: String, communityName: String, onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(Tokens.Space.Sm),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
    ) {
        Island(modifier = Modifier.fillMaxSize(), padding = SurfacePadding.Md) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
                IconButton(Icons.ArrowLeft, label = LoungeText.BACK, onClick = onBack)
                Icon(Icons.Hash, size = IconSize.Md)
                Column(Modifier.weight(1f)) {
                    Text(name, variant = TextVariant.Name, heading = true, truncate = true)
                    Text(communityName, variant = TextVariant.Meta, tone = TextTone.Secondary, truncate = true)
                }
            }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Messages come in the next update.", tone = TextTone.Secondary)
            }
        }
    }
}
