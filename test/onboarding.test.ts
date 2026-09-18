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

test("mark: braille spiral + tail, visible dots, full reveal", () => {
  const lines = markLines(1, "none");
  assert.ok(lines.length >= 8);
  const text = lines.join("\n");
  assert.match(text, /[⠀-⣿]/); // braille block chars present
  // every line's trailing edge is blank-free padding-wise — just check no ANSI
  assert.doesNotMatch(text, /\x1b/);
  // partial reveal paints a strict subset of dots
  const lit = (ls: string[]) => ls.join("").replace(/[⠀ ]/g, "").length;
  assert.ok(lit(markLines(0.4, "none")) < lit(lines));
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
  assert.equal(spec[2].title, "2 agent sources found on this machine");
  const body = spec[2].body.map(([c, d]) => `${c} ${d}`).join("\n");
  assert.match(body, /claude 130 sessions/);
  assert.match(body, /196 sessions readable/);
});

test("pages: null stats -> scanning placeholder; empty -> no sources", () => {
  assert.match(pages(null)[2].title, /Scanning/);
  assert.match(pages({ sources: [], total: 0 })[2].title, /No agent stores/);
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
