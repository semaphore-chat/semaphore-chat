//! W4: what the debug panel shows about the call (`MediaEngine::diagnostics`), from WebRTC's stats
//! of the two peer connections (publisher and subscriber).
//!
//! - Candidate types: the selected pair's local and remote ICE candidates, on each connection.
//! - RTT: the publisher's selected pair (the subscriber's when not publishing); `None` until ICE
//!   has measured one.
//! - Loss: what we receive, lost / (received + lost) over the call, else what the SFU says it lost
//!   of ours (remote-inbound `fractionLost`).
//! - Codec: what our audio goes out as, else what audio comes in as, `opus` rather than
//!   `audio/opus`.
//! - Bitrates: transport bytes since the previous call of this, so the first is `None`.

use livekit::webrtc::stats::{IceCandidatePairState, IceCandidateType, RtcStats};
use semaphore_core::model::MediaDiagnostics;
use std::collections::BTreeSet;
use std::time::Instant;

/// Byte totals at a moment, for the next call's bitrates.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Totals {
    pub at: Instant,
    pub received: u64,
    pub sent: u64,
}

fn candidate_name(kind: IceCandidateType) -> &'static str {
    match kind {
        IceCandidateType::Host => "host",
        IceCandidateType::Srflx => "srflx",
        IceCandidateType::Prflx => "prflx",
        IceCandidateType::Relay => "relay",
    }
}

/// The selected pair's (local, remote) candidate types and RTT in ms.
fn selected(stats: &[RtcStats]) -> (Vec<&'static str>, Option<u32>) {
    let chosen: Vec<&str> = stats
        .iter()
        .filter_map(|stat| match stat {
            RtcStats::Transport(transport)
                if !transport.transport.selected_candidate_pair_id.is_empty() =>
            {
                Some(transport.transport.selected_candidate_pair_id.as_str())
            }
            _ => None,
        })
        .collect();
    let pair = stats.iter().find_map(|stat| match stat {
        RtcStats::CandidatePair(pair)
            if chosen.contains(&pair.rtc.id.as_str())
                || (chosen.is_empty()
                    && pair.candidate_pair.nominated
                    && pair.candidate_pair.state == Some(IceCandidatePairState::Succeeded)) =>
        {
            Some(pair)
        }
        _ => None,
    });
    let Some(pair) = pair else {
        return (Vec::new(), None);
    };
    let mut kinds = Vec::new();
    for stat in stats {
        let candidate = match stat {
            RtcStats::LocalCandidate(local)
                if local.rtc.id == pair.candidate_pair.local_candidate_id =>
            {
                &local.local_candidate
            }
            RtcStats::RemoteCandidate(remote)
                if remote.rtc.id == pair.candidate_pair.remote_candidate_id =>
            {
                &remote.remote_candidate
            }
            _ => continue,
        };
        if let Some(kind) = candidate.candidate_type {
            kinds.push(candidate_name(kind));
        }
    }
    // The latest measurement; early in a call only the average over the responses so far.
    let pair = &pair.candidate_pair;
    let rtt = if pair.current_round_trip_time > 0.0 {
        pair.current_round_trip_time
    } else if pair.responses_received > 0 {
        pair.total_round_trip_time / pair.responses_received as f64
    } else {
        0.0
    };
    let rtt = (rtt > 0.0).then(|| (rtt * 1000.0).round() as u32);
    (kinds, rtt)
}

fn codec_of(stats: &[RtcStats], codec_id: &str) -> Option<String> {
    stats.iter().find_map(|stat| match stat {
        RtcStats::Codec(codec) if codec.rtc.id == codec_id => {
            let mime = &codec.codec.mime_type;
            Some(
                mime.split_once('/')
                    .map_or(mime.as_str(), |(_, name)| name)
                    .to_lowercase(),
            )
        }
        _ => None,
    })
}

fn transport_bytes(stats: &[RtcStats]) -> (u64, u64) {
    stats
        .iter()
        .fold((0, 0), |(received, sent), stat| match stat {
            RtcStats::Transport(transport) => (
                received + transport.transport.bytes_received,
                sent + transport.transport.bytes_sent,
            ),
            _ => (received, sent),
        })
}

pub(crate) fn summarize(
    publisher: &[RtcStats],
    subscriber: &[RtcStats],
    previous: Option<Totals>,
    now: Instant,
) -> (MediaDiagnostics, Totals) {
    let (publisher_kinds, publisher_rtt) = selected(publisher);
    let (subscriber_kinds, subscriber_rtt) = selected(subscriber);
    let candidate_types: BTreeSet<&str> = publisher_kinds
        .into_iter()
        .chain(subscriber_kinds)
        .collect();

    let (mut received, mut lost) = (0u64, 0i64);
    let mut inbound_codec = None;
    for stat in subscriber {
        if let RtcStats::InboundRtp(inbound) = stat
            && inbound.stream.kind == "audio"
        {
            received += inbound.received.packets_received;
            lost += inbound.received.packets_lost.max(0);
            inbound_codec =
                inbound_codec.or_else(|| codec_of(subscriber, &inbound.stream.codec_id));
        }
    }
    let packet_loss_pct = if received + lost as u64 > 0 {
        Some(lost as f32 / (received + lost as u64) as f32 * 100.0)
    } else {
        publisher.iter().find_map(|stat| match stat {
            RtcStats::RemoteInboundRtp(remote) if remote.stream.kind == "audio" => {
                Some(remote.remote_inbound.fraction_lost as f32 * 100.0)
            }
            _ => None,
        })
    };
    let outbound_codec = publisher.iter().find_map(|stat| match stat {
        RtcStats::OutboundRtp(outbound) if outbound.stream.kind == "audio" => {
            codec_of(publisher, &outbound.stream.codec_id)
        }
        _ => None,
    });

    let (publisher_in, publisher_out) = transport_bytes(publisher);
    let (subscriber_in, subscriber_out) = transport_bytes(subscriber);
    let totals = Totals {
        at: now,
        received: publisher_in + subscriber_in,
        sent: publisher_out + subscriber_out,
    };
    let rate = |now_bytes: u64, then_bytes: u64, then: Instant| {
        let ms = now.duration_since(then).as_millis() as u64;
        // A new call starts the counters again: no rate across that.
        (ms > 0 && now_bytes >= then_bytes).then(|| ((now_bytes - then_bytes) * 8 / ms) as u32)
    };
    let (bitrate_in_kbps, bitrate_out_kbps) = match previous {
        Some(before) => (
            rate(totals.received, before.received, before.at),
            rate(totals.sent, before.sent, before.at),
        ),
        None => (None, None),
    };
    (
        MediaDiagnostics {
            candidate_types: candidate_types.into_iter().map(str::to_owned).collect(),
            rtt_ms: publisher_rtt.or(subscriber_rtt),
            packet_loss_pct,
            audio_codec: outbound_codec.or(inbound_codec),
            bitrate_in_kbps,
            bitrate_out_kbps,
        },
        totals,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use livekit::webrtc::stats::*;
    use std::time::Duration;

    fn rtc(id: &str) -> dictionaries::RtcStats {
        dictionaries::RtcStats {
            id: id.into(),
            timestamp: 0,
        }
    }

    /// One peer connection: a transport whose selected pair is CP1 (L1 to R1), a second pair
    /// that isn't selected, and audio of `kind` going one way.
    fn connection(
        local: IceCandidateType,
        remote: IceCandidateType,
        received_bytes: u64,
        rtt_s: f64,
    ) -> Vec<RtcStats> {
        let mut transport = TransportStats {
            rtc: rtc("T1"),
            ..Default::default()
        };
        transport.transport.selected_candidate_pair_id = "CP1".into();
        transport.transport.bytes_received = received_bytes;
        transport.transport.bytes_sent = received_bytes / 2;
        let mut chosen = CandidatePairStats {
            rtc: rtc("CP1"),
            ..Default::default()
        };
        chosen.candidate_pair.local_candidate_id = "L1".into();
        chosen.candidate_pair.remote_candidate_id = "R1".into();
        chosen.candidate_pair.current_round_trip_time = rtt_s;
        let mut other = chosen.clone();
        other.rtc = rtc("CP2");
        other.candidate_pair.local_candidate_id = "L2".into();
        let mut local_candidate = LocalCandidateStats {
            rtc: rtc("L1"),
            ..Default::default()
        };
        local_candidate.local_candidate.candidate_type = Some(local);
        let mut unused = LocalCandidateStats {
            rtc: rtc("L2"),
            ..Default::default()
        };
        unused.local_candidate.candidate_type = Some(IceCandidateType::Prflx);
        let mut remote_candidate = RemoteCandidateStats {
            rtc: rtc("R1"),
            ..Default::default()
        };
        remote_candidate.remote_candidate.candidate_type = Some(remote);
        vec![
            RtcStats::Transport(transport),
            RtcStats::CandidatePair(chosen),
            RtcStats::CandidatePair(other),
            RtcStats::LocalCandidate(local_candidate),
            RtcStats::LocalCandidate(unused),
            RtcStats::RemoteCandidate(remote_candidate),
        ]
    }

    fn opus(id: &str) -> RtcStats {
        let mut codec = CodecStats {
            rtc: rtc(id),
            ..Default::default()
        };
        codec.codec.mime_type = "audio/opus".into();
        RtcStats::Codec(codec)
    }

    #[test]
    fn reads_the_selected_path_loss_codec_and_rates() {
        let mut publisher = connection(IceCandidateType::Host, IceCandidateType::Host, 1000, 0.042);
        let mut outbound = OutboundRtpStats::default();
        outbound.stream.kind = "audio".into();
        outbound.stream.codec_id = "C1".into();
        publisher.push(RtcStats::OutboundRtp(outbound));
        publisher.push(opus("C1"));
        let mut subscriber =
            connection(IceCandidateType::Srflx, IceCandidateType::Relay, 2000, 0.0);
        let mut inbound = InboundRtpStats::default();
        inbound.stream.kind = "audio".into();
        inbound.received.packets_received = 95;
        inbound.received.packets_lost = 5;
        subscriber.push(RtcStats::InboundRtp(inbound));
        let mut video = InboundRtpStats::default();
        video.stream.kind = "video".into();
        video.received.packets_lost = 1000;
        subscriber.push(RtcStats::InboundRtp(video));

        let start = Instant::now();
        let (first, totals) = summarize(&publisher, &subscriber, None, start);
        assert_eq!(first.candidate_types, vec!["host", "relay", "srflx"]);
        assert_eq!(first.rtt_ms, Some(42));
        assert_eq!(first.packet_loss_pct, Some(5.0));
        assert_eq!(first.audio_codec.as_deref(), Some("opus"));
        assert_eq!(
            (first.bitrate_in_kbps, first.bitrate_out_kbps),
            (None, None)
        );
        assert_eq!((totals.received, totals.sent), (3000, 1500));

        // One second later, 125 kB more in: 1000 kbps.
        let later = start + Duration::from_secs(1);
        let publisher = connection(IceCandidateType::Host, IceCandidateType::Host, 1000, 0.042);
        let subscriber = connection(
            IceCandidateType::Srflx,
            IceCandidateType::Relay,
            127_000,
            0.0,
        );
        let (second, _) = summarize(&publisher, &subscriber, Some(totals), later);
        assert_eq!(second.bitrate_in_kbps, Some(1000));
        assert_eq!(second.bitrate_out_kbps, Some(500));
        // Counters that went back (a new call) give no rate.
        let (reset, _) = summarize(&[], &[], Some(totals), later);
        assert_eq!(reset.bitrate_in_kbps, None);
    }

    #[test]
    fn early_in_a_call_the_average_round_trip_stands_in() {
        let mut stats = connection(IceCandidateType::Host, IceCandidateType::Host, 0, 0.0);
        let RtcStats::CandidatePair(pair) = &mut stats[1] else {
            unreachable!("connection() puts the selected pair second");
        };
        pair.candidate_pair.total_round_trip_time = 0.09;
        pair.candidate_pair.responses_received = 3;
        let (diagnostics, _) = summarize(&stats, &[], None, Instant::now());
        assert_eq!(diagnostics.rtt_ms, Some(30));
        let fresh = connection(IceCandidateType::Host, IceCandidateType::Host, 0, 0.0);
        assert_eq!(summarize(&fresh, &[], None, Instant::now()).0.rtt_ms, None);
    }

    #[test]
    fn nothing_known_is_nothing_said() {
        let (empty, _) = summarize(&[], &[], None, Instant::now());
        assert_eq!(empty, MediaDiagnostics::default());
    }

    #[test]
    fn loss_falls_back_to_what_the_sfu_reports() {
        let mut remote = RemoteInboundRtpStats::default();
        remote.stream.kind = "audio".into();
        remote.remote_inbound.fraction_lost = 0.25;
        let (diagnostics, _) = summarize(
            &[RtcStats::RemoteInboundRtp(remote)],
            &[],
            None,
            Instant::now(),
        );
        assert_eq!(diagnostics.packet_loss_pct, Some(25.0));
    }
}
