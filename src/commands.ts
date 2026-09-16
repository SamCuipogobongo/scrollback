// Command implementations — each returns a string so both the CLI and the
// MCP server share one code path.

import type { Session, Role } from "./types.ts";
import {
  applyScope,
  detectSources,
  fmtDate,
  loadAll,
  matchSession,
  SOURCES,
} from "./registry.ts";

type Flags = Record<string, string | boolean>;

export function cmdProjects(f: Flags): string {
  const sessions = applyScope(loadAll(f.platform as string), { ...f, global: true });
  const map = new Map<string, { last: number; counts: Record<string, number>; n: number }>();
  for (const s of sessions) {
    const k = s.cwd || "(no cwd)";
    const e = map.get(k) || { last: 0, counts: {}, n: 0 };
    e.n++;
    e.last = Math.max(e.last, s.startedAt);
    e.counts[s.platform] = (e.counts[s.platform] || 0) + 1;
    map.set(k, e);
  }
  const rows = [...map.entries()].sort((a, b) => b[1].last - a[1].last);
  const lim = Number(f.limit || 50);
  const lines = ["active projects"];
  for (const [cwd, e] of rows.slice(0, lim)) {
    const parts = Object.entries(e.counts)
      .map(([p, n]) => `${p}:${n}`)
      .join(" ");
    lines.push(`${fmtDate(e.last)}  sessions=${String(e.n).padStart(3)} (${parts})  ${cwd}`);
  }
  lines.push(`${rows.length} project(s)`);
  return lines.join("\n");
}

export function cmdList(f: Flags): string {
  const sessions = applyScope(loadAll(f.platform as string), f).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
  const lim = Number(f.limit || 50);
  const scope = f.global ? "global" : `project=${(f.cwd as string) || process.cwd()}`;
  const lines = [`scope: ${scope}  platform=${f.platform || "all"}`];
  for (const s of sessions.slice(0, lim)) {
    const title = s.title ? `  ${s.title.slice(0, 50)}` : "";
    lines.push(
      `[${s.platform.padEnd(10)}] ${fmtDate(s.startedAt)}  ${s.id.slice(0, 13)}  ${s.cwd}${title}`,
    );
  }
  lines.push(`${sessions.length} session(s)`);
  return lines.join("\n");
}

// Paragraph-aligned excerpt: split on blank lines (fenced code blocks kept
// whole), prefer the chunk containing ALL query tokens, fall back to the
// rarest-token anchor. Better than a fixed head-of-turn window when the
// hit lives deep inside a long turn.
function bestExcerpt(text: string, tokens: string[], budget = 400): string {
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  const chunks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) inFence = !inFence;
    if (!inFence && !l.trim()) {
      if (cur.length) chunks.push(cur.join("\n"));
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) chunks.push(cur.join("\n"));
  if (chunks.length <= 1) return text.slice(0, budget);

  const low = (s: string) => s.toLowerCase();
  const hitsOf = (c: string) => tokens.reduce((n, t) => n + low(c).split(t).length - 1, 0);
  let bestI = -1,
    bestHits = -1;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const n = hitsOf(c);
    if (tokens.every((t) => low(c).includes(t)) && n > bestHits) {
      bestI = i;
      bestHits = n;
    }
  }
  if (bestI < 0) {
    const counts = tokens.map((t) => low(text).split(t).length - 1);
    const rare = tokens[counts.indexOf(Math.min(...counts))];
    bestI = chunks.findIndex((c) => low(c).includes(rare));
    if (bestI < 0) bestI = 0;
  }
  let ex = chunks[bestI];
  for (let j = bestI + 1; j < chunks.length && ex.length + chunks[j].length + 2 <= budget; j++)
    ex += "\n\n" + chunks[j];
  return ex.slice(0, budget);
}

export function cmdSearch(q: string, f: Flags): string {
  const sessions = applyScope(loadAll(f.platform as string), f);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scope = f.global ? "global" : `project=${(f.cwd as string) || process.cwd()}`;
  const lines = [`scope: ${scope}  keyword="${q}"  platform=${f.platform || "all"}`];
  const hits: { s: Session; score: number; uh: number; ah: number; excerpt: string; role: Role }[] = [];
  for (const s of sessions) {
    let uh = 0,
      ah = 0,
      best = null as { text: string; role: Role } | null,
      bestHits = -1;
    for (const t of s.turns) {
      const low = t.text.toLowerCase();
      const n = tokens.reduce((acc, tok) => acc + (low.split(tok).length - 1), 0);
      const allPresent = tokens.every((tok) => low.includes(tok));
      if (n > 0) t.role === "user" ? (uh += n) : (ah += n);
      if (allPresent && n > bestHits) {
        bestHits = n;
        best = t;
      }
    }
    if (!uh && !ah) continue;
    if (!best) {
      const rare = tokens.reduce((a, b) => {
        const ca = sessions.reduce(
          (n, s2) => n + s2.turns.filter((t) => t.text.toLowerCase().includes(a)).length,
          0,
        );
        const cb = sessions.reduce(
          (n, s2) => n + s2.turns.filter((t) => t.text.toLowerCase().includes(b)).length,
          0,
        );
        return ca <= cb ? a : b;
      });
      best = s.turns.find((t) => t.text.toLowerCase().includes(rare)) || s.turns[0];
    }
    const score = (3 * uh + ah) / Math.max(s.turns.length, 1);
    hits.push({ s, score, uh, ah, excerpt: bestExcerpt(best.text, tokens), role: best.role });
  }
  hits.sort((a, b) => b.score - a.score);
  const lim = Number(f.limit || 50);
  for (const h of hits.slice(0, lim)) {
    const title = h.s.title ? ` "${h.s.title.slice(0, 40)}"` : "";
    lines.push(
      `[${h.s.platform.padEnd(10)}] ${fmtDate(h.s.startedAt)}  ${h.s.id.slice(0, 13)}  ${h.s.cwd}  score=${h.score.toFixed(3)}  hits=${h.uh + h.ah} (u=${h.uh},a=${h.ah})  turns=${h.s.turns.length}${title}`,
    );
    for (const line of h.excerpt.split("\n").slice(0, 4)) {
      if (line.trim()) lines.push(`    [${h.role}] ${line.slice(0, 160)}`);
    }
    lines.push("");
  }
  lines.push(`${hits.length} session(s)`);
  return lines.join("\n");
}

export function cmdContext(prefix: string, f: Flags): string {
  const s = matchSession(loadAll(), prefix);
  if (!s) return `no session matching "${prefix}"`;
  const budget = Number(f["max-chars"] || 6000);
  const grep = (f.grep as string)?.toLowerCase();
  const nTurns = Number(f.turns || 3);
  const around = Number(f.around ?? 1);
  const lines = [
    `# context: [${s.platform}] ${s.id}${s.title ? ` — ${s.title}` : ""}`,
    `# cwd:   ${s.cwd}`,
  ];
  let idxs: number[];
  if (grep) {
    const scored = s.turns
      .map((t, i) => ({ i, n: t.text.toLowerCase().split(grep).length - 1 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, nTurns)
      .map((x) => x.i);
    const set = new Set<number>();
    for (const i of scored) for (let j = i - around; j <= i + around; j++) set.add(j);
    idxs = [...set].filter((i) => i >= 0 && i < s.turns.length).sort((a, b) => a - b);
    lines.push(`# grep="${grep}" — top ${scored.length} hit turns ±${around}`);
  } else {
    const from = Math.max(0, Number(f.from || 0));
    const to = Math.min(s.turns.length, Number(f.to || from + nTurns));
    idxs = Array.from({ length: to - from }, (_, i) => from + i);
    lines.push(`# no grep — showing turns ${from}-${to - 1} of ${s.turns.length}`);
  }
  let used = 0;
  for (const i of idxs) {
    const t = s.turns[i];
    const hit = grep && t.text.toLowerCase().includes(grep) ? "  ← hit" : "";
    const text = t.text.slice(0, Math.max(200, budget / 2));
    const tag = t.preCompact ? " [compact]" : "";
    lines.push(`\n## turn ${i} (${t.role})${tag}${hit}\n\n${text}`);
    used += text.length;
    if (used > budget) {
      lines.push(`\n# budget_used: ${used}/${budget} chars — truncated`);
      break;
    }
  }
  return lines.join("\n");
}

export function cmdExtract(prefix: string, f: Flags): string {
  const s = matchSession(loadAll(), prefix);
  if (!s) return `no session matching "${prefix}"`;
  const grep = (f.grep as string)?.toLowerCase();
  const turns = grep ? s.turns.filter((t) => t.text.toLowerCase().includes(grep)) : s.turns;
  if (f.json) return JSON.stringify({ ...s, turns }, null, 2);
  const lines = [
    `# extract: [${s.platform}] ${s.id}${s.title ? ` — ${s.title}` : ""}`,
    `# cwd: ${s.cwd}  started: ${fmtDate(s.startedAt)}  turns shown: ${turns.length}/${s.turns.length}\n`,
  ];
  for (const t of turns)
    lines.push(`## ${t.role}${t.preCompact ? " [compact]" : ""}\n\n${t.text}\n`);
  return lines.join("\n");
}

export function cmdStats(f: Flags): string {
  const sessions = applyScope(loadAll(f.platform as string), { ...f, global: true });
  const byPlat = new Map<string, { n: number; turns: number; userTurns: number; first: number; last: number }>();
  const byMonth = new Map<string, number>();
  for (const s of sessions) {
    const e = byPlat.get(s.platform) || { n: 0, turns: 0, userTurns: 0, first: Infinity, last: 0 };
    e.n++;
    e.turns += s.turns.length;
    e.userTurns += s.turns.filter((t) => t.role === "user").length;
    if (s.startedAt) {
      e.first = Math.min(e.first, s.startedAt);
      e.last = Math.max(e.last, s.startedAt);
      const m = new Date(s.startedAt).toISOString().slice(0, 7);
      byMonth.set(m, (byMonth.get(m) || 0) + 1);
    }
    byPlat.set(s.platform, e);
  }
  const lines = ["scrollback stats\n"];
  lines.push(
    "platform      sessions  turns   user%   first        last",
  );
  for (const [p, e] of [...byPlat.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const upct = e.turns ? Math.round((e.userTurns / e.turns) * 100) : 0;
    lines.push(
      `${p.padEnd(13)} ${String(e.n).padStart(8)}  ${String(e.turns).padStart(6)}  ${String(upct).padStart(4)}%  ${fmtDate(e.first === Infinity ? 0 : e.first).slice(0, 10)}  ${fmtDate(e.last).slice(0, 10)}`,
    );
  }
  lines.push("\nby month");
  const months = [...byMonth.entries()].sort();
  const max = Math.max(...months.map(([, n]) => n), 1);
  for (const [m, n] of months) {
    lines.push(`${m}  ${"█".repeat(Math.ceil((n / max) * 30))} ${n}`);
  }
  const totalT = [...byPlat.values()].reduce((a, e) => a + e.turns, 0);
  lines.push(`\n${sessions.length} session(s), ${totalT} turns`);
  return lines.join("\n");
}

export function cmdDoctor(f: Flags): string {
  const lines = ["scrollback doctor\n"];
  const detected = new Map(detectSources().map((d) => [d.source.id, d.roots]));
  const only = f.platform && f.platform !== "all" ? String(f.platform) : null;
  let total = 0;
  for (const source of SOURCES) {
    if (only && source.id !== only) continue;
    const roots = detected.get(source.id);
    if (!roots) {
      lines.push(`  [${source.id.padEnd(11)}] — not detected`);
      continue;
    }
    let n = 0;
    for (const r of roots) {
      try {
        n += source.sessions(r).length;
      } catch {}
    }
    total += n;
    lines.push(`  [${source.id.padEnd(11)}] ${n} session(s)  ${roots.join(", ")}`);
  }
  lines.push(`\n${total} session(s) across ${only ? 1 : detected.size} detected source(s)`);
  return lines.join("\n");
}
