#!/usr/bin/env python3
"""Check the rendered evidence for the HQ chrome/artwork invariants and write evidence/manifest.json.

    python3 -I tools/compare_regions.py

Run from docs/design/hq-visual-system after tools/render.sh evidence. Standard library only.

Checks (all must pass):
  1. artwork page: each preserved well has identical pixels in light and dark chrome;
  2. design page: each preserved well has identical pixels in the dark and light screenshots;
  2b. artwork page: the 1:1 landing wells equal the source PNG's own pixels (no recolouring or resampling);
  3. System appearance: OS-dark render equals explicit Dark, OS-light render equals explicit Light (whole image
     except the appearance control, which correctly shows "System" instead of the explicit choice);
  4. negative control: the chrome itself does differ between the dark and light design screenshots,
     so checks 1-2 are not passing because the crops are blind.
Crops are inset past the wells' rounded corners, where the surrounding chrome legitimately shows through.
"""
from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "evidence"
INSET = 6  # > --hq-radius-sm (5px) plus antialiasing


class Image:
    def __init__(self, path: Path):
        data = path.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"{path.name}: not a PNG")
        pos, idat, header = 8, bytearray(), None
        while pos < len(data):
            length, kind = struct.unpack(">I4s", data[pos:pos + 8])
            chunk = data[pos + 8:pos + 8 + length]
            pos += 12 + length
            if kind == b"IHDR":
                header = struct.unpack(">IIBBBBB", chunk)
            elif kind == b"IDAT":
                idat += chunk
            elif kind == b"IEND":
                break
        width, height, depth, colour, _, _, interlace = header
        if depth != 8 or colour not in (2, 6) or interlace:
            raise ValueError(f"{path.name}: unsupported PNG layout (depth {depth}, colour {colour}, interlace {interlace})")
        bpp = 4 if colour == 6 else 3
        raw, stride = zlib.decompress(bytes(idat)), width * bpp
        rows, prev, i = [], bytearray(stride), 0
        for _ in range(height):
            f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
            i += 1 + stride
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                if f == 1: line[x] = (line[x] + a) & 255
                elif f == 2: line[x] = (line[x] + b) & 255
                elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
                elif f == 4:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
            rows.append(bytes(line))
            prev = line
        self.width, self.height, self.bpp, self.rows = width, height, bpp, rows

    def crop_digest(self, x0: int, y0: int, x1: int, y1: int, exclude=None) -> str:
        if not (0 <= x0 < x1 <= self.width and 0 <= y0 < y1 <= self.height):
            raise ValueError(f"crop {x0},{y0},{x1},{y1} outside {self.width}x{self.height}")
        h = hashlib.sha256()
        for y, row in enumerate(self.rows[y0:y1], start=y0):
            for x in range(x0, x1):  # normalise to RGB so RGB/RGBA encodings compare
                if exclude and exclude[0] <= x < exclude[2] and exclude[1] <= y < exclude[3]:
                    continue
                h.update(row[x * self.bpp:x * self.bpp + 3])
        return h.hexdigest()


def inner(rect):
    x, y, w, h = rect
    return (math.ceil(x) + INSET, math.ceil(y) + INSET, math.floor(x + w) - INSET, math.floor(y + h) - INSET)


def layout(name: str) -> dict:
    data = json.loads((EVIDENCE / "layout" / f"{name}.json").read_text(encoding="utf-8"))
    if data.get("hqEvidence") != 1:
        raise ValueError(f"layout/{name}.json has no evidence payload")
    return data


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    checks, cache = [], {}

    def img(name):
        if name not in cache:
            cache[name] = Image(EVIDENCE / f"{name}.png")
        return cache[name]

    def record(check, ok, detail):
        checks.append({"check": check, "pass": ok, **detail})

    # 1. artwork page: light half vs dark half, same well, translated by an integer offset.
    art = layout("artwork-invariance-1440")
    for well in ("well-light", "well-dark", "well-mark"):
        a, b = art["rects"][f"light:{well}"], art["rects"][f"dark:{well}"]
        same_geometry = a[2:] == b[2:] and a[1] == b[1] and float(b[0] - a[0]).is_integer()
        da = img("artwork-invariance-1440").crop_digest(*inner(a))
        db = img("artwork-invariance-1440").crop_digest(*inner(b))
        record(f"artwork page {well}: light chrome == dark chrome", same_geometry and da == db,
               {"crop_light": inner(a), "crop_dark": inner(b), "sha256_light": da, "sha256_dark": db})

    # 2b. 1:1 wells on the artwork page reproduce the source asset's top-left pixels exactly.
    for well, asset in (("well-light", "larkspur-landing-light.png"), ("well-dark", "larkspur-landing-dark.png")):
        source = Image(ROOT / "mockups" / "assets" / asset)
        for side in ("light", "dark"):
            x, y, w, h = art["rects"][f"{side}:{well}"]
            if not (float(x).is_integer() and float(y).is_integer()):
                record(f"artwork page {well} in {side} chrome == source {asset}", False, {"reason": "fractional well origin"})
                continue
            box = inner((x, y, w, h))
            shown = img("artwork-invariance-1440").crop_digest(*box)
            original = source.crop_digest(INSET, INSET, box[2] - box[0] + INSET, box[3] - box[1] + INSET)
            record(f"artwork page {well} in {side} chrome == source {asset}", shown == original,
                   {"crop": box, "sha256_shown": shown, "sha256_source": original})

    # 2. design page: dark screenshot vs light screenshot.
    dark, light = layout("design-dark-1280"), layout("design-light-1280")
    for well in ("well-light", "well-dark", "well-mark"):
        if dark["rects"][well] != light["rects"][well]:
            record(f"design page {well}: dark == light", False, {"reason": "layout differs between themes"})
            continue
        box = inner(dark["rects"][well])
        dd, dl = img("design-dark-1280").crop_digest(*box), img("design-light-1280").crop_digest(*box)
        record(f"design page {well}: dark chrome == light chrome", dd == dl, {"crop": box, "sha256_dark": dd, "sha256_light": dl})

    # 3. System appearance follows the OS and renders exactly like the explicit choice.
    for os_mode, explicit in (("dark", "design-dark-1280"), ("light", "design-light-1280")):
        name = f"design-system-os-{os_mode}-1280"
        data = layout(name)
        resolved, control = data["theme"], data["rects"]["appearance-control"]
        if control != layout(explicit)["rects"]["appearance-control"]:
            record(f"System with OS {os_mode} renders as explicit {os_mode}", False, {"reason": "appearance control moved"})
            continue
        mask = (math.floor(control[0]) - 2, math.floor(control[1]) - 2, math.ceil(control[0] + control[2]) + 2, math.ceil(control[1] + control[3]) + 2)
        a, b = img(name), img(explicit)
        same = (a.width, a.height) == (b.width, b.height) and \
            a.crop_digest(0, 0, a.width, a.height, mask) == b.crop_digest(0, 0, b.width, b.height, mask)
        record(f"System with OS {os_mode} renders as explicit {os_mode}", same and resolved == os_mode,
               {"resolved_theme": resolved, "pixels_identical_outside_control": same, "masked": mask})

    # 4. Negative control: the titlebar strip must differ between themes.
    strip = (200, 4, 900, 36)
    cd, cl = img("design-dark-1280").crop_digest(*strip), img("design-light-1280").crop_digest(*strip)
    record("negative control: chrome differs between dark and light", cd != cl, {"crop": strip})

    fonts = {p.stem: json.loads(p.read_text(encoding="utf-8")).get("fonts") for p in sorted((EVIDENCE / "layout").glob("*.json"))}
    manifest = {
        "schema": "hq-visual-evidence/v1",
        "authority_effect": "none",
        "generator": "tools/render.sh evidence; tools/compare_regions.py",
        "renderer": "headless Chromium, device scale factor 1",
        "plex_fonts_loaded": fonts,
        "checks": checks,
        "files": {p.name: sha(p) for p in sorted(EVIDENCE.glob("*.png"))},
        "artwork": {p.name: sha(p) for p in sorted((ROOT / "mockups" / "assets").glob("*.png"))},
    }
    (EVIDENCE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    failed = [c for c in checks if not c["pass"]]
    for c in checks:
        print(("pass  " if c["pass"] else "FAIL  ") + c["check"])
    print(f"{len(checks) - len(failed)}/{len(checks)} checks pass; wrote evidence/manifest.json")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
