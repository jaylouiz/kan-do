#!/usr/bin/env python3
"""Draw the five Kan-Do app icon variants (#263) in VectorCraft, headless.

Each variant is a 1024 px artboard laid out in one row (128 px apart).
Coordinates below are local to an artboard; `ox` shifts them to the document.
Run from this folder (inside the VectorCraft sandbox): python3 -I build_variants.py
Then ./contact_sheet.sh. Copy the results to docs/design/app-icon/ in the repo.
"""
import json
import os
import subprocess
from pathlib import Path

# VectorCraft CLI of an ArtCraft checkout (maintainer tooling): $ARTCRAFT_HOME, default ~/dev-workspace/artcraft.
ARTCRAFT_HOME = Path(os.environ.get("ARTCRAFT_HOME") or Path.home() / "dev-workspace/artcraft")
CLI = str(ARTCRAFT_HOME / "bin/vectorcraft-cli")
HERE = Path(__file__).resolve().parent
STEP = 1024 + 128


def oklch(L, C, H):
    import math
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    rgb = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)

    def enc(x):
        x = 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
        return round(min(1, max(0, x)) * 255)
    return "#" + "".join(f"{enc(c):02X}" for c in rgb)


# DESIGN.md tokens
PAPER, SHEET, RULE, STONE300, PENCIL, GRAPHITE, INK_BLACK = (
    "#F5F5F4", "#FAFAF9", "#E7E5E4", "#D6D3D1", "#A8A29E", "#68625C", "#1C1917")
INK = {k: oklch(*v) for k, v in {
    50: (0.97, 0.013, 255), 100: (0.93, 0.027, 255), 200: (0.86, 0.050, 255),
    300: (0.77, 0.072, 255), 400: (0.66, 0.085, 255), 500: (0.52, 0.090, 255),
    600: (0.45, 0.085, 255), 700: (0.39, 0.076, 255)}.items()}
TEAL_500 = "#4CBDA8"

cmds = []


def cmd(cid, params=None):
    cmds.append((cid, params or {}))


def paint(fill=None, stroke=None, weight=None, cap="round", join="round"):
    cmd("paint.setFill", {"color": fill} if fill else {"none": True})
    if stroke:
        cmd("paint.setStroke", {"color": stroke})
        cmd("stroke.set", {"weight": weight, "cap": cap, "join": join})
    else:
        cmd("paint.setStroke", {"none": True})


def shadow(opacity, y, blur):
    cmd("effect.apply", {"effect": "stylize.dropShadow", "params": {
        "mode": "multiply", "opacity": opacity, "x": 0, "y": y, "blur": blur,
        "shade": "color", "color": INK_BLACK}})


def rect(ox, x, y, w, h, r, **kw):
    cmd("shape.rectangle", {"x": ox + x, "y": y, "width": w, "height": h, "radius": r})
    paint(**kw)


def ellipse(ox, cx, cy, r, **kw):
    cmd("shape.ellipse", {"x": ox + cx - r, "y": cy - r, "width": 2 * r, "height": 2 * r})
    paint(**kw)


def path(ox, pts, **kw):
    cmd("path.create", {"anchors": [{"x": ox + x, "y": y} for x, y in pts], "closed": False})
    paint(**kw)


def body(ox, fill):
    """macOS icon template: 824 px rounded square, 100 px margin, soft shadow."""
    rect(ox, 100, 100, 824, 824, 185, fill=fill)
    shadow(opacity=30, y=10, blur=22)


def sheet_stack(ox, back2, back1, front, edge, title, line):
    """One bright sheet in front, two stacked sheets peeking out behind."""
    rect(ox, 312, 268, 400, 300, 44, fill=back2)
    rect(ox, 272, 318, 480, 300, 50, fill=back1)
    if edge:
        rect(ox, 222, 380, 580, 330, 60, fill=front, stroke=edge, weight=16)
    else:
        rect(ox, 222, 380, 580, 330, 60, fill=front)
    shadow(opacity=16, y=8, blur=16)
    rect(ox, 290, 468, 330, 44, 22, fill=title)
    rect(ox, 290, 548, 210, 36, 18, fill=line)
    ellipse(ox, 720, 490, 34, stroke=edge or title, weight=14)


def a1(ox):  # One Sheet on paper: the Jetzt card with its ink edge
    body(ox, PAPER)
    sheet_stack(ox, RULE, STONE300, "#FFFFFF", INK[500], INK_BLACK, PENCIL)


def a2(ox):  # One Sheet on ink: the lamp is the whole body
    body(ox, INK[500])
    sheet_stack(ox, INK[300], INK[200], SHEET, None, INK[700], INK[200])


def b(ox):  # Four columns, one lit (WIP 1 in Jetzt)
    body(ox, PAPER)
    x0, w, gap, top = 212, 120, 40, 340
    cols = [  # (card heights, colour)
        ([96, 96, 96], STONE300),
        ([216], INK[500]),
        ([96, 96], STONE300),
        ([96, 96], RULE),
    ]
    for i, (heights, colour) in enumerate(cols):
        y = top
        for h in heights:
            rect(ox, x0 + i * (w + gap), y, w, h, 30, fill=colour)
            y += h + 28


def c1(ox):  # K whose arms are a check: "Kan-Do" = can do
    body(ox, INK[500])
    rect(ox, 282, 262, 104, 500, 14, fill=SHEET)
    path(ox, [(326, 429), (500, 640), (736, 286)], stroke=SHEET, weight=104,
         cap="butt", join="round")


def c2(ox):  # Timebox ring that closes into done (the one teal hint)
    body(ox, SHEET)
    ellipse(ox, 512, 512, 228, stroke=INK[100], weight=76)
    cmd("path.create", {"d": f"M {ox + 512} 284 A 228 228 0 1 1 {ox + 284} 512"})
    paint(stroke=INK[500], weight=76)
    path(ox, [(430, 516), (492, 578), (598, 452)], stroke=TEAL_500, weight=58)


VARIANTS = [("A1-one-sheet-paper", a1), ("A2-one-sheet-ink", a2),
            ("B-four-columns", b), ("C1-k-check", c1), ("C2-timebox-ring", c2)]


def main():
    cmd("file.new", {"name": "kan-do-app-icon", "width": 1024, "height": 1024,
                     "units": "Pixels", "artboards": len(VARIANTS),
                     "artboardLayout": {"layout": "row", "spacing": 128}})
    for i, (name, draw) in enumerate(VARIANTS):
        cmd("artboard.setProps", {"index": i, "name": name})
        cmd("select.none")
        draw(i * STEP)
        cmd("select.none")
    args = [CLI, "run"]
    for cid, params in cmds:
        args += ["--cmd", cid, "--params", json.dumps(params)]
    args += ["--export", "kan-do-app-icon.vectorcraft"]
    out = subprocess.run(args, cwd=HERE, capture_output=True, text=True)
    errors = [line for line in out.stdout.splitlines() if '"error"' in line]
    print(f"{len(cmds)} steps, rc={out.returncode}, errors={len(errors)}")
    for line in errors[:10]:
        print(line)
    print(out.stderr[-2000:])
    for i, (name, _) in enumerate(VARIANTS):
        for ext in ("svg", "png"):
            subprocess.run([CLI, "convert", "kan-do-app-icon.vectorcraft",
                            f"variants/{name}.{ext}", "--artboard", str(i)],
                           cwd=HERE, check=True, capture_output=True)


if __name__ == "__main__":
    main()
