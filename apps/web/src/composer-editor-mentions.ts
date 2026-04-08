import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";

export type ComposerPromptSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "mention";
      path: string;
    }
  | {
      type: "skill";
      name: string;
    }
  | {
      type: "terminal-context";
      context: TerminalContextDraft | null;
    };

const MENTION_TOKEN_REGEX = /(^|\s)@([^\s@]+)(?=\s)/g;
const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9_:-]*)(?=\s)/g;

function pushTextSegment(segments: ComposerPromptSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

function splitPromptTextIntoComposerSegments(text: string): ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = [];
  if (!text) {
    return segments;
  }

  const tokenMatches = [
    ...Array.from(text.matchAll(MENTION_TOKEN_REGEX), (match) => ({
      type: "mention" as const,
      match,
    })),
    ...Array.from(text.matchAll(SKILL_TOKEN_REGEX), (match) => ({
      type: "skill" as const,
      match,
    })),
  ].toSorted((left, right) => (left.match.index ?? 0) - (right.match.index ?? 0));

  let cursor = 0;
  for (const tokenMatch of tokenMatches) {
    const match = tokenMatch.match;
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const tokenValue = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const tokenStart = matchIndex + prefix.length;
    const tokenEnd = tokenStart + fullMatch.length - prefix.length;

    if (tokenStart < cursor) {
      continue;
    }

    if (tokenStart > cursor) {
      pushTextSegment(segments, text.slice(cursor, tokenStart));
    }

    if (tokenValue.length > 0 && tokenMatch.type === "mention") {
      segments.push({ type: "mention", path: tokenValue });
    } else if (tokenValue.length > 0 && tokenMatch.type === "skill") {
      segments.push({ type: "skill", name: tokenValue });
    } else {
      pushTextSegment(segments, text.slice(tokenStart, tokenEnd));
    }

    cursor = tokenEnd;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

export function splitPromptIntoComposerSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft> = [],
): ComposerPromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: ComposerPromptSegment[] = [];
  let textCursor = 0;
  let terminalContextIndex = 0;

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }

    if (index > textCursor) {
      segments.push(...splitPromptTextIntoComposerSegments(prompt.slice(textCursor, index)));
    }
    segments.push({
      type: "terminal-context",
      context: terminalContexts[terminalContextIndex] ?? null,
    });
    terminalContextIndex += 1;
    textCursor = index + 1;
  }

  if (textCursor < prompt.length) {
    segments.push(...splitPromptTextIntoComposerSegments(prompt.slice(textCursor)));
  }

  return segments;
}
