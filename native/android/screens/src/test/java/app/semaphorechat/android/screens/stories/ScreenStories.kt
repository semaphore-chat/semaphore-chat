// Semaphore Chat's Android screens. SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.

package app.semaphorechat.android.screens.stories

import androidx.compose.runtime.Composable
import app.semaphorechat.android.kit.stories.Story
import app.semaphorechat.android.screens.ChannelIcon
import app.semaphorechat.android.screens.ChannelScreen
import app.semaphorechat.android.screens.CommunityChannels
import app.semaphorechat.android.screens.CommunityHomeModel
import app.semaphorechat.android.screens.CommunitySummary
import app.semaphorechat.android.screens.ConnectFailure
import app.semaphorechat.android.screens.ConnectScreen
import app.semaphorechat.android.screens.ConnectState
import app.semaphorechat.android.screens.Load
import app.semaphorechat.android.screens.LoungeScreen
import app.semaphorechat.android.screens.PersonItem
import app.semaphorechat.android.screens.ServerSummary
import app.semaphorechat.android.screens.SignInScreen
import app.semaphorechat.android.screens.SignInState
import app.semaphorechat.android.screens.SERVER_ERROR_FALLBACK
import app.semaphorechat.android.screens.StartScreen
import app.semaphorechat.android.screens.StartState
import app.semaphorechat.android.screens.TextChannelItem
import app.semaphorechat.android.screens.VoiceRoomItem

private val none: () -> Unit = {}
private val ignore: (String) -> Unit = {}

private val SERVER = ServerSummary("https://chat.lumen.studio", "Lumen Studio", canRegister = true, passwordReset = true)
private val PLAIN_SERVER = ServerSummary("http://192.168.1.20:3000", null, canRegister = false, passwordReset = false)

private val COMMUNITIES = listOf(
    CommunitySummary("c-couch", "Couch Co-op", unread = true),
    CommunitySummary("c-lumen", "Lumen Studio", mentions = 1, unread = true),
    CommunitySummary("c-trail", "Trailheads", unread = true),
    CommunitySummary("c-synth", "Synth Club"),
)

private val LUMEN_CHANNELS = CommunityChannels(
    text = listOf(
        TextChannelItem("ch-announcements", "announcements", ChannelIcon.Megaphone, unread = true),
        TextChannelItem("ch-general", "general", unread = true),
        TextChannelItem("ch-dev", "dev"),
        TextChannelItem("ch-design", "design", unread = true, mentions = 1),
        TextChannelItem("ch-leads", "leads", ChannelIcon.Lock),
        TextChannelItem("ch-random", "random", mentions = 120),
    ),
    voice = listOf(
        VoiceRoomItem(
            "vc-lounge",
            "Lounge",
            listOf(
                PersonItem("u-priya", "Priya", speaking = true),
                PersonItem("u-sam", "Sam"),
                PersonItem("u-noor", "Noor", speaking = true),
                PersonItem("u-ivan", "Ivan"),
                PersonItem("u-mae", "Mae"),
            ),
        ),
        VoiceRoomItem("vc-standup", "Standup"),
    ),
)

private val LUMEN = COMMUNITIES[1]

@Composable
private fun Connect(state: ConnectState) = ConnectScreen(state, ignore, none, none, ignore)

@Composable
private fun SignIn(state: SignInState) = SignInScreen(state, ignore, ignore, none, none, ignore)

@Composable
private fun Lounge(
    communities: Load<List<CommunitySummary>> = Load.Ready(COMMUNITIES),
    home: CommunityHomeModel? = CommunityHomeModel(LUMEN, Load.Ready(LUMEN_CHANNELS)),
    allOpen: Boolean = false,
    query: String = "",
) = LoungeScreen(communities, home, allOpen, query, ignore, ignore, none, none, ignore, none, none)

private const val LONG = "The Extremely Long Community Name That Never Ends, Really"

/** Every screen state: `screen-<screen>-<state>`. */
val SCREEN_STORIES: List<Story> = listOf(
    Story("screen-connect") { Connect(ConnectState()) },
    Story("screen-connect-probing") { Connect(ConnectState(url = "chat.lumen.studio", probing = true)) },
    Story("screen-connect-invalid") { Connect(ConnectState(url = "not a url", failure = ConnectFailure.Invalid)) },
    Story("screen-connect-unreachable") {
        Connect(ConnectState(url = "chat.lumen.stduio", failure = ConnectFailure.Unreachable))
    },
    Story("screen-connect-tls") { Connect(ConnectState(url = "192.168.1.20", failure = ConnectFailure.TlsRefused)) },
    Story("screen-connect-not-semaphore") {
        Connect(ConnectState(url = "example.com", failure = ConnectFailure.NotSemaphore))
    },
    Story("screen-connect-needs-setup") {
        Connect(ConnectState(url = "new.lumen.studio", failure = ConnectFailure.NeedsSetup("https://new.lumen.studio")))
    },
    Story("screen-connect-failed") {
        Connect(ConnectState(url = "chat.lumen.studio", failure = ConnectFailure.Failed("Service Unavailable (503)")))
    },
    Story("screen-connect-insecure") {
        Connect(ConnectState(url = "http://192.168.1.20:3000", insecure = PLAIN_SERVER))
    },
    Story("screen-connect-session-ended") {
        Connect(ConnectState(url = "https://chat.lumen.studio", notice = "Your session ended. Sign in again."))
    },
    Story("screen-sign-in") { SignIn(SignInState(SERVER)) },
    Story("screen-sign-in-filled") { SignIn(SignInState(SERVER, username = "alexk", password = "hunter2")) },
    Story("screen-sign-in-busy") { SignIn(SignInState(SERVER, username = "alexk", password = "hunter2", busy = true)) },
    Story("screen-sign-in-error") {
        SignIn(SignInState(SERVER, username = "alexk", error = "Invalid username or password"))
    },
    Story("screen-sign-in-session-ended") {
        SignIn(SignInState(SERVER, username = "alexk", notice = "Your session ended. Sign in again."))
    },
    Story("screen-sign-in-insecure") { SignIn(SignInState(PLAIN_SERVER)) },
    Story("screen-sign-in-long-name") {
        SignIn(SignInState(SERVER.copy(name = LONG, url = "https://a-very-long-subdomain.of-a-long-domain.example.com")))
    },
    Story("screen-start") { StartScreen(StartState.Starting, none, none) },
    Story("screen-start-restoring") { StartScreen(StartState.Restoring("https://chat.lumen.studio"), none, none) },
    Story("screen-start-unreachable") {
        StartScreen(
            StartState.Unreachable("https://chat.lumen.studio", "CLIENT_UNREACHABLE", "Can't reach the server."),
            none,
            none,
        )
    },
    Story("screen-start-tls-refused") {
        StartScreen(
            StartState.Unreachable("https://chat.lumen.studio", "CLIENT_TLS", "This device doesn't trust the server's certificate."),
            none,
            none,
        )
    },
    Story("screen-start-server-error") {
        StartScreen(
            StartState.Unreachable("https://chat.lumen.studio", "UNKNOWN", SERVER_ERROR_FALLBACK),
            none,
            none,
        )
    },
    Story("screen-start-failed") { StartScreen(StartState.StartFailed("the secret store could not be read"), none, none) },
    Story("screen-lounge") { Lounge() },
    Story("screen-lounge-loading") { Lounge(communities = Load.Loading, home = null) },
    Story("screen-lounge-error") { Lounge(communities = Load.Failed("Service Unavailable (503)"), home = null) },
    Story("screen-lounge-no-communities") { Lounge(communities = Load.Ready(emptyList()), home = null) },
    Story("screen-lounge-channels-loading") { Lounge(home = CommunityHomeModel(LUMEN, Load.Loading)) },
    Story("screen-lounge-channels-error") {
        Lounge(home = CommunityHomeModel(LUMEN, Load.Failed("Internal Server Error (500)")))
    },
    Story("screen-lounge-no-channels") {
        Lounge(home = CommunityHomeModel(LUMEN, Load.Ready(CommunityChannels(emptyList(), emptyList()))))
    },
    Story("screen-lounge-voice-only") {
        Lounge(home = CommunityHomeModel(LUMEN, Load.Ready(CommunityChannels(emptyList(), LUMEN_CHANNELS.voice))))
    },
    Story("screen-lounge-long-names") {
        val long = CommunitySummary("c-long", LONG, mentions = 3)
        Lounge(
            communities = Load.Ready(listOf(long) + COMMUNITIES),
            home = CommunityHomeModel(
                long,
                Load.Ready(
                    CommunityChannels(
                        text = listOf(
                            TextChannelItem("a", "a-channel-name-that-goes-on-and-on-and-on-past-the-edge", unread = true, mentions = 3),
                            TextChannelItem("b", "another-quite-long-channel-name-for-wrapping"),
                        ),
                        voice = listOf(VoiceRoomItem("v", "A voice room with a name too long to fit on a phone", listOf(PersonItem("p", "Priya")))),
                    ),
                ),
            ),
        )
    },
    Story("screen-lounge-many-channels") {
        Lounge(
            home = CommunityHomeModel(
                LUMEN,
                Load.Ready(
                    CommunityChannels(
                        text = (1..40).map { TextChannelItem("t$it", "channel-$it", unread = it % 3 == 0, mentions = if (it % 7 == 0) it else 0) },
                        voice = LUMEN_CHANNELS.voice,
                    ),
                ),
            ),
        )
    },
    Story("screen-lounge-many-communities") {
        val many = (1..12).map { CommunitySummary("c$it", "Community $it", mentions = if (it == 4) 7 else 0, unread = it % 2 == 0) }
        Lounge(communities = Load.Ready(many), home = CommunityHomeModel(many[3], Load.Ready(LUMEN_CHANNELS)))
    },
    Story("screen-lounge-sheet") { Lounge(allOpen = true) },
    Story("screen-lounge-sheet-filtered") { Lounge(allOpen = true, query = "tr") },
    Story("screen-lounge-sheet-no-match") { Lounge(allOpen = true, query = "zzz") },
    Story("screen-lounge-sheet-no-communities") {
        Lounge(communities = Load.Ready(emptyList()), home = null, allOpen = true)
    },
    Story("screen-channel") { ChannelScreen("design", "Lumen Studio", none) },
)
