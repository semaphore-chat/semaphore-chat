#!/usr/bin/env bash
# Encode step of the README/docs media pipeline (runs in the `media`
# container — linuxserver/ffmpeg, cwd frontend/). Inputs come from
# shots.mjs / record.mjs under .media-out/raw/; outputs:
#
#   .media-out/screenshots/<name>.webp   2x screenshots (WebP)
#   .media-out/social.png                1280x640 Open Graph / social card
#   .media-out/video/hero.webp           ~15s animated loop, 960px @ 12 fps, <= 2 MB
#   .media-out/video/hero.gif            GIF fallback, <= 5 MB
#   .media-out/video/tour.mp4            H.264 tour, faststart
#   .media-out/video/tour-poster.webp    poster frame for the tour video
#
# MEDIA_STEPS (comma list, default all): shots, record, encode — only
# "encode" matters here (the capture container handles the others).
set -euo pipefail

case ",${MEDIA_STEPS:-shots,record,encode}," in *,encode,*) ;; *) echo "[media:encode] skipped (MEDIA_STEPS)"; exit 0 ;; esac

OUT=.media-out
RAW="$OUT/raw"
TMP="$RAW/tmp"
# -nostdin: ffmpeg otherwise eats the `while read` loop's input (trims.txt).
FF=(ffmpeg -nostdin -hide_banner -loglevel error -y)
FADE=0.5            # crossfade between scenes (s)
LOOP_FADE=0.6       # hero: crossfade from the last scene back to the first frame
LOOP_HOLD=0.25      # hero: then hold that first frame (the 12 fps WebP/GIF may not sample the fade's very last frame)
XFADE=fade          # xfade transition (the hero uses HERO_XFADE)
# The hero's crossfades ease in steeply (sixth power) instead of running linearly. The
# animated-WebP encoder skips pixels that changed by only a few levels since
# the previous frame, so a slow linear fade over dark, dimmed content never
# finishes there: the old scene's text stays burnt into the new one as dark
# blocks for as long as that area stays still. Eased, the last step of the
# fade is large enough to be encoded everywhere it matters.
HERO_XFADE="custom:expr='A*(1-pow(1-P\,6))+B*pow(1-P\,6)'"
BG_TOP='0x1b1530'   # phone scene backdrop (showcase violet, dark)
BG_BOTTOM='0x0f0d1a'
# The gradients source replaces any end point outside the frame (x >= width,
# y >= height) with a random one, so gradient end points must stay inside it
# (1279, not 1280). Otherwise social.png and the phone scene backdrop change on
# every encode, and unchanged inputs no longer give byte-identical outputs.

# The capture container's output isn't shown by `compose run` (it's a dependency).
if [[ -f "$OUT/capture.log" ]]; then
  echo "── capture ──"; cat "$OUT/capture.log"; echo "── encode ──"
fi

rm -rf "$OUT/screenshots" "$TMP"
mkdir -p "$OUT/screenshots" "$OUT/video" "$TMP"

# ── Screenshots ──────────────────────────────────────────────────────────
shopt -s nullglob
for png in "$RAW"/shots/*.png; do
  name=$(basename "$png" .png)
  "${FF[@]}" -i "$png" -c:v libwebp -quality 86 -compression_level 6 -preset picture "$OUT/screenshots/$name.webp"
done
if [[ -f "$RAW/shots/chat-desktop.png" ]]; then
  # The whole #dev screenshot (a 2:1 crop of a 16:10 frame would cut through
  # a message) framed on the showcase violet, like the phone scene.
  "${FF[@]}" -i "$RAW/shots/chat-desktop.png" \
    -f lavfi -i "gradients=s=1280x640:c0=${BG_TOP}:c1=${BG_BOTTOM}:x0=0:y0=0:x1=1279:y1=639:d=1:r=1" \
    -filter_complex "[0:v]scale=-2:576:flags=lanczos,pad=iw+4:ih+4:2:2:color=0x3a3158[s];[1:v][s]overlay=(W-w)/2:(H-h)/2" \
    -frames:v 1 "$OUT/social.png"
fi
echo "[media:encode] screenshots: $(ls "$OUT"/screenshots/*.webp 2>/dev/null | wc -l)"

# ── Scenes ───────────────────────────────────────────────────────────────
TRIMS="$RAW/scenes/trims.txt"
if [[ ! -f "$TRIMS" ]]; then
  echo "[media:encode] no scenes recorded ($TRIMS missing) — skipping video"
  exit 0
fi

declare -A DUR
# Normalise every clip: trimmed, 30 fps, 1440x900, yuv420p, near-lossless.
while read -r name start dur; do
  [[ -z "$name" ]] && continue
  src="$RAW/scenes/$name.webm"
  [[ -f "$src" ]] || continue
  if [[ "$name" == *phone* ]]; then
    # Phone clip (390x844) centred on a 1440x900 violet backdrop.
    "${FF[@]}" -ss "$start" -i "$src" -t "$dur" \
      -f lavfi -i "gradients=s=1440x900:c0=${BG_TOP}:c1=${BG_BOTTOM}:x0=0:y0=0:x1=0:y1=899:d=${dur}:r=30" \
      -filter_complex "[0:v]fps=30,scale=-2:840:flags=lanczos,pad=iw+4:ih+4:2:2:color=0x3a3158[p];[1:v][p]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p,setsar=1" \
      -c:v libx264 -crf 12 -preset veryfast -an "$TMP/$name.mp4"
  else
    "${FF[@]}" -ss "$start" -i "$src" -t "$dur" \
      -vf "fps=30,scale=1440:900:flags=lanczos,format=yuv420p,setsar=1" \
      -c:v libx264 -crf 12 -preset veryfast -an "$TMP/$name.mp4"
  fi
  DUR[$name]=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/$name.mp4" </dev/null)
done < "$TRIMS"

# Build an xfade chain over the given clips; prints the filter graph and sets
# CHAIN_LEN (total length). Inputs are [0:v]..[n-1:v].
xfade_chain() {
  local -a clips=("$@")
  local graph="" prev="[0:v]" offset=0 i
  offset=$(awk -v a="${DUR[${clips[0]}]}" 'BEGIN{printf "%.3f", a}')
  for ((i = 1; i < ${#clips[@]}; i++)); do
    local off
    off=$(awk -v o="$offset" -v f="$FADE" 'BEGIN{printf "%.3f", o - f}')
    graph+="${prev}[$i:v]xfade=transition=${XFADE}:duration=${FADE}:offset=${off}[x$i];"
    prev="[x$i]"
    offset=$(awk -v o="$off" -v d="${DUR[${clips[$i]}]}" 'BEGIN{printf "%.3f", o + d}')
  done
  CHAIN_OUT="$prev"
  CHAIN_LEN="$offset"
  CHAIN_GRAPH="$graph"
}

inputs_for() {
  local -a args=()
  local c
  for c in "$@"; do args+=(-i "$TMP/$c.mp4"); done
  printf '%s\n' "${args[@]}"
}

# ── Hero loop ────────────────────────────────────────────────────────────
HERO=(hero-chat hero-voice)
if [[ -n "${DUR[hero-chat]:-}" && -n "${DUR[hero-voice]:-}" ]]; then
  mapfile -t IN < <(inputs_for "${HERO[@]}")
  XFADE="$HERO_XFADE" xfade_chain "${HERO[@]}"
  # Loop closure: fade the end into a still of the very first frame, so the
  # last frames of the file == its first frame (held for LOOP_HOLD).
  n=${#HERO[@]}
  loop_off=$(awk -v l="$CHAIN_LEN" -v f="$LOOP_FADE" 'BEGIN{printf "%.3f", l - f}')
  graph="${CHAIN_GRAPH}[$n:v]trim=end_frame=1,tpad=stop_mode=clone:stop_duration=$(awk -v f="$LOOP_FADE" -v h="$LOOP_HOLD" 'BEGIN{printf "%.3f", f + h}'),setpts=PTS-STARTPTS[first];"
  graph+="${CHAIN_OUT}[first]xfade=transition=${HERO_XFADE}:duration=${LOOP_FADE}:offset=${loop_off}[hero]"
  "${FF[@]}" "${IN[@]}" -i "$TMP/hero-chat.mp4" -filter_complex "$graph" -map "[hero]" \
    -c:v libx264 -crf 12 -preset veryfast -pix_fmt yuv420p "$TMP/hero.mp4"

  "${FF[@]}" -i "$TMP/hero.mp4" -vf "fps=12,scale=960:-2:flags=lanczos" \
    -c:v libwebp_anim -lossless 0 -quality 80 -compression_level 6 -loop 0 -preset picture "$OUT/video/hero.webp"
  "${FF[@]}" -i "$TMP/hero.mp4" -vf "fps=12,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    -loop 0 "$OUT/video/hero.gif"
  echo "[media:encode] hero: $(awk -v l="$CHAIN_LEN" -v h="$LOOP_HOLD" 'BEGIN{printf "%.3f", l + h}')s — webp $(du -h "$OUT/video/hero.webp" | cut -f1), gif $(du -h "$OUT/video/hero.gif" | cut -f1)"
fi

# ── Tour ─────────────────────────────────────────────────────────────────
TOUR=()
for c in tour-chat tour-dms tour-phone tour-voice tour-light; do
  [[ -n "${DUR[$c]:-}" ]] && TOUR+=("$c")
done
if (( ${#TOUR[@]} > 0 )); then
  mapfile -t IN < <(inputs_for "${TOUR[@]}")
  if (( ${#TOUR[@]} > 1 )); then
    xfade_chain "${TOUR[@]}"
    graph="${CHAIN_GRAPH%;}"
    out="$CHAIN_OUT"
  else
    graph="[0:v]null[v0]"
    out="[v0]"
  fi
  # Fade in from / out to black at the ends.
  total=$(awk -v l="${CHAIN_LEN:-${DUR[${TOUR[0]}]}}" 'BEGIN{printf "%.3f", l}')
  fo=$(awk -v l="$total" 'BEGIN{printf "%.3f", l - 0.6}')
  graph+=";${out}fade=t=in:st=0:d=0.4,fade=t=out:st=${fo}:d=0.6[tour]"
  "${FF[@]}" "${IN[@]}" -filter_complex "$graph" -map "[tour]" \
    -c:v libx264 -crf 28 -preset slow -profile:v high -pix_fmt yuv420p -movflags +faststart "$OUT/video/tour.mp4"
  # Poster: the #dev screenshot the tour opens on (same story, no cursor);
  # falls back to a frame of the first scene.
  if [[ -f "$RAW/shots/chat-desktop.png" && "${TOUR[0]}" == tour-chat ]]; then
    "${FF[@]}" -i "$RAW/shots/chat-desktop.png" -vf "scale=1440:900:flags=lanczos" -c:v libwebp -quality 85 "$OUT/video/tour-poster.webp"
  else
    "${FF[@]}" -ss 0.2 -i "$TMP/${TOUR[0]}.mp4" -frames:v 1 -c:v libwebp -quality 85 "$OUT/video/tour-poster.webp"
  fi
  echo "[media:encode] tour: ${total}s — mp4 $(du -h "$OUT/video/tour.mp4" | cut -f1)"
fi

if [[ -f "$OUT/report.json" ]] && ! grep -q '"issueCount": 0' "$OUT/report.json"; then
  echo "[media:encode] WARNING: screenshots had issues — check $OUT/report.json before publishing"
fi
# Containers run as root; hand the output back to whoever owns the checkout.
chown -R "$(stat -c %u:%g .)" .media-out 2>/dev/null || true
echo "[media:encode] done → $OUT"
