// First-run onboarding — paged welcome tour, Amp-style.
// Auto-runs once on bare `scrollback` in a TTY; replay via `scrollback onboarding`.
// Marker: <state-root>/onboarded (state root = SCROLLBACK_STATE_ROOT or ~/.scrollback).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { envRoots, HOME, VERSION } from "./util.ts";
import { countSessions } from "./commands.ts";

// ---------- marker ----------

export function stateDir(root?: string): string {
  return root || envRoots("state")[0] || join(HOME, ".scrollback");
}

export function markerPath(root?: string): string {
  return join(stateDir(root), "onboarded");
}

export function hasOnboarded(root?: string): boolean {
  return existsSync(markerPath(root));
}

export function writeOnboarded(root?: string): void {
  const dir = stateDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(markerPath(root), `${VERSION} ${new Date().toISOString()}\n`);
}

/** Bare `scrollback` may auto-run the tour: interactive terminal only, once. */
export function shouldAutorun(): boolean {
  return (
    !!process.stdout.isTTY &&
    !!process.stdin.isTTY &&
    !process.env.CI &&
    process.env.TERM !== "dumb" &&
    !hasOnboarded()
  );
}

// ---------- the mark: a scroll unwinding into a stream ----------
// Archimedean spiral (rolled-up history) exiting at the top into a
// horizontal tail (the live scrollback buffer). Drawn in braille dots,
// colored along the path: dim at the wound-up center, bright at the tail.

const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

const CX = 20,
  CY = 20,
  R = 17,
  TURNS = 2.6,
  TAIL = 30;

export const MARKS = ["spiral", "terminal", "scroll", "wall"] as const;
export type MarkId = (typeof MARKS)[number];

// [x, y, brightness 0..1, roll-tag?] — the tag marks reveal-stand-in points the
// procedural flow replaces once the reveal completes
type Pt = [number, number, number, number?];

interface MarkSpec {
  pts: Pt[];
  /** Document-flow scroll for this mark's interior, in braille-cell rows:
   *  window = cell rows [top, bot); lines render at cell*4+sub; pool[i] = line
   *  length for document row i (0 = blank). Rows scroll down: pooled lines
   *  enter under the roller at `top`, sink, and exit at `bot`. */
  flow?: {
    tx: number;
    top: number;
    bot: number;
    sub: number;
    pool: number[];
  };
}

// shape helpers — every list is in draw order, so the reveal animation
// strokes structure first, text next, accents last
const rect = (x0: number, y0: number, x1: number, y1: number, t: number): Pt[] => {
  const p: Pt[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.push([x, y, t]);
  return p;
};
const hline = (x0: number, x1: number, y: number, t: number): Pt[] => rect(x0, y, x1, y, t);
const vline = (x: number, y0: number, y1: number, t: number): Pt[] => rect(x, y0, x, y1, t);

/** Tag points as reveal-only content: drawn during the reveal at their baked
 *  positions, then replaced by the spec's procedural flow once it's done. */
const roll = (ps: Pt[]): Pt[] => ps.map(([x, y, t]) => [x, y, t, 1]);

const DIM = 0.25,
  GOLD = 0.75,
  BRIGHT = 1;

function spiralPoints(): MarkSpec {
  const pts: [number, number][] = [];
  const TH = TURNS * 2 * Math.PI;
  // inner -> outer: angle = -PI/2 - u, radius shrinks to 0 at the center
  for (let u = TH; u >= 0; u -= 0.03) {
    const a = -Math.PI / 2 - u;
    const r = R * (1 - u / TH);
    pts.push([CX + r * Math.cos(a), CY + r * Math.sin(a)]);
  }
  for (let x = CX + 1; x <= CX + TAIL; x++) pts.push([x, CY - R]);
  return { pts: pts.map(([x, y], i) => [x, y, i / (pts.length - 1)]) };
}

function terminalPoints(): MarkSpec {
  const p: Pt[] = [];
  const x0 = 6,
    y0 = 4,
    x1 = 58,
    y1 = 36,
    r = 4;
  // rounded-rect window border
  p.push(...hline(x0 + r, x1 - r, y0, DIM), ...hline(x0 + r, x1 - r, y1, DIM));
  p.push(...vline(x0, y0 + r, y1 - r, DIM), ...vline(x1, y0 + r, y1 - r, DIM));
  for (const [cx, cy, a0] of [
    [x0 + r, y0 + r, Math.PI],
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
  ])
    for (let a = a0; a < a0 + Math.PI / 2; a += 0.15)
      p.push([cx + r * Math.cos(a), cy + r * Math.sin(a), DIM]);
  // traffic-light hint
  p.push([x0 + 6, y0 + 4, DIM], [x0 + 10, y0 + 4, DIM], [x0 + 14, y0 + 4, DIM]);
  // text lines
  const tx = x0 + 6;
  [34, 22, 30, 14, 26].forEach((len, i) => {
    p.push(...hline(tx, tx + len, y0 + 8 + i * 5, GOLD));
  });
  // scrollbar: dim track + bright thumb pinned at the top = scrolled back
  const sx = x1 - 5;
  p.push(...vline(sx, y0 + 4, y1 - 4, DIM));
  p.push(...rect(sx - 1, y0 + 4, sx + 1, y0 + 12, BRIGHT));
  return { pts: p };
}

function scrollPoints(): MarkSpec {
  const p: Pt[] = [];
  const cx = 33,
    top = 7,
    bot = 33,
    half = 21;
  for (const ry of [top, bot]) {
    p.push(...rect(cx - half, ry, cx + half, ry + 1, DIM));
    for (const kx of [cx - half - 2, cx + half + 2]) p.push(...rect(kx, ry - 1, kx + 1, ry + 2, GOLD));
  }
  p.push(...vline(cx - half + 2, top + 2, bot - 1, DIM));
  p.push(...vline(cx + half - 2, top + 2, bot - 1, DIM));
  const tx = cx - half + 6;
  [28, 20, 26, 12].forEach((len, i) => {
    p.push(...hline(tx, tx + len, top + 6 + i * 5, GOLD));
  });
  return { pts: p };
}

function wallPoints(): MarkSpec {
  const p: Pt[] = [];
  const cx = 34,
    top = 5,
    half = 22;
  // top roller + knobs
  p.push(...rect(cx - half, top, cx + half, top + 2, DIM));
  for (const kx of [cx - half - 2, cx + half + 2]) p.push(...rect(kx, top - 1, kx + 1, top + 3, GOLD));
  // hanging sheet
  const sy0 = top + 3,
    sy1 = 34;
  p.push(...vline(cx - half + 3, sy0, sy1, DIM), ...vline(cx + half - 3, sy0, sy1, DIM));
  p.push(...hline(cx - half + 3, cx + half - 3, sy1, DIM));
  // text lines flow downward through the sheet — the scroll unrolling off
  // the top roller. Baked at cell-aligned rows (cell*4+sub) so the flow
  // handoff is seamless.
  const tx = cx - half + 8;
  [[26, 3], [18, 4], [24, 6], [10, 7]].forEach(([len, cell]) => {
    p.push(...roll(hline(tx, tx + len, cell * 4 + 2, GOLD)));
  });
  // bottom weight bar
  p.push(...rect(cx - half + 1, sy1 + 2, cx + half - 1, sy1 + 3, DIM));
  // flow window = interior cell rows [2,8): lines enter under the roller at
  // cell 2, sink, and exit just above the bottom edge at cell 7. pool[i]
  // gives document row i's line length (0 = blank); at offset 0 exactly the
  // four baked rows (cells 3,4,6,7) show — no pop when the flow takes over.
  return {
    pts: p,
    flow: {
      tx,
      top: 2,
      bot: 8,
      sub: 2,
      pool: [22, 0, 0, 26, 18, 0, 24, 10],
    },
  };
}

function markPoints(id: string): MarkSpec {
  switch (id) {
    case "terminal":
      return terminalPoints();
    case "scroll":
      return scrollPoints();
    case "wall":
      return wallPoints();
    default:
      return spiralPoints();
  }
}

export function ramp(t: number): [number, number, number] {
  return [
    Math.round(90 + 165 * t),
    Math.round(55 + 160 * t),
    Math.round(20 + 70 * t),
  ];
}

/** Braille lines for a mark. fraction in [0,1] reveals points in draw order.
 *  Once fully revealed, scrollOff flows the mark's document downward through
 *  its cell-row window — pooled lines enter under the roller, exit at bottom. */
export function markLines(
  fraction = 1,
  color: "true" | "basic" | "none" = "true",
  mark: MarkId | string = "wall",
  scrollOff = 0,
): string[] {
  const spec = markPoints(mark);
  const all = spec.pts;
  const pts = all.slice(0, Math.max(1, Math.ceil(all.length * fraction)));
  // bounds come from the full point set so the reveal plays in a fixed box —
  // otherwise everything below slides down as the mark grows
  const maxX = Math.max(...all.map((p) => p[0]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const W = Math.ceil((maxX + 1) / 2);
  const H = Math.ceil((maxY + 1) / 4);
  const grid = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => ({ b: 0, p: -1 })),
  );
  const set = (xi: number, yi: number, t: number) => {
    const cell = grid[yi >> 2][xi >> 1];
    cell.b |= DOTS[yi & 3][xi & 1];
    cell.p = Math.max(cell.p, t);
  };
  pts.forEach(([x, y, t, s]) => {
    // tagged (roll) points are reveal stand-ins: at full reveal the flow
    // renders the document rows they sat on, so they hand off seamlessly
    if (s && fraction >= 1) return;
    set(Math.round(x), Math.round(y), t);
  });
  if (fraction >= 1 && spec.flow) {
    const { tx, top, bot, sub, pool } = spec.flow;
    const P = pool.length;
    // document row i displays at cell i + scrollOff; only rows inside the
    // window render — lines enter under the roller at `top`, exit at `bot`
    for (let i = top - scrollOff; i + scrollOff < bot; i++) {
      const len = pool[((i % P) + P) % P];
      if (!len) continue;
      const y = (i + scrollOff) * 4 + sub;
      for (let x = tx; x < tx + len; x++) set(x, y, GOLD);
    }
  }
  return grid.map((row) =>
    row
      .map((c) => {
        if (c.p < 0) return " ";
        const ch = String.fromCodePoint(0x2800 + c.b);
        if (color === "none") return ch;
        if (color === "basic") return `\x1b[33m${ch}\x1b[0m`;
        const [r, g, b] = ramp(c.p);
        return `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
      })
      .join(""),
  );
}

// ---------- pages ----------

export interface OnboardStats {
  sources: { id: string; n: number }[];
  total: number;
}

export function gatherStats(): OnboardStats {
  const counts = countSessions().filter((c) => c.roots.length);
  return {
    sources: counts.map((c) => ({ id: c.id, n: c.n })),
    total: counts.reduce((a, c) => a + c.n, 0),
  };
}

export interface Page {
  title: string;
  body: [string, string][]; // [accent-left, dim-right] pairs
}

export function pages(stats: OnboardStats | null, rows = 24): Page[] {
  const cap = Math.max(3, rows - 18); // body starts row 14, footer needs 3
  const sorted = stats ? [...stats.sources].sort((a, b) => b.n - a.n) : [];
  const shown = sorted.slice(0, sorted.length > cap ? cap - 1 : cap); // -1: room for "+N more"
  const scanBody: [string, string][] = shown.map((s) => [
    s.id,
    `${s.n} session${s.n === 1 ? "" : "s"}`,
  ]);
  if (sorted.length > shown.length)
    scanBody.push(["", `+${sorted.length - shown.length} more — \`scrollback doctor\` shows them all`]);
  if (stats) scanBody.push(["", `${stats.total} sessions readable — no index, no sync, no upload`]);
  const scan: Page = stats
    ? sorted.length
      ? {
          title: `${sorted.length} agent${sorted.length > 1 ? "s'" : "'s"} history found on this machine`,
          body: scanBody,
        }
      : {
          title: "No agent history found yet",
          body: [
            ["", "scrollback reads the history files your agents already keep —"],
            ["", "run claude, codex, kimi & friends and they show up here"],
          ],
        }
    : {
        title: "Scanning your agents…",
        body: [["", "reading local history files"]],
      };

  return [
    {
      title: "Welcome to Scrollback",
      body: [["", "Unified memory layer across agents"]],
    },
    {
      title: "Recall anything you've discussed",
      body: [
        ['"hey claude, what color did I pick earlier in codex?"', ""],
        ['scrollback search "dark mode" --codex', ""],
        ['"You picked dark mode in session a3f2"', ""],
      ],
    },
    scan,
    {
      title: "More than recall — agents working for each other",
      body: [
        ['scrollback channel send <ch> "<msg>"', "message another agent's inbox"],
        ['scrollback spawn claude "<task>"', "hand a task to another agent"],
        ["scrollback inbox <you> · workers", "read replies, see who's still working"],
      ],
    },
    {
      title: "Get started",
      body: [
        ["scrollback doctor", "which agents it found, and how much history"],
        ["scrollback install", "set it up inside every agent you run"],
        ["scrollback --help", "everything else"],
        ["", "replay this tour anytime: `scrollback onboarding`"],
      ],
    },
  ];
}

// ---------- render ----------

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const visLen = (s: string) => strip(s).length;

function frame(
  page: Page,
  pageIdx: number,
  pageCount: number,
  markFrac: number,
  cols: number,
  rows: number,
  color: "true" | "basic" | "none",
  mark: MarkId | string,
  scrollOff = 0,
): string {
  const out: string[] = Array.from({ length: rows }, () => "");
  const center = (s: string) => " ".repeat(Math.max(0, Math.floor((cols - visLen(s)) / 2))) + s;
  const gold = (s: string) =>
    color === "none" ? `\x1b[1m${s}\x1b[0m` : `\x1b[1m\x1b[38;2;245;205;86m${s}\x1b[0m`;
  const dim = (s: string) => (color === "none" ? s : `\x1b[2m${s}\x1b[0m`);
  const acc = (s: string) => (color === "none" ? s : `\x1b[38;2;255;255;255m${s}\x1b[0m`);

  if (cols < 72 || rows < 21) {
    out[Math.floor(rows / 2)] = center("terminal too small — resize, then space");
    return out.join("\n");
  }

  // mark, top-center
  const art = markLines(markFrac, color, mark, scrollOff);
  let row = 1;
  for (const l of art) out[row++] = center(l);
  row += 1;

  // title + body, centered as a block
  out[row++] = center(gold(page.title));
  row++;
  const left = Math.max(...page.body.map(([c]) => visLen(c)));
  const block = page.body.map(([c, d]) => (c ? acc(c.padEnd(left + 2)) + dim(d) : dim(d)));
  const bw = Math.max(...block.map(visLen));
  const bx = Math.max(0, Math.floor((cols - bw) / 2));
  for (const l of block) out[row++] = " ".repeat(bx) + l;

  // footer
  out[rows - 3] = center(dim(`${pageIdx + 1}/${pageCount}`));
  out[rows - 2] = center(dim(pageIdx + 1 === pageCount ? "Space to finish" : "Space to continue"));
  return out.join("\n");
}

// ---------- interactive ----------

function colorMode(): "true" | "basic" | "none" {
  if (process.env.NO_COLOR) return "none";
  try {
    const d = process.stdout.getColorDepth?.() || 1;
    if (d <= 1) return "none";
    return d >= 24 ? "true" : "basic";
  } catch {
    return "basic";
  }
}

/** Pick a mark: explicit flag > SCROLLBACK_MARK env > default. */
export function resolveMark(flag?: string): MarkId {
  const v = flag || process.env.SCROLLBACK_MARK || "wall";
  return (MARKS as readonly string[]).includes(v) ? (v as MarkId) : "wall";
}

/** Interactive paged tour. Resolves when the user finishes or quits. */
export function runOnboarding(opts: { mark?: string } = {}): Promise<void> {
  return new Promise((resolve) => {
    const mark = resolveMark(opts.mark);
    const out = process.stdout;
    const stdin = process.stdin;
    const color = colorMode();
    // sibling file beside this module — .ts in dev, .js in the built dist
    const scanEntry = join(
      fileURLToPath(new URL(".", import.meta.url)),
      `onboarding-scan.${fileURLToPath(import.meta.url).endsWith(".ts") ? "ts" : "js"}`,
    );
    let idx = 0;
    let stats: OnboardStats | null = null;
    const noAnim = !!process.env.SCROLLBACK_NO_ANIM;
    let markFrac = noAnim ? 1 : 0;
    let done = false;
    let specCache = pages(null);
    const t0 = Date.now();
    const ANIM_MS = 800;
    const REST_MS = 300; // beat on the finished mark before the paper moves
    const SCROLL_MS = 550; // one cell-row per step — slow unroll, easy to follow
    const scrollable = !!markPoints(mark).flow;
    let scrollOff = 0;

    const paint = () => {
      specCache = pages(stats, out.rows || 24);
      const body = frame(
        specCache[idx],
        idx,
        specCache.length,
        markFrac,
        out.columns || 80,
        out.rows || 24,
        color,
        mark,
        scrollOff,
      );
      // \x1b[K per line erases leftovers from the previous frame — without it,
      // shrinking content (mid-animation mark) leaves ghost text behind
      out.write("\x1b[H" + body.split("\n").join("\x1b[K\n") + "\x1b[K");
    };

    // ambient scroll only moves the mark — repaint just its rows instead of
    // the whole frame (cheaper per tick, less flicker on slow terminals)
    const paintMark = () => {
      const art = markLines(markFrac, color, mark, scrollOff);
      const cols = out.columns || 80;
      for (let r = 0; r < art.length; r++) {
        const pad = Math.max(0, Math.floor((cols - visLen(art[r])) / 2));
        out.write(`\x1b[${2 + r};1H${" ".repeat(pad)}${art[r]}\x1b[K`);
      }
    };

    // stats come from a child process — parsing every store is seconds of
    // synchronous work; on this loop it would visibly freeze the scroll
    let scanStarted = false;
    let scanChild: ChildProcess | null = null;
    const startScan = () => {
      if (scanStarted) return;
      scanStarted = true;
      let buf = "";
      try {
        scanChild = spawn(process.execPath, [scanEntry], {
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        return;
      }
      scanChild.stdout!.on("data", (c) => (buf += c));
      const settle = () => {
        if (done) return;
        try {
          stats = JSON.parse(buf);
        } catch {}
        paint();
      };
      scanChild.on("close", settle);
      scanChild.on("error", settle);
    };

    const finish = () => {
      if (done) return;
      done = true;
      stdin.off("keypress", onKey);
      process.off("SIGWINCH", paint);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      try {
        scanChild?.kill();
      } catch {}
      out.write("\x1b[?25h\x1b[?1049l"); // cursor back, leave alt screen
      try {
        writeOnboarded();
      } catch {}
      console.log(
        `scrollback ${VERSION} — you're set. try: scrollback doctor · scrollback search "<kw>" --global`,
      );
      resolve();
    };

    const onKey = (_s: string, key: any) => {
      const name = key?.name || "";
      if ((key?.ctrl && name === "c") || name === "q" || name === "escape") return finish();
      // keyboard-initiated = no animation: once the user navigates, the mark
      // is drawn instantly — they've already seen the reveal
      markFrac = 1;
      startScan(); // they're past the mark — start gathering for page 3 now
      if (name === "left" || name === "backspace") {
        if (idx > 0) idx--;
        return paint();
      }
      if (name === "space" || name === "return" || name === "right") {
        if (idx + 1 >= specCache.length) return finish();
        idx++;
        return paint();
      }
    };

    out.write("\x1b[?1049h\x1b[?25l"); // alt screen, hide cursor
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
    process.on("SIGWINCH", paint);

    startScan();

    // mark reveal: constant-velocity draw over a fixed wall-clock budget —
    // fraction comes from elapsed time, not tick count, so a busy event loop
    // drops frames instead of stretching the animation. A short rest beat on
    // the finished mark, then the ambient scroll: one cell-row per tick —
    // state-incremented, so a busy loop pauses instead of teleporting
    let restUntil = 0;
    const tick = () => {
      if (done) return;
      // a keypress may have forced markFrac to 1 — never un-draw it
      if (markFrac < 1) {
        markFrac = Math.min(1, (Date.now() - t0) / ANIM_MS);
        paint();
        return setTimeout(tick, 16);
      }
      if (!scrollable) return;
      const now = Date.now();
      if (!restUntil) restUntil = now + REST_MS;
      if (now < restUntil) return setTimeout(tick, restUntil - now);
      scrollOff++;
      paintMark();
      setTimeout(tick, SCROLL_MS);
    };
    paint();
    if (!noAnim) tick();
  });
}

/** Non-TTY fallback: the whole tour as plain text. */
export function printOnboarding(mark: MarkId | string = "wall"): string {
  let stats: OnboardStats | null = null;
  try {
    stats = gatherStats();
  } catch {}
  const spec = pages(stats);
  const lines: string[] = [];
  for (const l of markLines(1, "none", mark)) lines.push(l.trimEnd());
  lines.push("");
  spec.forEach((p, i) => {
    lines.push(`── ${i + 1}/${spec.length}  ${p.title}`);
    for (const [c, d] of p.body) lines.push(c ? `   ${c.padEnd(42)} ${d}` : `   ${d}`);
    lines.push("");
  });
  return lines.join("\n");
}

/** `scrollback onboarding [--mark spiral|terminal|scroll|wall]` */
export async function cmdOnboarding(
  flags: { mark?: string | boolean } = {},
): Promise<string | undefined> {
  const mark = resolveMark(typeof flags.mark === "string" ? flags.mark : undefined);
  if (process.stdout.isTTY && process.stdin.isTTY && process.env.TERM !== "dumb") {
    await runOnboarding({ mark });
    return;
  }
  return printOnboarding(mark);
}
