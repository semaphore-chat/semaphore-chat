# First Run

After [installing](docker-compose.md) Semaphore Chat, follow these steps to set up your instance.

## 1. Run the setup wizard

Open your instance (for a local install, [http://localhost:5173](http://localhost:5173)). A fresh instance opens the setup wizard, which creates the owner account, names the instance and makes a first community.

The last step asks for the **setup token**. The backend prints it in its log while the instance still needs setup, on one line containing `Setup token:`:

```bash
# Docker Compose
docker compose logs backend | grep "Setup token:"

# Kubernetes (Helm)
kubectl logs -l app.kubernetes.io/component=backend --tail=-1 | grep "Setup token:"
```

Paste the token into the wizard. The token proves you can see the server, so a stranger who reaches a new instance before you can't make themselves its owner. It is printed again on every restart until setup is done, and never after.

- **Unattended installs:** set `SETUP_TOKEN` (16 characters or more) to choose the token yourself. It is not printed; enter the value you set.
- **Private networks:** `REQUIRE_SETUP_TOKEN=false` makes the wizard fetch the token itself, as older releases did. Only do this when nobody else can reach the instance before you finish setup.

See [Configuration](configuration.md#first-run-setup).

## 2. Create a community

1. Click the **+** button in the sidebar
2. Enter a community name and optional description
3. Click **Create**

Your new community appears in the sidebar.

## 3. Create channels

Inside your community:

1. Click the **+** next to the channel list
2. Choose a channel type:
    - **Text** — for messaging
    - **Voice** — for voice and video calls (requires [LiveKit configuration](configuration.md#livekit-voicevideo))
3. Name the channel and click **Create**

## 4. Invite others

1. Open your community settings
2. Go to the **Invites** section
3. Create an invite link
4. Share the link with others — they can register and join your community

## 5. Start chatting

- Send messages in text channels with mentions, reactions, and file attachments
- Join voice channels for real-time audio and video (if LiveKit is configured)
- Use direct messages for private conversations

## Optional: Set up voice and video

If you haven't configured LiveKit yet, voice channels will be visible but non-functional. See the [LiveKit setup instructions](docker-compose.md#connecting-your-livekit-server) to enable voice and video calls, including screen sharing and replay buffer features.

## Next steps

- [Configuration](configuration.md) — Tune environment variables
- [Contributing](../contributing/index.md) — Help improve Semaphore Chat
