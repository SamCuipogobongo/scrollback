// OpenCode: ~/.local/share/opencode/storage/{session,message,part}/...
// Newer versions also keep opencode.db — we read the JSON tree which both
// eras share. Env: XDG_DATA_HOME, SCROLLBACK_OPENCODE_ROOT.

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, readJson, walkFiles } from "../util.ts";

export const opencode: Source = {
  id: "opencode",
  roots() {
    const xdg = process.env.XDG_DATA_HOME || join(HOME, ".local/share");
    return [...envRoots("opencode"), join(xdg, "opencode/storage")];
  },
  sessions(root) {
    const sessDir = join(root, "session");
    const msgDir = join(root, "message");
    const partDir = join(root, "part");
    if (!existsSync(sessDir)) return [];
    const out: Session[] = [];
    for (const sf of walkFiles(sessDir, [".json"])) {
      const info = readJson(sf);
      if (!info?.id) continue;
      const s: Session = {
        platform: "opencode",
        id: info.id,
        cwd: info.directory || "",
        startedAt: info.time?.created || 0,
        title: info.title,
        turns: [],
      };
      const mdir = join(msgDir, info.id);
      if (!existsSync(mdir)) continue;
      for (const mf of readdirSync(mdir).sort()) {
        const msg = readJson(join(mdir, mf));
        if (!msg?.role || (msg.role !== "user" && msg.role !== "assistant")) continue;
        const pdir = join(partDir, msg.id);
        const parts = existsSync(pdir)
          ? readdirSync(pdir)
              .sort()
              .map((pf) => readJson(join(pdir, pf)))
              .filter((p) => p?.type === "text")
              .map((p) => p.text)
          : [];
        const t = cleanText(parts.join("\n"));
        if (!t) continue;
        if (msg.role === "user" && isUserNoise(t)) continue;
        s.turns.push({ role: msg.role, text: t });
      }
      if (s.turns.length) out.push(s);
    }
    return out;
  },
};
