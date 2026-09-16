// Text cleaning shared by all sources: strip injected markup, prompt
// scaffolding, tool noise, and collapse duplicate turns.

import type { Turn } from "./types.ts";

const STRIP_TAGS = [
  "system-reminder",
  "system_info",
  "rules",
  "available_skills",
  "workflow-state",
  "INSTRUCTIONS",
  "environment_context",
  "permissions instructions",
  "collaboration_mode",
  "task-notification",
  "project_context",
  "additional_metadata",
  "command-message",
  "command-name",
  "command-args",
  "local-command-stdout",
  "local-command-caveat",
  "bash-input",
  "bash-stdout",
  "ide_opened_file",
  "ide_selection",
  "user-prompt-submit-hook",
  "ollama_coworker_plan_mode",
  "user_actions",
  "diff_block_start",
  "diff_block_end",
  "truncation_notice",
  "file-view",
];

const STRIP_RE = new RegExp(
  `<(${STRIP_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1>|$)|<(${STRIP_TAGS.join(
    "|",
  )})\\b[^>]*/>`,
  "gi",
);

export function cleanText(raw: string): string {
  return raw
    .replace(STRIP_RE, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, (m) => (m.length > 4000 ? " " : m))
    .replace(/\s+/g, " ")
    .trim();
}

const USER_NOISE = [
  /^Caveat:/,
  /^Output a summary/,
  /^Output a new summary/,
  /^Conversation to summarize/,
  /^This is a summary/,
  /^You are continuing work/,
  /^Base directory for this skill/,
  /^<\?xml/,
  /DO NOT respond to these messages/,
  /continue the conversation from where we left off/i,
  /The user interrupted the previous turn/,
];

export function isUserNoise(text: string): boolean {
  return text.length < 4 || USER_NOISE.some((r) => r.test(text));
}

export function dedupeTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role && prev.text === t.text) continue;
    out.push(t);
  }
  return out;
}
