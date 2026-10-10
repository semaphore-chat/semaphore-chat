import { describe, it, expect } from 'vitest';
import type { Room } from 'livekit-client';
import { summarizeIceStats, getIceSummary, candidateTypesOf } from '../../features/voice/iceSummary';

type Stat = Record<string, unknown> & { id: string; type: string };
const report = (stats: Stat[]) => new Map(stats.map((s) => [s.id, s])) as unknown as RTCStatsReport;

const directUdp = report([
  { id: 'T1', type: 'transport', selectedCandidatePairId: 'CP1' },
  { id: 'CP1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'succeeded' },
  { id: 'CP2', type: 'candidate-pair', localCandidateId: 'L2', remoteCandidateId: 'R1', state: 'failed' },
  { id: 'L1', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp' },
  { id: 'L2', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
  { id: 'R1', type: 'remote-candidate', candidateType: 'host', protocol: 'udp' },
]);

const relayedTls = report([
  { id: 'CP1', type: 'candidate-pair', localCandidateId: 'L3', remoteCandidateId: 'R1', nominated: true, state: 'succeeded' },
  { id: 'L1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
  { id: 'L3', type: 'local-candidate', candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls' },
  { id: 'R1', type: 'remote-candidate', candidateType: 'host', protocol: 'udp' },
]);

describe('summarizeIceStats', () => {
  it('reads the selected pair from the transport', () => {
    expect(summarizeIceStats(directUdp)).toEqual({
      selected: { localType: 'srflx', remoteType: 'host', protocol: 'udp', relayProtocol: undefined },
      localCandidateTypes: ['srflx', 'host'],
    });
  });

  it('falls back to the nominated, succeeded pair, and reports a TURN relay over TLS', () => {
    const summary = summarizeIceStats(relayedTls);
    expect(summary?.selected).toEqual({ localType: 'relay', remoteType: 'host', protocol: 'udp', relayProtocol: 'tls' });
    expect(summary?.localCandidateTypes).toContain('relay');
  });

  it('has no selected pair when ICE never connected', () => {
    const summary = summarizeIceStats(
      report([{ id: 'L1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' }]),
    );
    expect(summary).toEqual({ selected: null, localCandidateTypes: ['host'] });
  });

  it('handles a missing report', () => {
    expect(summarizeIceStats(undefined)).toBeNull();
  });
});

describe('getIceSummary', () => {
  const roomWith = (engine: unknown) => ({ engine }) as unknown as Room;

  it('summarizes both transports and sees TURN in the RTC configuration', async () => {
    const summary = await getIceSummary(
      roomWith({
        pcManager: { publisher: { getStats: async () => directUdp }, subscriber: { getStats: async () => directUdp } },
        rtcConfig: { iceServers: [{ urls: ['stun:stun.example.org'] }, { urls: 'turns:turn.example.org:443' }] },
      }),
    );
    expect(summary?.publisher?.selected?.localType).toBe('srflx');
    expect(summary?.subscriber?.selected?.localType).toBe('srflx');
    expect(summary?.turnOffered).toBe(true);
  });

  it('infers TURN from a gathered relay candidate when the config is unreadable', async () => {
    const summary = await getIceSummary(
      roomWith({ pcManager: { publisher: { getStats: async () => relayedTls } } }),
    );
    expect(summary?.turnOffered).toBe(true);
    expect(summary?.subscriber).toBeNull();
  });

  it('reports no TURN when only STUN is configured and nothing relayed', async () => {
    const summary = await getIceSummary(
      roomWith({
        pcManager: { publisher: { getStats: async () => directUdp } },
        rtcConfig: { iceServers: [{ urls: 'stun:stun.example.org' }] },
      }),
    );
    expect(summary?.turnOffered).toBe(false);
  });

  it('never throws (stats failing, no engine, no room)', async () => {
    const failing = await getIceSummary(
      roomWith({ pcManager: { publisher: { getStats: () => Promise.reject(new Error('closed')) } } }),
    );
    expect(failing?.publisher).toBeNull();
    expect(await getIceSummary(roomWith(undefined))).toBeNull();
    expect(await getIceSummary(null)).toBeNull();
  });

  it('candidateTypesOf lists the types in use for the failure report', async () => {
    const summary = await getIceSummary(
      roomWith({ pcManager: { publisher: { getStats: async () => relayedTls } } }),
    );
    expect(candidateTypesOf(summary).sort()).toEqual(['host', 'relay']);
    expect(candidateTypesOf(null)).toEqual([]);
  });
});
