/**
 * Synthetic LiveKit publishers for the voice/video scenarios, one process:
 *
 *   node publish.ts   (env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
 *                      ROOM, SCENARIO, SEED_FILE, SCENARIOS_FILE, REPORT_FILE)
 *
 * Frames are precomputed and deterministic, so a native client later receives
 * the same load. Streams come from scenarios.json; nothing is downgraded here.
 * Prints READY once everything is publishing, and keeps REPORT_FILE up to date
 * with the rate each stream was really captured at. Runs until SIGTERM.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { DegradationPreference } from '@livekit/rtc-ffi-bindings';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import {
  AudioFrame, AudioSource, LocalAudioTrack, LocalVideoTrack, Room, TrackPublishOptions,
  TrackSource, VideoBufferType, VideoCodec, VideoFrame, VideoSource, dispose,
} from '@livekit/rtc-node';

interface VideoSpec { width: number; height: number; fps: number; max_bitrate: number; codec: string; simulcast: boolean; noise_blocks_per_frame: number }
interface Publishers { audio: number; camera: number; screen: number; camera_spec?: VideoSpec; screen_spec?: VideoSpec }
interface StreamReport { identity: string; kind: string; requested: VideoSpec | null; frames: number; started_ms: number; captured_fps: number }

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const scenarios = JSON.parse(readFileSync(env('SCENARIOS_FILE'), 'utf8')) as { scenarios: Record<string, { publishers?: Publishers }> };
const seed = JSON.parse(readFileSync(env('SEED_FILE'), 'utf8')) as { bench_users: { id: string; display_name: string }[] };
const plan = scenarios.scenarios[env('SCENARIO')]?.publishers;
if (!plan) throw new Error(`scenario ${env('SCENARIO')} has no publishers`);

const rooms: Room[] = [];
const reports: StreamReport[] = [];
const timers: NodeJS.Timeout[] = [];
const failures: string[] = [];

/** What LiveKit says each participant publishes: the sender's side of the spec. */
let serverTracks: unknown[] = [];
async function refreshServerTracks(): Promise<void> {
  const url = env('LIVEKIT_URL').replace(/^ws/, 'http');
  const client = new RoomServiceClient(url, env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'));
  const participants = await client.listParticipants(env('ROOM'));
  serverTracks = participants.flatMap((p) => p.tracks.map((t) => ({
    identity: p.identity, source: t.source, simulcast: t.simulcast, width: t.width, height: t.height,
    mime_type: t.mimeType,
    layers: t.layers.map((l) => ({ quality: l.quality, width: l.width, height: l.height, bitrate: l.bitrate })),
  })));
}

/** Publisher CPU, in cores: what this scenario adds to the machine's load, outside the client's tree. */
let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();
let cores = 0;

function writeReport(): void {
  const now = Date.now();
  if (now - lastCpuAt >= 1000) {
    const used = process.cpuUsage(lastCpu);
    cores = Math.round(((used.user + used.system) / 1e6 / ((now - lastCpuAt) / 1000)) * 100) / 100;
    lastCpu = process.cpuUsage();
    lastCpuAt = now;
  }
  for (const r of reports) {
    const elapsed = (now - r.started_ms) / 1000;
    r.captured_fps = elapsed > 0 ? Math.round((r.frames / elapsed) * 10) / 10 : 0;
  }
  const tmp = `${env('REPORT_FILE')}.tmp`;
  writeFileSync(tmp, JSON.stringify({ streams: reports, failures, cpu_cores: cores, server_tracks: serverTracks }, null, 1));
  renameSync(tmp, env('REPORT_FILE'));
}

async function join(identity: string, name: string): Promise<Room> {
  const token = new AccessToken(env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'), { identity, name, ttl: '6h' });
  token.addGrant({ roomJoin: true, room: env('ROOM'), canPublish: true, canSubscribe: false });
  const room = new Room();
  await room.connect(env('LIVEKIT_URL'), await token.toJwt(), { autoSubscribe: false, dynacast: false });
  rooms.push(room);
  return room;
}

/**
 * A dark frame with a moving lit band and noise blocks in new places each frame,
 * so VP8 has real work per frame. noiseBlocks is calibrated per stream to fill
 * its bitrate: each 16x16 block costs a few hundred bytes, and the encoder drops
 * frames if they exceed the budget (a 720p frame at 1.7 Mbps and 30 fps has 7 kB).
 */
function makeFrames(width: number, height: number, count: number, noiseBlocks: number): Uint8Array[] {
  const frames: Uint8Array[] = [];
  const ySize = width * height;
  const chroma = (width >> 1) * (height >> 1);
  const columns = Math.floor(width / 16);
  const rows = Math.floor(height / 16);
  let rng = 0x2f6e2b1;
  const next = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng >>> 8;
  };
  for (let n = 0; n < count; n += 1) {
    const buf = new Uint8Array(ySize + 2 * chroma);
    const band = Math.floor((n / count) * width);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const lit = Math.abs(x - band) < width / 10;
        buf[row + x] = (lit ? 150 : 40) + ((x >> 3) ^ (y >> 3)) % 48;
      }
    }
    for (let block = 0; block < noiseBlocks; block += 1) {
      const bx = (next() % columns) * 16;
      const by = (next() % rows) * 16;
      for (let y = by; y < by + 16; y += 1) {
        for (let x = bx; x < bx + 16; x += 1) {
          buf[y * width + x] = next() & 0xff;
        }
      }
    }
    buf.fill(128, ySize);
    frames.push(buf);
  }
  return frames;
}

const frameSets = new Map<string, Uint8Array[]>();
function framesFor(spec: VideoSpec): Uint8Array[] {
  const key = `${spec.width}x${spec.height}`;
  let set = frameSets.get(key);
  if (!set) {
    set = makeFrames(spec.width, spec.height, spec.fps * 2, spec.noise_blocks_per_frame);
    frameSets.set(key, set);
  }
  return set;
}

async function publishVideo(identity: string, name: string, kind: 'camera' | 'screen', spec: VideoSpec, phase: number): Promise<void> {
  if (spec.codec !== 'vp8') throw new Error(`unsupported codec ${spec.codec}`);
  const room = await join(identity, name);
  const source = new VideoSource(spec.width, spec.height);
  const track = LocalVideoTrack.createVideoTrack(kind, source);
  const options = new TrackPublishOptions({
    source: kind === 'screen' ? TrackSource.SOURCE_SCREENSHARE : TrackSource.SOURCE_CAMERA,
    simulcast: spec.simulcast,
    videoCodec: VideoCodec.VP8,
    videoEncoding: { maxBitrate: BigInt(spec.max_bitrate), maxFramerate: spec.fps },
    // Under pressure the scenario wants a frame-rate shortfall it can detect,
    // not a resolution quietly below what it's labelled.
    degradationPreference: DegradationPreference.MAINTAIN_RESOLUTION,
  });
  await room.localParticipant!.publishTrack(track, options);

  const frames = framesFor(spec);
  const report: StreamReport = { identity, kind, requested: spec, frames: 0, started_ms: Date.now(), captured_fps: 0 };
  reports.push(report);
  const period = 1000 / spec.fps;
  let next = Date.now();
  let index = phase;
  const tick = () => {
    const data = frames[index % frames.length];
    source.captureFrame(new VideoFrame(data, spec.width, spec.height, VideoBufferType.I420));
    index += 1;
    report.frames += 1;
    next += period;
    // Late by over a second: don't burst to catch up; captured_fps will show the shortfall.
    if (Date.now() - next > 1000) next = Date.now();
    timers[slot] = setTimeout(tick, Math.max(0, next - Date.now()));
  };
  const slot = timers.length;
  timers.push(setTimeout(tick, 0));
}

/** Speech-like duty cycle: 1.5 s of a modulated tone, 0.5 s of silence. */
async function publishAudio(identity: string, name: string, pitch: number): Promise<void> {
  const room = await join(identity, name);
  const rate = 48_000;
  const samples = rate / 100;
  const source = new AudioSource(rate, 1, 1000);
  const track = LocalAudioTrack.createAudioTrack('microphone', source);
  await room.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
  const report: StreamReport = { identity, kind: 'audio', requested: null, frames: 0, started_ms: Date.now(), captured_fps: 0 };
  reports.push(report);
  let n = 0;
  const pump = async () => {
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i += 1, n += 1) {
      const t = n / rate;
      const voiced = t % 2 < 1.5;
      pcm[i] = voiced ? Math.round(8000 * Math.sin(2 * Math.PI * pitch * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))) : 0;
    }
    // captureFrame backpressures on the source's queue, which paces this loop.
    await source.captureFrame(new AudioFrame(pcm, rate, 1, samples));
    report.frames += 1;
    if (!stopping) void pump().catch(fail);
  };
  void pump().catch(fail);
}

let stopping = false;
function fail(err: unknown): void {
  failures.push(err instanceof Error ? err.message : String(err));
  console.error('publisher failure', err);
}

async function main(): Promise<void> {
  const needed = plan.audio + plan.camera + plan.screen;
  if (seed.bench_users.length < needed) throw new Error(`need ${needed} bench users, have ${seed.bench_users.length}`);
  const users = [...seed.bench_users];
  for (let i = 0; i < plan.audio; i += 1) {
    const u = users.shift()!;
    await publishAudio(u.id, u.display_name, 140 + i * 40);
  }
  for (let i = 0; i < plan.camera; i += 1) {
    const u = users.shift()!;
    await publishVideo(u.id, u.display_name, 'camera', plan.camera_spec!, i * 7);
  }
  for (let i = 0; i < plan.screen; i += 1) {
    const u = users.shift()!;
    await publishVideo(u.id, u.display_name, 'screen', plan.screen_spec!, i * 11);
  }
  writeReport();
  setInterval(() => {
    refreshServerTracks().catch(fail).finally(writeReport);
  }, 2000);
  console.log('READY');
}

async function shutdown(): Promise<void> {
  stopping = true;
  for (const t of timers) clearTimeout(t);
  writeReport();
  await Promise.allSettled(rooms.map((r) => r.disconnect()));
  await dispose();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
