// Shared helpers for the many JSONL/JSON stores whose records are some
// variant of {role, content} or {type: "message", message: {...}}.

import type { Role } from "../types.ts";
import { cleanText } from "../clean.ts";

const USER_HINTS = ["user", "human"];
const ASST_HINTS = ["assistant", "model", "gemini", "agent", "ai"];

function roleOf(v: any): Role | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  if (USER_HINTS.includes(s)) return "user";
  if (ASST_HINTS.includes(s)) return "assistant";
  return null;
}

/** Extract text from a content field: string, block array, or nested message. */
export function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) =>
        typeof b === "string" ? b : b?.text ?? b?.Text ?? b?.content ?? "",
      )
      .join("\n");
  if (content && typeof content === "object")
    return textOf(content.text ?? content.content ?? content.parts ?? "");
  return "";
}

/**
 * Best-effort extraction of a {role,text} pair from an arbitrary event object.
 * Covers: {role,content}, {type:"message",message:{role,content}},
 * {type:"user|assistant",content}, {data:{role,content}}, {message:{...}}.
 * Returns null for tool calls, system records, control records.
 */
export function extractTurn(ev: any): { role: Role; text: string } | null {
  if (!ev || typeof ev !== "object") return null;
  if (ev.$set || ev.$rewindTo || ev.control) return null;

  // unwrap common envelopes
  const msg =
    ev.message && typeof ev.message === "object" && (ev.message.role || ev.message.content)
      ? ev.message
      : ev.data && typeof ev.data === "object" && (ev.data.role || ev.data.content)
        ? ev.data
        : ev;

  let role = roleOf(msg.role) ?? roleOf(msg.type) ?? roleOf(ev.role);
  if (!role && typeof ev.type === "string") {
    const t = ev.type.toLowerCase();
    if (/^(user|human)[._-]?(message|input|prompt)?$/.test(t)) role = "user";
    if (/^(assistant|ai|model|gemini)[._-]?(message|response|reply)?$/.test(t)) role = "assistant";
  }
  if (!role) return null;

  const text = cleanText(
    textOf(msg.content ?? msg.text ?? msg.message ?? msg.parts ?? msg.data ?? ""),
  );
  return text ? { role, text } : null;
}
