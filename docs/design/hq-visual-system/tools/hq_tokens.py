#!/usr/bin/env python3
"""Build and check the HQ visual-system token artifacts.

    python3 -I tools/hq_tokens.py build   # rewrite tokens/hq-tokens.css and tokens/contrast-report.md
    python3 -I tools/hq_tokens.py check   # fail unless both outputs are current and every contrast pair passes

Run from docs/design/hq-visual-system. Standard library only.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tokens" / "hq-tokens.json"
CSS_OUT = ROOT / "tokens" / "hq-tokens.css"
REPORT_OUT = ROOT / "tokens" / "contrast-report.md"
MODES = ("light", "dark")
REF = re.compile(r"^\{([a-z0-9-]+)\}$")
HEX = re.compile(r"^#([0-9a-fA-F]{6})$")
RGBA = re.compile(r"^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\s*\)$")


class TokenError(Exception):
    pass


def parse_color(value: str) -> tuple[float, float, float, float]:
    if m := HEX.match(value):
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    if m := RGBA.match(value):
        r, g, b, a = (float(x) for x in m.groups())
        if not (0 <= a <= 1 and all(0 <= c <= 255 for c in (r, g, b))):
            raise TokenError(f"colour out of range: {value}")
        return (r, g, b, a)
    raise TokenError(f"unsupported colour syntax: {value}")


def composite(top, bottom):
    if bottom[3] != 1.0:
        raise TokenError("composite base must be opaque")
    a = top[3]
    return tuple(top[i] * a + bottom[i] * (1 - a) for i in range(3)) + (1.0,)


def luminance(rgb) -> float:
    def channel(c: float) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg) -> float:
    l1, l2 = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def load() -> dict:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    for name, token in data["color"].items():
        missing = [m for m in MODES if m not in token]
        if missing:
            raise TokenError(f"color.{name} lacks modes {missing}")
        for m in MODES:
            parse_color(token[m])
    for name, token in data["shadow"].items():
        if any(m not in token for m in MODES):
            raise TokenError(f"shadow.{name} lacks a mode")
    for name, token in data["invariant"].items():
        if set(token) - {"value", "use"} or "value" not in token:
            raise TokenError(f"invariant.{name} must have exactly one value for every mode")
    for name, ref in data["component"].items():
        m = REF.match(ref)
        if not m or m.group(1) not in data["color"]:
            raise TokenError(f"component.{name} references unknown colour role {ref}")
    return data


def resolve(data: dict, expr: str, mode: str):
    """Resolve 'role' or 'role@base' (role composited over an opaque base)."""
    top, _, base = expr.partition("@")
    colour = parse_color(data["color"][top][mode])
    if base:
        colour = composite(colour, resolve(data, base, mode))
    elif colour[3] != 1.0:
        raise TokenError(f"translucent role {top} needs an explicit @base in contrast pairs")
    return colour


def contrast_rows(data: dict):
    rows = []
    for pair in data["contrast"]:
        for on in pair["on"]:
            for mode in MODES:
                fg = resolve(data, pair["fg"], mode) if "@" in pair["fg"] else composite(parse_color(data["color"][pair["fg"]][mode]), resolve(data, on, mode))
                bg = resolve(data, on, mode)
                value = ratio(fg, bg)
                rows.append((pair["fg"], on, mode, value, pair["min"], value + 1e-9 >= pair["min"]))
    return rows


def css(data: dict) -> str:
    p = data["meta"]["cssPrefix"]
    out = [
        "/* HQ visual-system tokens. Generated from hq-tokens.json by tools/hq_tokens.py build; edit the JSON, not this file.",
        "   Scheme: the shell writes its resolved theme to <html data-theme=\"light|dark\">. Without the attribute the OS preference",
        "   applies. Colour roles are light-dark() pairs, so a [data-theme] subtree resolves its own scheme. */",
        "",
        ":root { color-scheme: light dark; }",
        "[data-theme=\"light\"] { color-scheme: light; }",
        "[data-theme=\"dark\"] { color-scheme: dark; }",
        "",
        ":root {",
    ]
    out.append("  /* Colour roles: light-dark(light, dark) */")
    for name, t in data["color"].items():
        out.append(f"  --{p}-{name}: light-dark({t['light']}, {t['dark']});")
    out.append("")
    out.append("  /* Invariant: identical in every chrome theme. Never wrap these in light-dark(). */")
    for name, t in data["invariant"].items():
        out.append(f"  --{p}-{name}: {t['value']};")
    out.append("")
    out.append("  /* Typography */")
    for name, t in data["font"].items():
        out.append(f"  --{p}-font-{name}: {t['value']};")
    for name, t in data["type"].items():
        fam = f"var(--{p}-font-family-{t['family']})"
        out.append(f"  --{p}-type-{name}: {t['weight']} {t['size']}/{t['line']} {fam};")
        out.append(f"  --{p}-type-{name}-tracking: {t['tracking']};")
    out.append("")
    out.append("  /* Space, radius, size */")
    for name, v in data["space"].items():
        out.append(f"  --{p}-space-{name}: {v};")
    for name, v in data["radius"].items():
        out.append(f"  --{p}-radius-{name}: {v};")
    for name, v in data["size"].items():
        out.append(f"  --{p}-size-{name}: {v};")
    out.append("")
    out.append("  /* Motion and layering */")
    for name, v in data["motion"].items():
        out.append(f"  --{p}-{name}: {v};")
    for name, v in data["z"].items():
        out.append(f"  --{p}-z-{name}: {v};")
    out.append("")
    out.append("  /* Component roles */")
    for name, ref in data["component"].items():
        out.append(f"  --{p}-{name}: var(--{p}-{REF.match(ref).group(1)});")
    out.append("}")
    out.append("")
    out.append("/* Component roles resolve where they are declared. A [data-hq-token-scope] subtree that sets its own colour roles,")
    out.append("   such as a palette preview, re-declares them so its buttons and selection use the local colours. */")
    out.append("[data-hq-token-scope] {")
    for name, ref in data["component"].items():
        out.append(f"  --{p}-{name}: var(--{p}-{REF.match(ref).group(1)});")
    out.append("}")
    out.append("")
    out.append("/* Shadows cannot use light-dark(); they follow the same scheme selection explicitly. */")

    def shadows(mode: str) -> list[str]:
        return [f"  --{p}-shadow-{n}: {t[mode]};" for n, t in data["shadow"].items()]

    out += [":root, [data-theme=\"light\"] {", *shadows("light"), "}"]
    out += ["@media (prefers-color-scheme: dark) {", "  :root:not([data-theme=\"light\"]) {",
            *("  " + line for line in shadows("dark")), "  }", "}"]
    out += ["[data-theme=\"dark\"] {", *shadows("dark"), "}"]
    out += [
        "",
        "@media (prefers-reduced-motion: reduce) {",
        f"  :root {{ --{p}-duration-fast: 0ms; --{p}-duration-base: 0ms; --{p}-duration-slow: 0ms; }}",
        "}",
        "",
        "/* Preserved content (spec RS-2 marker data-hq-content=\"captured\" | \"producer\" | \"export\"): captured screenshots,",
        "   exported evidence, artwork and producer previews. Chrome theme must not reach these pixels. The owner sets",
        "   --hq-content-scheme from the content's recorded theme (light | dark); the default 'normal' keeps the HQ chrome",
        "   theme from reaching an embedded document. data-hq-matte=\"checker\" shows transparency on a fixed grid. */",
        "[data-hq-content] {",
        f"  color-scheme: var(--{p}-content-scheme, normal);",
        f"  background: var(--{p}-artwork-matte);",
        "  forced-color-adjust: none;",
        "  filter: none;",
        "  mix-blend-mode: normal;",
        "  opacity: 1;",
        "}",
        "[data-hq-content] > img, [data-hq-content] > iframe, [data-hq-content] > canvas, [data-hq-content] > video {",
        "  display: block; filter: none; mix-blend-mode: normal; opacity: 1;",
        "}",
        "[data-hq-content][data-hq-matte=\"checker\"] {",
        f"  background-color: var(--{p}-artwork-checker-b);",
        f"  background-image: conic-gradient(var(--{p}-artwork-checker-a) 25%, var(--{p}-artwork-checker-b) 0 50%, var(--{p}-artwork-checker-a) 0 75%, var(--{p}-artwork-checker-b) 0);",
        f"  background-size: calc(2 * var(--{p}-artwork-checker-size)) calc(2 * var(--{p}-artwork-checker-size));",
        "}",
        "",
    ]
    return "\n".join(out)


def report(data: dict, rows) -> str:
    lines = [
        "# HQ token contrast report",
        "",
        "Generated by `tools/hq_tokens.py build` from `hq-tokens.json`. WCAG 2.x relative-luminance ratios;",
        "`role@base` means a translucent role composited over an opaque base. Text pairs require 4.5:1,",
        "focus rings, indicators and control boundaries 3:1. `text-disabled` is intentionally exempt.",
        "",
        "| Foreground | Background | Mode | Ratio | Minimum | Result |",
        "| --- | --- | --- | ---: | ---: | --- |",
    ]
    for fg, on, mode, value, minimum, ok in rows:
        lines.append(f"| `{fg}` | `{on}` | {mode} | {value:.2f} | {minimum:.1f} | {'pass' if ok else 'FAIL'} |")
    failures = sum(1 for r in rows if not r[5])
    lines += ["", f"{len(rows)} pairs checked, {failures} below minimum.", ""]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"build", "check"}:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        data = load()
        rows = contrast_rows(data)
    except (TokenError, KeyError, ValueError) as exc:
        print(f"token error: {exc}", file=sys.stderr)
        return 1
    expected_css, expected_report = css(data), report(data, rows)
    failures = [r for r in rows if not r[5]]
    if argv[1] == "build":
        CSS_OUT.write_text(expected_css, encoding="utf-8")
        REPORT_OUT.write_text(expected_report, encoding="utf-8")
        print(f"wrote {CSS_OUT.name} and {REPORT_OUT.name}; {len(rows)} contrast pairs, {len(failures)} failing")
        for fg, on, mode, value, minimum, _ in failures:
            print(f"  FAIL {fg} on {on} ({mode}): {value:.2f} < {minimum}")
        return 1 if failures else 0
    stale = [p.name for p, text in ((CSS_OUT, expected_css), (REPORT_OUT, expected_report))
             if not p.exists() or p.read_text(encoding="utf-8") != text]
    for name in stale:
        print(f"stale generated file: {name} (run build)", file=sys.stderr)
    for fg, on, mode, value, minimum, _ in failures:
        print(f"contrast FAIL {fg} on {on} ({mode}): {value:.2f} < {minimum}", file=sys.stderr)
    if stale or failures:
        return 1
    print(f"ok: {len(data['color'])} colour roles x {len(MODES)} modes, {len(data['invariant'])} invariants, "
          f"{len(data['component'])} component roles, {len(rows)} contrast pairs pass; generated files current")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
