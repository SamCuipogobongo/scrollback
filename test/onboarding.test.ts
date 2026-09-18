// Onboarding: mark render, page content, marker roundtrip. The interactive
// pager itself is thin TTY glue — the pure pieces are what get tested.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  gatherStats,
  hasOnboarded,
  markLines,
  pages,
  printOnboarding,
  ramp,
  writeOnboarded,
} from "../src/onboarding.ts";

test("mark: visible dots, full reveal, default is wall", () => {
  const lines = markLines(1, "none");
  assert.ok(lines.length >= 8);
  const text = lines.join("\n");
  assert.match(text, /[⠀-⣿]/); // braille block chars present
  assert.doesNotMatch(text, /\x1b/);
  // partial reveal paints a strict subset of dots
  const lit = (ls: string[]) => ls.join("").replace(/[⠀ ]/g, "").length;
  assert.ok(lit(markLines(0.4, "none")) < lit(lines));
  // default mark = wall
  assert.equal(markLines(1, "none").join(""), markLines(1, "none", "wall").join(""));
});

test("marks: every mark renders braille", () => {
  for (const m of ["spiral", "terminal", "scroll", "wall"]) {
    assert.match(markLines(1, "none", m).join("\n"), /[⠁-⣿]/);
  }
});

// Decode a rendered row's text-line occupancy inside the wall window.
// Text dots may sit at any sub-row (staggered phases + mid-step pairs), so
// occupancy = any lit bit in the interior cell columns 10..23 — the sheet
// edges live at columns 7 and 26, outside this band.
const hasText = (line: string) =>
  [...line].slice(10, 24).some((ch) => ch.codePointAt(0)! - 0x2800 > 0);

test("wall scroll: document flows downward through a fixed frame", () => {
  const f = (off: number) => markLines(1, "none", "wall", off);
  const occ = (ls: string[]) => ls.map(hasText);
  assert.notEqual(f(0).join("\n"), f(1).join("\n")); // moved
  // roller (line 1) and bottom weight bar (line 9) stay fixed
  assert.equal(f(0)[1], f(1)[1]);
  assert.equal(f(0)[9], f(1)[9]);
  // downward: a cell's content sinks away (cell 3 lit@0, empty@1),
  // fresh content enters at the top cell (cell 2 empty@0, lit@2),
  // and content exits at the bottom cell (cell 7 lit@0, empty@2)
  assert.ok(occ(f(0))[3] && !occ(f(1))[3]);
  assert.ok(!occ(f(0))[2] && occ(f(2))[2]);
  assert.ok(occ(f(0))[7] && !occ(f(2))[7]);
  // far into the document the sheet stays populated, and doesn't repeat the seed frame
  const far = f(500);
  assert.ok(occ(far).some(Boolean));
  assert.notEqual(far.join("\n"), f(0).join("\n"));
});

test("scroll: non-wall marks ignore scrollOff", () => {
  for (const m of ["spiral", "terminal", "scroll"]) {
    assert.equal(markLines(1, "none", m, 0).join(""), markLines(1, "none", m, 42).join(""));
  }
});

test("mark: ramp goes dim -> bright along the path", () => {
  const [r0, g0] = ramp(0);
  const [r1, g1] = ramp(1);
  assert.ok(r1 > r0 && g1 > g0);
});

test("pages: five pages, scan page reflects live stats", () => {
  const spec = pages({ sources: [{ id: "claude", n: 130 }, { id: "codex", n: 66 }], total: 196 });
  assert.equal(spec.length, 5);
  assert.match(spec[0].title, /Welcome/);
  assert.equal(spec[2].title, "2 agents' history found on this machine");
  const body = spec[2].body.map(([c, d]) => `${c} ${d}`).join("\n");
  assert.match(body, /claude 130 sessions/);
  assert.match(body, /196 sessions readable/);
});

test("pages: null stats -> scanning placeholder; empty -> no sources", () => {
  assert.match(pages(null)[2].title, /Scanning/);
  assert.match(pages({ sources: [], total: 0 })[2].title, /No agent history/);
});

test("pages: long source list truncates with a +N more line", () => {
  const sources = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, n: 10 - i }));
  const spec = pages({ sources, total: 55 }, 21); // cap = 3, truncating -> shows 2
  const scan = spec[2];
  const lines = scan.body.map(([c]) => c).filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(scan.body.map(([, d]) => d).join("\n"), /\+8 more/);
});

test("marker: roundtrip in a tmp state dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-onb-"));
  assert.equal(hasOnboarded(dir), false);
  writeOnboarded(dir);
  assert.equal(hasOnboarded(dir), true);
});

test("printOnboarding: static dump has mark, all pages, no ANSI", () => {
  const out = printOnboarding();
  assert.doesNotMatch(out, /\x1b/);
  assert.match(out, /Welcome to Scrollback/);
  assert.match(out, /5\/5 {2}Get started/);
});

test("gatherStats: real scan returns a total consistent with its sources", () => {
  const s = gatherStats();
  assert.equal(
    s.total,
    s.sources.reduce((a, x) => a + x.n, 0),
  );
});
