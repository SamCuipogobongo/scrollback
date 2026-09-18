// First-run onboarding — paged welcome tour, Amp-style.
// Auto-runs once on bare `scrollback` in a TTY; replay via `scrollback onboarding`.
// Marker: <state-root>/onboarded (state root = SCROLLBACK_STATE_ROOT or ~/.scrollback).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitKeypressEvents } from "node:readline";
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

type Pt = [number, number];

function markPath(): Pt[] {
  const pts: Pt[] = [];
  const TH = TURNS * 2 * Math.PI;
  // inner -> outer: angle = -PI/2 - u, radius shrinks to 0 at the center
  for (let u = TH; u >= 0; u -= 0.03) {
    const a = -Math.PI / 2 - u;
    const r = R * (1 - u / TH);
    pts.push([CX + r * Math.cos(a), CY + r * Math.sin(a)]);
  }
  for (let x = CX + 1; x <= CX + TAIL; x++) pts.push([x, CY - R]);
  return pts;
}

export function ramp(t: number): [number, number, number] {
  return [
    Math.round(90 + 165 * t),
    Math.round(55 + 160 * t),
    Math.round(20 + 70 * t),
  ];
}

/** Braille lines for the mark. fraction in [0,1] reveals the path in order. */
export function markLines(fraction = 1, color: "true" | "basic" | "none" = "true"): string[] {
  const all = markPath();
  const pts = all.slice(0, Math.max(1, Math.ceil(all.length * fraction)));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const W = Math.ceil((maxX + 1) / 2);
  const H = Math.ceil((maxY + 1) / 4);
  const grid = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => ({ b: 0, p: -1 })),
  );
  pts.forEach(([x, y], i) => {
    const xi = Math.round(x),
      yi = Math.round(y);
    const cell = grid[yi >> 2][xi >> 1];
    cell.b |= DOTS[yi & 3][xi & 1];
    cell.p = Math.max(cell.p, i / (all.length - 1));
  });
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
    scanBody.push(["", `+${sorted.length - shown.length} more — \`scrollback doctor\` for all`]);
  if (stats) scanBody.push(["", `${stats.total} sessions readable — no index, no sync, no upload`]);
  const scan: Page = stats
    ? sorted.length
      ? {
          title: `${sorted.length} agent source${sorted.length > 1 ? "s" : ""} found on this machine`,
          body: scanBody,
        }
      : {
          title: "No agent stores found yet",
          body: [
            ["", "scrollback reads each agent's local session store in place —"],
            ["", "run claude, codex, kimi & friends and they show up here"],
          ],
        }
    : {
        title: "Scanning your agents…",
        body: [["", "reading local session stores"]],
      };

  return [
    {
      title: "Welcome to Scrollback",
      body: [
        ["", "one search box across the conversation history"],
        ["", "of every agent you run — local-first, nothing uploaded"],
      ],
    },
    {
      title: "Recall anything you've discussed",
      body: [
        ['scrollback search "jwt" --global', "find sessions across every agent"],
        ["scrollback context <id> --grep jwt", "drill into the hit turns"],
        ["", "ids take any unique prefix — `projects` ranks cwds by activity"],
      ],
    },
    scan,
    {
      title: "More than recall — an admin plane",
      body: [
        ['scrollback channel send <ch> "<msg>"', "durable mailboxes between agents"],
        ['scrollback spawn claude "<task>"', "run an agent as a worker"],
        ["scrollback inbox <you> · workers", "read replies, watch the fleet"],
      ],
    },
    {
      title: "Get started",
      body: [
        ["scrollback doctor", "detected sources + session counts"],
        ["scrollback install", "wire skills + MCP into your agents"],
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
): string {
  const out: string[] = Array.from({ length: rows }, () => "");
  const center = (s: string) => " ".repeat(Math.max(0, Math.floor((cols - visLen(s)) / 2))) + s;
  const gold = (s: string) => (color === "none" ? `\x1b[1m${s}\x1b[0m` : `\x1b[1m\x1b[38;2;245;205;86m${s}\x1b[0m`);
  const dim = (s: string) => (color === "none" ? s : `\x1b[2m${s}\x1b[0m`);
  const acc = (s: string) => (color === "none" ? s : `\x1b[38;2;255;255;255m${s}\x1b[0m`);

  if (cols < 72 || rows < 21) {
    out[Math.floor(rows / 2)] = center("terminal too small — resize, then space");
    return out.join("\n");
  }

  // mark, top-center
  const mark = markLines(markFrac, color);
  let row = 1;
  for (const l of mark) out[row++] = center(l);
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

/** Interactive paged tour. Resolves when the user finishes or quits. */
export function runOnboarding(): Promise<void> {
  return new Promise((resolve) => {
    const out = process.stdout;
    const stdin = process.stdin;
    const color = colorMode();
    let idx = 0;
    let stats: OnboardStats | null = null;
    let markFrac = process.env.SCROLLBACK_NO_ANIM ? 1 : 0.05;
    let done = false;
    let specCache = pages(null);

    const paint = () => {
      specCache = pages(stats, out.rows || 24);
      out.write(
        "\x1b[H" + frame(specCache[idx], idx, specCache.length, markFrac, out.columns || 80, out.rows || 24, color) + "\x1b[J",
      );
    };

    const finish = () => {
      if (done) return;
      done = true;
      stdin.off("keypress", onKey);
      process.off("SIGWINCH", paint);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
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

    // live scan in the background while the user reads page 1
    setImmediate(() => {
      try {
        stats = gatherStats();
      } catch {
        stats = { sources: [], total: 0 };
      }
      if (!done) paint();
    });

    // reveal animation for the mark (first paint only): ease to full
    const tick = () => {
      if (done || markFrac >= 1) return;
      markFrac = Math.min(1, markFrac + (1 - markFrac) * 0.22 + 0.015);
      paint();
      setTimeout(tick, 16);
    };
    paint();
    tick();
  });
}

/** Non-TTY fallback: the whole tour as plain text. */
export function printOnboarding(): string {
  let stats: OnboardStats | null = null;
  try {
    stats = gatherStats();
  } catch {}
  const spec = pages(stats);
  const lines: string[] = [];
  for (const l of markLines(1, "none")) lines.push(l.trimEnd());
  lines.push("");
  spec.forEach((p, i) => {
    lines.push(`── ${i + 1}/${spec.length}  ${p.title}`);
    for (const [c, d] of p.body) lines.push(c ? `   ${c.padEnd(42)} ${d}` : `   ${d}`);
    lines.push("");
  });
  return lines.join("\n");
}

/** `scrollback onboarding` — interactive on a TTY, static dump otherwise. */
export async function cmdOnboarding(): Promise<string | undefined> {
  if (process.stdout.isTTY && process.stdin.isTTY && process.env.TERM !== "dumb") {
    await runOnboarding();
    return;
  }
  return printOnboarding();
}
