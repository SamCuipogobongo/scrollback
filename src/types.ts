// Shared model. Everything normalizes into Session/Turn; each platform
// implements the Source interface and gets picked up by the registry.

export type Role = "user" | "assistant";

export interface Turn {
  role: Role;
  text: string;
  /** predates a context-compaction event inside the session (codex) */
  preCompact?: boolean;
}

export interface Session {
  platform: string;
  id: string;
  cwd: string;
  startedAt: number; // epoch ms
  title?: string;
  turns: Turn[];
}

export interface Source {
  /** platform tag shown in output, e.g. "claude" */
  id: string;
  /**
   * Candidate storage roots on this machine. Implementations should honor
   * `SCROLLBACK_<ID>_ROOT` first, then the platform's own env vars, then
   * OS defaults. Return every plausible path — missing ones are skipped.
   */
  roots(): string[];
  /** Parse every session found under one existing root. */
  sessions(root: string): Session[];
}
