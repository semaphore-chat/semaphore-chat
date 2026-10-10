import type { Room } from 'livekit-client';

/**
 * Which ICE path a voice connection actually uses. Tells "direct UDP"
 * (host/srflx over udp) from "relayed through TURN" (relay, possibly over
 * tcp/tls), which is the first thing to know when voice fails on some
 * networks and not others.
 */

export type IceCandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

export interface SelectedCandidatePair {
  localType?: IceCandidateType;
  remoteType?: IceCandidateType;
  /** Transport of the local candidate: udp or tcp. */
  protocol?: string;
  /** For a relay candidate: how we reach the TURN server (udp, tcp or tls). */
  relayProtocol?: string;
}

export interface IceTransportSummary {
  selected: SelectedCandidatePair | null;
  /** Local candidate types gathered (relay present = a TURN server answered). */
  localCandidateTypes: IceCandidateType[];
}

export interface IceSummary {
  publisher: IceTransportSummary | null;
  subscriber: IceTransportSummary | null;
  /**
   * Whether TURN servers were offered: from the room's RTC configuration when
   * readable, else whether any relay candidate was gathered. Null if unknown.
   */
  turnOffered: boolean | null;
}

type StatLike = Record<string, unknown> & { type: string; id: string };

function asStats(report: RTCStatsReport): Map<string, StatLike> {
  const out = new Map<string, StatLike>();
  report.forEach((stat: StatLike) => out.set(stat.id, stat));
  return out;
}

function candidateType(value: unknown): IceCandidateType | undefined {
  return value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay' ? value : undefined;
}

/** The selected candidate pair and the gathered local candidate types, from one transport's stats. */
export function summarizeIceStats(report: RTCStatsReport | undefined): IceTransportSummary | null {
  if (!report) return null;
  const stats = asStats(report);

  let pair: StatLike | undefined;
  for (const stat of stats.values()) {
    if (stat.type === 'transport' && typeof stat.selectedCandidatePairId === 'string') {
      pair = stats.get(stat.selectedCandidatePairId);
      if (pair) break;
    }
  }
  if (!pair) {
    for (const stat of stats.values()) {
      if (stat.type !== 'candidate-pair') continue;
      if (stat.selected === true || (stat.nominated === true && stat.state === 'succeeded')) {
        pair = stat;
        break;
      }
    }
  }

  let selected: SelectedCandidatePair | null = null;
  if (pair) {
    const local = stats.get(String(pair.localCandidateId));
    const remote = stats.get(String(pair.remoteCandidateId));
    selected = {
      localType: candidateType(local?.candidateType),
      remoteType: candidateType(remote?.candidateType),
      protocol: typeof local?.protocol === 'string' ? local.protocol : undefined,
      relayProtocol: typeof local?.relayProtocol === 'string' ? local.relayProtocol : undefined,
    };
  }

  const localCandidateTypes = new Set<IceCandidateType>();
  for (const stat of stats.values()) {
    if (stat.type !== 'local-candidate') continue;
    const type = candidateType(stat.candidateType);
    if (type) localCandidateTypes.add(type);
  }

  return { selected, localCandidateTypes: [...localCandidateTypes] };
}

interface TransportLike {
  getStats?: () => Promise<RTCStatsReport> | undefined;
}
interface EngineLike {
  pcManager?: { publisher?: TransportLike; subscriber?: TransportLike };
  rtcConfig?: RTCConfiguration;
}

async function transportStats(transport: TransportLike | undefined): Promise<RTCStatsReport | undefined> {
  try {
    return (await transport?.getStats?.()) ?? undefined;
  } catch {
    return undefined;
  }
}

function turnInConfig(config: RTCConfiguration | undefined): boolean | null {
  const servers = config?.iceServers;
  if (!servers || servers.length === 0) return null;
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => /^turns?:/i.test(url));
  });
}

/** Read the ICE path of a connected room (via livekit's peer connections). Never throws. */
export async function getIceSummary(room: Room | null): Promise<IceSummary | null> {
  const engine = (room as unknown as { engine?: EngineLike } | null)?.engine;
  if (!engine?.pcManager) return null;
  const [publisher, subscriber] = await Promise.all([
    transportStats(engine.pcManager.publisher).then(summarizeIceStats),
    transportStats(engine.pcManager.subscriber).then(summarizeIceStats),
  ]);
  const relayGathered = [publisher, subscriber].some((t) => t?.localCandidateTypes.includes('relay'));
  const fromConfig = turnInConfig(engine.rtcConfig);
  return {
    publisher,
    subscriber,
    turnOffered: fromConfig === true || relayGathered ? true : fromConfig,
  };
}

/** All candidate types in use (selected pairs), for the failure report. */
export function candidateTypesOf(summary: IceSummary | null | undefined): IceCandidateType[] {
  const types = new Set<IceCandidateType>();
  for (const t of [summary?.publisher, summary?.subscriber]) {
    if (t?.selected?.localType) types.add(t.selected.localType);
    for (const type of t?.localCandidateTypes ?? []) types.add(type);
  }
  return [...types];
}
