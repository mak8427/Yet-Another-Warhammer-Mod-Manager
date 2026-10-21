#!/usr/bin/env python3
"""Create three overlapping PFH5 packs for the M3 conflict demo.

Usage:
    python3 docs/fixtures/make_m3_conflicts.py <output-directory>

The packs contain no playable data. They exist only to exercise file-index
comparison, winner order, and the per-mod override counts.
"""

import struct
import sys
from pathlib import Path


def pack(entries):
    index = bytearray()
    for name, body in entries:
        index += struct.pack("<I", len(body))
        index += b"\x00"
        index += name.encode("utf-8")
        index += b"\x00"

    header = bytearray(28)
    header[0:4] = b"PFH5"
    header[4:8] = struct.pack("<I", 3)
    header[12:16] = struct.pack("<I", 0)
    header[16:20] = struct.pack("<I", len(entries))
    header[20:24] = struct.pack("<I", len(index))
    header[24:28] = struct.pack("<I", 0x7FFFFFFF)
    return bytes(header) + bytes(index) + b"".join(body for _, body in entries)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: make_m3_conflicts.py <output-directory>")
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    shared = "db\\units_tables\\m3_conflict_fixture"
    script = "script\\m3_conflict_fixture.lua"
    for letter in ("a", "b", "c"):
        entries = [
            (shared, letter.encode("ascii")),
            (script, f"-- fixture {letter}\n".encode("ascii")),
        ]
        (output / f"m3_fixture_{letter}.pack").write_bytes(pack(entries))
    print(f"Wrote m3_fixture_a.pack, m3_fixture_b.pack, m3_fixture_c.pack to {output}")


if __name__ == "__main__":
    main()
