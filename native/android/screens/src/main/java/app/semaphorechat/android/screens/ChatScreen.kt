// Semaphore Chat's Android screens. Copyright (C) 2026 the Semaphore Chat authors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU Affero General Public License, version 3, as published by the Free Software Foundation. It
// is distributed without any warranty. See LICENSE.md at the repository root.

package app.semaphorechat.android.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.TextFieldValue
import app.semaphorechat.android.design.Icons
import app.semaphorechat.android.design.Tokens
import app.semaphorechat.android.kit.AvatarSize
import app.semaphorechat.android.kit.Button
import app.semaphorechat.android.kit.ButtonSize
import app.semaphorechat.android.kit.Icon
import app.semaphorechat.android.kit.IconButton
import app.semaphorechat.android.kit.IconSize
import app.semaphorechat.android.kit.Island
import app.semaphorechat.android.kit.Skeleton
import app.semaphorechat.android.kit.SkeletonShape
import app.semaphorechat.android.kit.Spinner
import app.semaphorechat.android.kit.SpinnerSize
import app.semaphorechat.android.kit.SurfacePadding
import app.semaphorechat.android.kit.Text
import app.semaphorechat.android.kit.TextTone
import app.semaphorechat.android.kit.TextVariant
import app.semaphorechat.android.kit.chat.ComposerField
import app.semaphorechat.android.kit.chat.ComposerNotice
import app.semaphorechat.android.kit.chat.ComposerText
import app.semaphorechat.android.kit.chat.DayDivider
import app.semaphorechat.android.kit.chat.SuggestionItem
import app.semaphorechat.android.kit.chat.SuggestionList
import app.semaphorechat.android.kit.chat.SuggestionLook
import app.semaphorechat.android.kit.chat.JumpToLatest
import app.semaphorechat.android.kit.chat.MentionTarget
import app.semaphorechat.android.kit.chat.MessageQuoteItem
import app.semaphorechat.android.kit.chat.MessageRow
import app.semaphorechat.android.kit.chat.RowState
import app.semaphorechat.android.kit.chat.TypingLine
import app.semaphorechat.android.kit.chat.FileTile
import app.semaphorechat.android.kit.chat.MediaTile
import app.semaphorechat.android.kit.chat.UploadTile
import app.semaphorechat.android.kit.ListRow
import app.semaphorechat.android.kit.Sheet
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.width
import kotlinx.coroutines.launch

/** The chat screen's texts, shared with the tests. */
object ChatText {
    const val LOADING = "Loading messages"
    const val EMPTY_TITLE = "No messages yet."
    const val EMPTY_LINE = "Start the conversation!"
    const val FAILED = "Couldn't load messages"
    const val OLDER_FAILED = "Couldn't load older messages"
    const val TRY_AGAIN = "Try again"
    const val RECONNECTING = "Reconnecting…"
    const val OFFLINE = "You're offline. New messages arrive once you're back."
    const val LIST_TAG = "chat-list"
    const val ATTACH_TITLE = "Attach"
    const val ATTACH_MEDIA = "Photos and videos"
    const val ATTACH_FILES = "Files"
    fun start(name: String) = "This is the start of #$name."
}

/** A picked file's tile in the composer's tray. */
private val TRAY_TILE = 220.dp

/** Rows from the oldest loaded at which older ones are fetched, and from the newest for newer. */
private const val PAGE_AHEAD = 10

/** What the chat screen asks of the app. */
class ChatActions(
    val onBack: () -> Unit = {},
    /** "Try again" after the first page failed. */
    val onRetry: () -> Unit = {},
    val onLoadOlder: () -> Unit = {},
    val onLoadNewer: () -> Unit = {},
    val onJump: () -> Unit = {},
    /** The reader scrolled away from the newest row (`true`), or back to it. */
    val onAwayChanged: (Boolean) -> Unit = {},
    /** The newest row is on screen, at the live edge: it may be marked read. */
    val onSeenNewest: () -> Unit = {},
    /** A link was tapped: its checked address (`check_link`'s, never the text it was written as). */
    val onOpenLink: (String) -> Unit = {},
    val onOpenChannel: (String) -> Unit = {},
    /** The composer's text or caret changed. */
    val onDraftChange: (TextFieldValue) -> Unit = {},
    val onSend: () -> Unit = {},
    val onPickMention: (MentionSuggestion) -> Unit = {},
    /** Retry of a failed send, by its client nonce. */
    val onRetrySend: (String) -> Unit = {},
    /** Delete of a failed send, by its client nonce. */
    val onDiscardSend: (String) -> Unit = {},
    /** Pick photos and videos (the system photo picker). */
    val onAttachMedia: () -> Unit = {},
    /** Pick any files (the system's document picker). */
    val onAttachFiles: () -> Unit = {},
    /** Remove a picked file from the composer, by its place in the tray. */
    val onRemoveFile: (Int) -> Unit = {},
    /** Open a sent file in another app. */
    val onOpenAttachment: (AttachmentModel) -> Unit = {},
    /** Retry a failed upload: the send's client nonce and core's upload id. */
    val onRetryUpload: (String, ULong) -> Unit = { _, _ -> },
    /** Remove an upload from its message: the send's client nonce and core's upload id. */
    val onRemoveUpload: (String, ULong) -> Unit = { _, _ -> },
)

/**
 * A text channel on a phone (the web Lounge's `ChannelChat` at phone width): the header with Back,
 * the connection line, the message list or why there is none, "Jump to latest", the typing
 * line and the composer (or the line saying why the reader can't post). The screen follows the
 * keyboard: `safeDrawingPadding` includes the IME's inset (the activity resizes for it). The list
 * is newest at the bottom ([LazyColumn] with `reverseLayout`), keyed by core's row `seq`, so older pages land above what is read without moving it, and new messages land below.
 */
@Composable
fun ChatScreen(
    header: ChatHeaderModel,
    chat: ChatModel,
    format: ChatFormat,
    actions: ChatActions,
    listState: LazyListState = rememberLazyListState(),
    draft: TextFieldValue = TextFieldValue(),
    composer: ComposerModel = ComposerModel(),
    attaching: Boolean = false,
    onAttachingChange: (Boolean) -> Unit = {},
) {
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(Tokens.Space.Sm)) {
        Island(modifier = Modifier.fillMaxSize(), padding = SurfacePadding.None) {
            ChatHeader(header, actions.onBack)
            ConnectionLine(chat.connection)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (val face = chat.face) {
                    ChatFace.Loading -> LoadingRows()
                    is ChatFace.Failed -> StateMessage(ChatText.FAILED, face.message) {
                        Button(ChatText.TRY_AGAIN, onClick = actions.onRetry)
                    }
                    ChatFace.Ready -> if (chat.messages.isEmpty()) {
                        StateMessage(ChatText.EMPTY_TITLE, ChatText.EMPTY_LINE)
                    } else {
                        ChatList(header.name, chat, format, actions, listState)
                    }
                }
            }
            TypingLine(chat.typing)
            val scope = rememberCoroutineScope()
            // Sending needs the list loaded: the pending row is what carries the text once sent.
            ComposerArea(header.name, draft, composer, actions, ready = chat.face == ChatFace.Ready, onAttach = { onAttachingChange(true) }) {
                actions.onSend()
                // What was sent lands at the bottom: go there, as Discord does. From history the
                // store brings the newest rows back before it sends.
                scope.launch { listState.scrollToItem(0) }
            }
        }
    }
    AttachSheet(attaching, onClose = { onAttachingChange(false) }, actions)
    }
}

/** What to attach: photos and videos through the photo picker, or any file. */
@Composable
private fun AttachSheet(open: Boolean, onClose: () -> Unit, actions: ChatActions) {
    Sheet(open = open, onClose = onClose, title = ChatText.ATTACH_TITLE) {
        ListRow(ChatText.ATTACH_MEDIA, leading = { Icon(Icons.Image, size = IconSize.Md) }, onClick = {
            onClose()
            actions.onAttachMedia()
        })
        ListRow(ChatText.ATTACH_FILES, leading = { Icon(Icons.Paperclip, size = IconSize.Md) }, onClick = {
            onClose()
            actions.onAttachFiles()
        })
    }
}

@Composable
private fun ComposerArea(
    channel: String,
    draft: TextFieldValue,
    composer: ComposerModel,
    actions: ChatActions,
    ready: Boolean,
    onAttach: () -> Unit,
    onSend: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(start = Tokens.Space.Sm, end = Tokens.Space.Sm, bottom = Tokens.Space.Sm),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
    ) {
        when (val access = composer.access) {
            is ComposerAccess.Blocked -> ComposerNotice(
                access.text,
                when (access.kind) {
                    BlockedKind.NoPermission -> Icons.Lock
                    BlockedKind.ReadOnly -> Icons.Megaphone
                    BlockedKind.TimedOut -> Icons.Info
                },
                reason = access.reason,
            )
            ComposerAccess.Open -> {
                val suggestions = composer.suggestions
                SuggestionList(
                    heading = suggestionHeading(suggestions),
                    items = suggestions.map { suggestion ->
                        SuggestionItem(
                            label = suggestion.label,
                            detail = suggestion.insertText.takeIf { suggestion.kind == SuggestionKind.User },
                            look = when (suggestion.kind) {
                                SuggestionKind.User -> SuggestionLook.Person(suggestion.id)
                                SuggestionKind.Channel -> SuggestionLook.Channel
                                else -> SuggestionLook.Group
                            },
                        )
                    },
                    shown = ComposerCaps.SUGGESTIONS_SHOWN,
                    onPick = { index -> suggestions.getOrNull(index)?.let(actions.onPickMention) },
                    // Measured after the field: with the keyboard up the list gets only what is
                    // left, and never squeezes the field and Send.
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (composer.files.isNotEmpty()) {
                    // A row that scrolls sideways: ten files never push the field off the screen.
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
                    ) {
                        composer.files.forEachIndexed { index, file ->
                            UploadTile(file.name, fileSizeText(file.sizeBytes), Modifier.width(TRAY_TILE), onRemove = { actions.onRemoveFile(index) })
                        }
                    }
                }
                composer.fileProblem?.let {
                    Text(it, variant = TextVariant.Small, tone = TextTone.Danger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
                ComposerField(
                    value = draft,
                    onValueChange = actions.onDraftChange,
                    placeholder = ComposerText.placeholder(channel),
                    // The keyboard is up when it takes room at the bottom (`isImeVisible` reads true
                    // where no insets are dispatched at all, as under Robolectric).
                    maxLines = if (WindowInsets.ime.getBottom(LocalDensity.current) > 0) ComposerCaps.KEYBOARD_ROWS else ComposerCaps.PHONE_ROWS,
                    canSend = ready && (draft.text.isNotBlank() || composer.files.isNotEmpty()),
                    onSend = onSend,
                    onAttach = onAttach.takeIf { composer.canAttach },
                )
            }
        }
    }
}

@Composable
private fun ChatHeader(header: ChatHeaderModel, onBack: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(Tokens.Space.Sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Xs),
    ) {
        IconButton(Icons.ArrowLeft, label = LoungeText.BACK, onClick = onBack)
        Icon(
            when (header.icon) {
                ChannelIcon.Hash -> Icons.Hash
                ChannelIcon.Lock -> Icons.Lock
                ChannelIcon.Megaphone -> Icons.Megaphone
            },
            size = IconSize.Md,
        )
        Column(Modifier.weight(1f)) {
            Text(header.name, variant = TextVariant.Name, heading = true, truncate = true)
            if (header.community.isNotEmpty()) {
                Text(header.community, variant = TextVariant.Meta, tone = TextTone.Secondary, truncate = true)
            }
        }
    }
}

@Composable
private fun ConnectionLine(connection: ChatConnection) {
    val text = when (connection) {
        ChatConnection.Live -> return
        ChatConnection.Reconnecting -> ChatText.RECONNECTING
        ChatConnection.Offline -> ChatText.OFFLINE
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.Md, vertical = Tokens.Space.Xs)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
    ) {
        if (connection == ChatConnection.Reconnecting) Spinner(size = SpinnerSize.Sm) else Icon(Icons.Info, size = IconSize.Sm)
        Text(text, variant = TextVariant.Small, tone = TextTone.Secondary)
    }
}

@Composable
private fun LoadingRows() {
    Column(
        Modifier.fillMaxSize().padding(Tokens.Space.Md),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Lg),
    ) {
        Text(ChatText.LOADING, variant = TextVariant.Small, tone = TextTone.Secondary)
        repeat(6) { index ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.Md)) {
                Skeleton(SkeletonShape.Circle(AvatarSize.Md))
                Skeleton(SkeletonShape.TextLines(if (index % 2 == 0) 2 else 1), Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun StateMessage(title: String, line: String?, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxSize().padding(Tokens.Space.Lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm, Alignment.Bottom),
    ) {
        Text(title, variant = TextVariant.Title, heading = true)
        line?.let { Text(it, tone = TextTone.Secondary) }
        action?.invoke()
    }
}

@Composable
private fun ChatList(
    name: String,
    chat: ChatModel,
    format: ChatFormat,
    actions: ChatActions,
    listState: LazyListState,
) {
    val entries = remember(chat.messages, format) { chatEntries(chat.messages, format).asReversed() }
    val scope = rememberCoroutineScope()

    // Read at composition, before the new rows are laid out: was the newest row on screen?
    val newest = chat.messages.lastOrNull()?.key
    val pinned = remember(newest, listState) { listState.firstVisibleItemIndex == 0 }
    LaunchedEffect(newest) {
        // A new row below one the reader was at: follow it. Scrolled up, the row they read stays put.
        if (pinned && chat.atLiveEdge) listState.scrollToItem(0)
    }

    // Everything read from the list is keyed on it, and every effect on the actions: one call site
    // shows one channel, then another (a #mention, then Back), each with its own list and actions.
    val away by remember(listState) { derivedStateOf { listState.firstVisibleItemIndex > 0 } }
    LaunchedEffect(away, actions) { actions.onAwayChanged(away) }
    LaunchedEffect(newest, away, chat.atLiveEdge, actions) {
        if (!away && chat.atLiveEdge) actions.onSeenNewest()
    }

    val nearTop by remember(listState) {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            info.totalItemsCount > 0 && last >= info.totalItemsCount - PAGE_AHEAD
        }
    }
    LaunchedEffect(nearTop, chat.messages.size, chat.atStart, chat.loadingOlder, chat.olderFailed, actions) {
        if (nearTop && !chat.atStart && !chat.loadingOlder && chat.olderFailed == null) actions.onLoadOlder()
    }
    val nearBottom by remember(listState) { derivedStateOf { listState.firstVisibleItemIndex < PAGE_AHEAD } }
    LaunchedEffect(nearBottom, chat.messages.size, chat.atLiveEdge, actions) {
        if (nearBottom && !chat.atLiveEdge) actions.onLoadNewer()
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier = Modifier.fillMaxSize().testTag(ChatText.LIST_TAG),
            contentPadding = PaddingValues(vertical = Tokens.Space.Sm),
        ) {
            items(entries, key = { it.key }, contentType = { it::class }) { entry ->
                when (entry) {
                    is ChatEntry.Day -> DayDivider(entry.label)
                    is ChatEntry.Message -> MessageItem(entry, format, actions)
                }
            }
            item(key = "top", contentType = "top") { ListTop(name, chat, actions.onLoadOlder) }
        }
        chat.jump?.let { jump ->
            JumpToLatest(
                jump.text,
                jump.name,
                jump.counted,
                onJump = {
                    actions.onJump()
                    scope.launch { listState.scrollToItem(0) }
                },
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = Tokens.Space.Sm),
            )
        }
    }
}

@Composable
private fun MessageItem(entry: ChatEntry.Message, format: ChatFormat, actions: ChatActions) {
    val message = entry.message
    MessageRow(
        author = message.author,
        authorColourId = message.authorId,
        time = format.time(message.sentAtMs),
        pieces = message.pieces,
        continued = entry.continued,
        mentioned = message.mentionsMe,
        edited = message.edited,
        removed = message.removed,
        state = when (val state = message.state) {
            MessageState.Sent -> RowState.Sent
            MessageState.Pending -> RowState.Pending
            is MessageState.Failed -> RowState.Failed(state.reason, state.retrying)
        },
        quote = message.replyTo?.let { MessageQuoteItem(it.author, it.text, it.deleted) },
        replyCount = message.replyCount,
        extras = message.extras,
        attachments = if (message.attachments.isEmpty() && message.uploads.isEmpty()) null else {
            { Attachments(message, actions) }
        },
        onLink = actions.onOpenLink,
        onMention = { target -> if (target is MentionTarget.Channel) actions.onOpenChannel(target.id) },
        onRetry = message.clientNonce?.takeIf { message.state is MessageState.Failed }?.let { nonce -> { actions.onRetrySend(nonce) } },
        onDelete = message.clientNonce?.takeIf { message.state is MessageState.Failed }?.let { nonce -> { actions.onDiscardSend(nonce) } },
    )
}

/** A message's files: what was sent, then what is still on its way, each with its own actions. */
@Composable
private fun Attachments(message: ChatMessage, actions: ChatActions) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.Xs)) {
        message.attachments.forEach { file ->
            val open = { actions.onOpenAttachment(file) }
            val size = fileSizeText(file.sizeBytes)
            when (file.look) {
                AttachmentLook.File -> FileTile(file.name, size, if (file.mimeType.startsWith("audio/")) Icons.Music else Icons.Paperclip, open)
                else -> MediaTile(
                    file.fileId,
                    file.name,
                    size,
                    file.boxWidth.dp,
                    file.boxHeight.dp,
                    video = file.look == AttachmentLook.Video,
                    // The row draws the small copy when there is one; opening fetches the file.
                    thumbnail = file.thumbnail,
                    onOpen = open,
                    sizeBytes = file.sizeBytes,
                )
            }
        }
        val nonce = message.clientNonce
        message.uploads.forEach { upload ->
            UploadTile(
                upload.name,
                fileSizeText(upload.sizeBytes),
                progress = if (upload.sizeBytes > 0) upload.sentBytes.toFloat() / upload.sizeBytes else 0f,
                failed = upload.failed,
                onRetry = nonce?.let { { actions.onRetryUpload(it, upload.id) } },
                onRemove = nonce?.let { { actions.onRemoveUpload(it, upload.id) } },
            )
        }
    }
}

/** The top of the list: the conversation's start, older rows on their way, or why they aren't. */
@Composable
private fun ListTop(name: String, chat: ChatModel, onLoadOlder: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(Tokens.Space.Md),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.Sm),
        horizontalAlignment = if (chat.atStart) Alignment.Start else Alignment.CenterHorizontally,
    ) {
        when {
            chat.atStart -> Text(ChatText.start(name), variant = TextVariant.Title, heading = true)
            chat.olderFailed != null -> {
                Text(ChatText.OLDER_FAILED, variant = TextVariant.Small, tone = TextTone.Secondary)
                Button(ChatText.TRY_AGAIN, onClick = onLoadOlder, size = ButtonSize.Sm)
            }
            else -> Spinner(size = SpinnerSize.Md, label = ChatText.LOADING)
        }
    }
}
