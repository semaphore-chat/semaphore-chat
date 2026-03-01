# Notification Sounds

All sounds use notes from the **Eb major pentatonic scale** (Eb, F, G, Bb, C), so any combination playing simultaneously or in sequence will always sound harmonious.

## Sound Inventory

### Single notes

| File | Notes | Duration | Character |
|------|-------|----------|-----------|
| `pluck.wav` | Eb5 | 160ms | Neutral, mid-register |
| `pluck-high.wav` | Bb5 | 150ms | Bright, attention-getting |
| `pluck-low.wav` | Bb4 | 170ms | Warm, subdued |

### Whole steps (toggles)

| File | Notes | Duration | Direction |
|------|-------|----------|-----------|
| `asc-step.wav` | Eb5 → F5 | 190ms | Ascending |
| `desc-step.wav` | F5 → Eb5 | 190ms | Descending |

### Thirds (features)

| File | Notes | Duration | Direction |
|------|-------|----------|-----------|
| `asc-major-third.wav` | Eb5 → G5 | 270ms | Ascending major 3rd |
| `desc-major-third.wav` | G5 → Eb5 | 270ms | Descending major 3rd |
| `asc-minor-third.wav` | G5 → Bb5 | 270ms | Ascending minor 3rd |

### Fourths (presence)

| File | Notes | Duration | Direction |
|------|-------|----------|-----------|
| `asc-fourth.wav` | Bb4 → Eb5 | 340ms | Ascending |
| `desc-fourth.wav` | Eb5 → Bb4 | 340ms | Descending |

### Fifths (announcements)

| File | Notes | Duration | Direction |
|------|-------|----------|-----------|
| `asc-fifth.wav` | Eb5 → Bb5 | 300ms | Ascending |
| `desc-fifth.wav` | Bb5 → Eb5 | 300ms | Descending |

### Three-note sequences (important events)

| File | Notes | Duration | Direction |
|------|-------|----------|-----------|
| `asc-triad.wav` | Eb5 → G5 → Bb5 | 350ms | Ascending, mid-register |
| `desc-triad.wav` | Bb5 → G5 → Eb5 | 350ms | Descending, mid-register |
| `asc-arpeggio.wav` | Bb4 → Eb5 → G5 | 425ms | Ascending, from low register |
| `desc-arpeggio.wav` | G5 → Eb5 → Bb4 | 425ms | Descending, to low register |

## How to Choose Sounds

### By category: interval = event type

- **Fourths** → presence events (join/leave voice). Warm, round timbre.
- **Fifths** → announcements, state changes. Wide interval, feels significant.
- **Thirds** → feature events (screenshare, DM). Brighter, crisper timbre.
- **Whole steps** → toggles (mute, deafen, camera). Very subtle, short.
- **Single notes** → high-frequency events (messages). Minimal, won't fatigue. Three registers available for different urgency levels.

### By direction: ascending = start, descending = stop

- **Ascending** → something beginning: user joined, feature enabled, share started
- **Descending** → something ending: user left, feature disabled, share stopped

### By note count: more notes = more important

- **1 note** → frequent, subtle (channel messages, minor state changes)
- **2 notes** → medium importance (join/leave, screenshare, DM, toggles)
- **3 notes** → demands attention (mentions, incoming calls, critical alerts)

## Suggested Mapping

| Event | Sound | Why |
|-------|-------|-----|
| Channel message | `pluck.wav` | Most frequent — single mid note won't fatigue |
| Direct message | `asc-minor-third.wav` | Third = feature, higher register = more urgent than pluck |
| @mention / @everyone | `asc-triad.wav` | 3 ascending notes, can't miss it |
| User joined voice | `asc-fourth.wav` | Fourth = presence, ascending = arrival |
| User left voice | `desc-fourth.wav` | Fourth = presence, descending = departure |
| Screen share started | `asc-major-third.wav` | Third = feature, ascending = start |
| Screen share stopped | `desc-major-third.wav` | Third = feature, descending = stop |
| Incoming call | `asc-arpeggio.wav` | 3 notes from low register, most prominent sound |
| Call ended / missed | `desc-arpeggio.wav` | 3 notes descending to low register, definitive ending |
| Feature toggled on | `asc-step.wav` | Whole step = toggle, ascending = on |
| Feature toggled off | `desc-step.wav` | Whole step = toggle, descending = off |
| Error / warning | `pluck-high.wav` | High register single note, attention-getting but brief |
| Success / connected | `asc-fifth.wav` | Wide ascending interval, feels resolved and positive |
| Disconnected / failed | `desc-fifth.wav` | Wide descending interval, definitive |
| Notification dismissed | `pluck-low.wav` | Low register, subdued, "acknowledged" |
| Pending / waiting | `desc-triad.wav` | Descending 3 notes, "settling down" |

## Design Notes

The timbre varies by category — presence sounds have more 2nd harmonic (warmer/rounder), feature sounds have more 3rd harmonic (brighter/crisper), and toggles are neutral. This means even without consciously tracking pitch, the *feel* of the sound tells you what kind of event happened.

All sounds use only Eb pentatonic notes, so if a join and a screenshare-start fire at the same time, you hear a chord rather than noise.
