# Voice & Screen Share Quality

Semaphore Chat doesn't cap screen share or voice quality behind a paid tier.
A screen share goes out at the resolution and frame rate the sharer picks, up
to 4K at 60 fps, and voice uses high-bitrate Opus. This page explains what is
sent, how viewers on weaker connections are handled, and what it costs in
bandwidth.

## Screen share

### What the sharer picks

The desktop app's source picker offers 480p, 720p, 1080p, 1440p, 4K or
"native" (the source's own size) at 15, 30 or 60 fps; it defaults to 1080p60.
In a browser, the browser's own picker chooses the source and the share uses
1080p60.

The capture asks `getDisplayMedia` for that size and frame rate. The browser
never upscales, so sharing a 1280x720 window at "1080p" captures 1280x720. The
encoding is then sized from the size that was **actually captured**.

### Encoding

The top layer carries the chosen frame rate and a maximum bitrate sized for
resolution x frame rate:

```
bitrate = 7.65 x (width x height x fps) ^ 0.75     (rounded to 100 kbps)
```

| Capture | Top layer max bitrate |
|---------|----------------------:|
| 720p30  | ~2.9 Mbps |
| 1080p30 | ~5.4 Mbps |
| 1080p60 | ~9 Mbps   |
| 1440p60 | ~13.9 Mbps |
| 4K60    | ~25.5 Mbps |

These are ceilings. The encoder uses less on static content, and WebRTC's
congestion control lowers them when the sharer's uplink can't carry them.

For comparison, livekit-client's default, which every share used before this,
is 2.5 Mbps at **15 fps** for every resolution (`ScreenSharePresets.h1080fps15`).

The sharer's frame rate also sets the track's content hint:

- 30 or 60 fps is treated as motion (games, video). The track is marked
  `motion`, and under CPU or bandwidth pressure the encoder balances frame rate
  against resolution.
- 15 fps is treated as detail (code, documents). The track is marked `detail`,
  and the encoder keeps resolution, so text stays sharp.

### Lower layers for weaker viewers

The LiveKit SFU forwards video; it doesn't transcode. A viewer on a weak
connection can only get a lower quality if the sharer also sends one, so every
screen share is published with simulcast. Only the top layer is uncapped:

| Layer | Size | Frame rate |
|-------|------|------------|
| top (`f`) | capture size | chosen fps |
| middle (`h`) | 1/2 | up to 30 |
| low (`q`) | 1/4 | up to 15 |

For example, 4K60 is sent as 2160p60, 1080p30 and 540p15. Captures under
960 px on the long side get two layers: full size and half size.

On the viewing side:

- **Adaptive stream** is on. Each viewer asks the SFU for the smallest layer
  that covers the element the share is shown in, so thumbnails and tiles get a
  low layer, and a share that is off screen or in a background tab is paused.
- **A focused share asks for the top layer.** In the spotlight view and in the
  main tile of the sidebar layout, the requested size is multiplied by 4. A 4K60
  share viewed full screen on a 1080p monitor therefore still gets the 60 fps
  top layer, not the 1080p30 middle one.
- **Congestion.** The SFU still drops a viewer to a lower layer when its
  downlink can't carry the one it asked for. The video keeps playing at lower
  quality instead of stalling.

### Upload cost for the sharer

The sharer uploads the **sum of the layers that someone is watching**. With
**dynacast** on, layers nobody subscribes to aren't encoded or sent, and a share
nobody has opened costs almost nothing. At most:

| Share | Top + middle + low |
|-------|-------------------:|
| 1080p60 | ~9 + 1.9 + 0.4 ≈ 11 Mbps |
| 1440p60 | ~13.9 + 2.9 + 0.6 ≈ 17 Mbps |
| 4K60    | ~25.5 + 5.4 + 1.1 ≈ 32 Mbps |

Each viewer downloads only the one layer it receives. On the server, the SFU's
egress is roughly the sum of what every viewer receives, so several people
sharing 4K60 to many full-screen viewers adds up quickly. Size the server's
bandwidth for that, or ask people to share at 1080p.

### Codec

Screen shares use **VP8 with simulcast**, LiveKit's default codec. Every
browser and Electron build can encode and decode it.

VP9 and AV1 compress screen content better. However, livekit-client 2.22.3
publishes a VP9 or AV1 screen share as a single spatial layer (`L1T3`) unless
it can use rid-based "SVC simulcast". Safari can't use that mode, and the
screen-share backup codec is single-layer too. Viewers on weak connections
would then have no lower layer to fall back to. AV1 software encoding at 1440p60
or 4K60 is also too heavy for many CPUs. VP8 at the bitrates above gives
high-quality 60 fps shares and keeps graceful degradation, so it is the
default. Moving to VP9 is a follow-up for when every client can publish it with
lower layers.

## Voice

The microphone is published with Opus at the bitrate chosen in
**Settings → Voice & Video → Microphone quality**:

| Setting | Bitrate | DTX |
|---------|--------:|-----|
| Standard | 48 kbps | on |
| High (default) | 96 kbps | on |
| Music | 128 kbps | off |

- **DTX** (discontinuous transmission) stops sending during silence. That
  suits speech, but it would cut off quiet passages and decaying notes, so
  Music turns it off.
- **RED** (redundant audio) is on in all three settings. It hides packet loss.
- Echo cancellation, noise suppression, auto gain and voice isolation are
  controlled separately in the same panel.
- A change applies the next time you join voice.

Screen-share audio (tab or system audio) is music, not speech. It is sent in
stereo at 128 kbps, without DTX.

## Operators

There is no instance-wide cap on screen-share bitrate or frame rate yet: every
sharer can send up to the numbers above. On a bandwidth-limited server, ask
people to share at 1080p or 30 fps. An admin setting for a maximum
screen-share bitrate and frame rate (default: uncapped) is planned.
