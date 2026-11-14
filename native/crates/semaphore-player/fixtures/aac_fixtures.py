#!/usr/bin/env python3
"""Bit-level AAC fixtures: the profiles the toolchain's encoder cannot produce itself.

The video rig's ffmpeg has no libfdk_aac (Arch's build has only the native `aac` encoder, which
writes AAC-LC), so the two refusal fixtures `fixtures/gen.sh` commits are made by relabelling the
headers of an LC stream. Nothing here decodes or re-encodes: the payloads stay LC, and the player
must refuse them on the header alone.

  aac_fixtures.py mp4-he IN OUT
      An MP4 whose audio track's AudioSpecificConfig says explicit HE-AAC (AOT 5, SBR announced)
      instead of AAC-LC. The MP4 is walked box by box and the `esds` descriptor's
      DecoderSpecificInfo (tag 5) replaced; the replacement keeps the config's byte length so no
      box or chunk offset moves.
  aac_fixtures.py adts-profile IN OUT main
      An ADTS stream whose every frame header says AAC Main (profile 0, object type 1) instead of
      LC. Frame payloads are untouched.

Used only by `gen.sh`; the fixtures are committed.
"""

import struct
import sys

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"udta", b"edts", b"dinf"}
DESCRIPTOR_ES = 0x03
DESCRIPTOR_DECODER_CONFIG = 0x04
DESCRIPTOR_DECODER_SPECIFIC = 0x05
# AAC-LC, 24 kHz core, mono, SBR to 48 kHz, then GASpecificConfig's three zero flags, padded to
# the five bytes ffmpeg's encoder wrote for the mono 48 kHz stream.
HE_AAC_CONFIG = bytes([0x2B, 0x09, 0x88, 0x00, 0x00])


def find_box(data, box_type, start=0, end=None):
    """The payload range of the first `box_type` box inside data[start:end]."""
    end = len(data) if end is None else end
    at = start
    while at + 8 <= end:
        size = struct.unpack(">I", data[at:at + 4])[0]
        kind = bytes(data[at + 4:at + 8])
        header = 8
        if size == 1:
            size = struct.unpack(">Q", data[at + 8:at + 16])[0]
            header = 16
        if size < header:
            return None
        if kind == box_type:
            return at + header, at + size
        at += size
    return None


def find_esds(data, start=0, end=None):
    """The esds box's DecoderSpecificInfo (the AudioSpecificConfig) range, or None."""
    end = len(data) if end is None else end
    at = start
    while at + 8 <= end:
        size = struct.unpack(">I", data[at:at + 4])[0]
        kind = bytes(data[at + 4:at + 8])
        header = 8
        if size == 1:
            size = struct.unpack(">Q", data[at + 8:at + 16])[0]
            header = 16
        if size < header:
            return None
        if kind == b"esds":
            return decoder_specific(data, at + header + 4, at + size)
        if kind == b"stsd":
            found = find_in_sample_entries(data, at + header + 8, at + size)
            if found:
                return found
        if kind in CONTAINERS:
            found = find_esds(data, at + header, at + size)
            if found:
                return found
        at += size
    return None


def find_in_sample_entries(data, start, end):
    """An esds inside the sample entries of an stsd box (only sound entries carry one)."""
    at = start
    while at + 8 <= end:
        size = struct.unpack(">I", data[at:at + 4])[0]
        kind = bytes(data[at + 4:at + 8])
        if size < 8 or at + size > end:
            return None
        if kind in (b"mp4a", b"enca"):
            # An audio sample entry: its fixed fields, then the child boxes.
            version = struct.unpack(">H", data[at + 16:at + 18])[0]
            extra = 16 if version == 1 else 36 if version == 2 else 0
            child = at + 8 + 28 + extra
            found = find_esds(data, child, at + size)
            if found:
                return found
        at += size
    return None


def read_length(data, at, end):
    """An MPEG-4 descriptor length: one byte, or 0x80-style four."""
    value = 0
    for i in range(4):
        if at >= end:
            raise ValueError("descriptor length past its box")
        byte = data[at]
        at += 1
        value = (value << 7) | (byte & 0x7F)
        if i == 0 and byte & 0x80 == 0:
            return value, at
    return value, at


def descriptor(data, at, end, tag):
    """Skips `tag`'s header and returns (payload start, payload end, after the descriptor)."""
    if at + 2 > end or data[at] != tag:
        return None
    length, payload = read_length(data, at + 1, end)
    return payload, min(payload + length, end), payload + length


def decoder_specific(data, at, end):
    es = descriptor(data, at, end, DESCRIPTOR_ES)
    if not es:
        return None
    payload, payload_end, _ = es
    payload += 3  # ES_ID (2), flags (1); no dependency or URL flags in what ffmpeg writes
    config = descriptor(data, payload, payload_end, DESCRIPTOR_DECODER_CONFIG)
    if not config:
        return None
    payload, payload_end, _ = config
    payload += 13  # objectTypeIndication, streamType, bufferSizeDB, max/avg bitrate
    specific = descriptor(data, payload, payload_end, DESCRIPTOR_DECODER_SPECIFIC)
    if not specific:
        return None
    return specific[0], specific[1]


def mp4_he(source, target):
    data = bytearray(open(source, "rb").read())
    found = find_esds(data, 0, len(data))
    if not found:
        raise SystemExit(f"{source}: no AudioSpecificConfig in an esds box")
    start, end = found
    if end - start != len(HE_AAC_CONFIG):
        raise SystemExit(
            f"{source}: the config is {end - start} bytes, the HE one is "
            f"{len(HE_AAC_CONFIG)}; rewrite the box sizes for another length"
        )
    data[start:end] = HE_AAC_CONFIG
    open(target, "wb").write(data)
    print(f"{target}: AudioSpecificConfig at {start} says explicit HE-AAC")


def adts_frames(data):
    """(offset, frame length) for every ADTS frame in data."""
    at = 0
    while at + 7 <= len(data):
        if data[at] != 0xFF or data[at + 1] & 0xF6 != 0xF0:
            at += 1
            continue
        length = ((data[at + 3] & 0x03) << 11) | (data[at + 4] << 3) | (data[at + 5] >> 5)
        if length < 7 or at + length > len(data):
            raise SystemExit(f"bad ADTS frame at {at}")
        yield at, length
        at += length


def adts_profile(source, target, profile):
    data = bytearray(open(source, "rb").read())
    frames = 0
    for at, _ in adts_frames(data):
        data[at + 2] = (data[at + 2] & 0x3F) | ((profile & 0x03) << 6)
        frames += 1
    if frames == 0:
        raise SystemExit(f"{source}: no ADTS frames")
    open(target, "wb").write(data)
    print(f"{target}: {frames} ADTS frames with profile {profile}")


def main(argv):
    if len(argv) == 4 and argv[1] == "mp4-he":
        mp4_he(argv[2], argv[3])
    elif len(argv) == 5 and argv[1] == "adts-profile":
        profiles = {"main": 0, "lc": 1, "ssr": 2, "ltp": 3}
        adts_profile(argv[2], argv[3], profiles[argv[4]])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
