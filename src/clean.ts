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

const SECRET_RE = [
  /sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}/g, // openai/anthropic/openrouter
  /ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g, // aws access key
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // slack
  /AIza[0-9A-Za-z_-]{30,}/g, // google api
  /hf_[A-Za-z0-9]{20,}/g, // huggingface
  /Bearer\s+[A-Za-z0-9._~-]{24,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_RE) out = out.replace(re, "[redacted]");
  return out;
}

export function cleanText(raw: string): string {
  return redactSecrets(
    raw
      .replace(STRIP_RE, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/```[\s\S]*?```/g, (m) => (m.length > 4000 ? " " : m))
      .replace(/\s+/g, " ")
      .trim(),
  );
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
