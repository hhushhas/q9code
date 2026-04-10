import type { ChatAttachment } from "@t3tools/contracts";
import { Effect, FileSystem } from "effect";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { limitSection } from "../git/Utils.ts";

export const TEXT_ATTACHMENT_INLINE_MAX_CHARS = 24_000;
export const TOTAL_TEXT_ATTACHMENT_INLINE_MAX_CHARS = 48_000;

function normalizeAttachmentText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export interface AttachmentPromptContext {
  readonly promptSuffix: string;
}

export const buildAttachmentPromptContext = Effect.fn("buildAttachmentPromptContext")(
  function* (input: {
    readonly attachmentsDir: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const sections: string[] = [];
    let remainingTextChars = TOTAL_TEXT_ATTACHMENT_INLINE_MAX_CHARS;

    for (const attachment of input.attachments ?? []) {
      if (attachment.type === "image") {
        continue;
      }

      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: input.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        return yield* Effect.fail(new Error(`Invalid attachment id '${attachment.id}'.`));
      }

      if (attachment.mimeType === "application/pdf") {
        sections.push(
          [
            `Attached PDF: ${attachment.name}`,
            `Path: ${attachmentPath}`,
            `Mime type: ${attachment.mimeType}`,
            `Size: ${attachment.sizeBytes} bytes`,
            "PDF content is not inlined automatically. Inspect this file directly with available tools if you need its contents.",
          ].join("\n"),
        );
        continue;
      }

      const bytes = yield* fileSystem
        .readFile(attachmentPath)
        .pipe(
          Effect.mapError(
            (cause) => new Error(`Failed to read attachment '${attachment.name}'.`, { cause }),
          ),
        );
      const decoded = normalizeAttachmentText(new TextDecoder().decode(bytes));
      const nextBudget = Math.max(
        0,
        Math.min(TEXT_ATTACHMENT_INLINE_MAX_CHARS, remainingTextChars),
      );
      if (nextBudget === 0) {
        sections.push(
          `Attached file '${attachment.name}' was not inlined because the attachment text budget was exhausted.`,
        );
        continue;
      }

      const truncated = limitSection(decoded, nextBudget);
      remainingTextChars = Math.max(0, remainingTextChars - Math.min(decoded.length, nextBudget));
      sections.push(
        [
          `Attached file: ${attachment.name}`,
          `Path: ${attachmentPath}`,
          `Mime type: ${attachment.mimeType}`,
          `Size: ${attachment.sizeBytes} bytes`,
          "Content:",
          "```text",
          truncated,
          "```",
        ].join("\n"),
      );
    }

    return {
      promptSuffix: sections.length > 0 ? ["Attached file context:", ...sections].join("\n\n") : "",
    } satisfies AttachmentPromptContext;
  },
);

export function mergePromptWithAttachmentContext(
  prompt: string | undefined,
  context: AttachmentPromptContext,
): string | undefined {
  const basePrompt = prompt?.trim() ?? "";
  const suffix = context.promptSuffix.trim();
  if (basePrompt.length === 0) {
    return suffix.length > 0 ? suffix : undefined;
  }
  if (suffix.length === 0) {
    return basePrompt;
  }
  return `${basePrompt}\n\n${suffix}`;
}
