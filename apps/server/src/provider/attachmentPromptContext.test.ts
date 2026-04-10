import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { attachmentRelativePath } from "../attachmentStore.ts";
import {
  buildAttachmentPromptContext,
  mergePromptWithAttachmentContext,
} from "./attachmentPromptContext.ts";

describe("attachmentPromptContext", () => {
  it("inlines supported text-like attachments into prompt context", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "q9-attachment-context-"));
    try {
      const attachment = {
        type: "file" as const,
        id: "thread-1-attachment",
        name: "notes.md",
        mimeType: "text/markdown" as const,
        sizeBytes: 19,
      };
      const attachmentPath = path.join(attachmentsDir, attachmentRelativePath(attachment));
      fs.writeFileSync(attachmentPath, "# Heading\r\nhello\n");

      const context = await Effect.runPromise(
        buildAttachmentPromptContext({
          attachmentsDir,
          attachments: [attachment],
        }).pipe(Effect.provide(NodeServices.layer)),
      );

      expect(context.promptSuffix).toContain("Attached file: notes.md");
      expect(context.promptSuffix).toContain(`Path: ${attachmentPath}`);
      expect(context.promptSuffix).toContain("Mime type: text/markdown");
      expect(context.promptSuffix).toContain("# Heading\nhello\n");
      expect(mergePromptWithAttachmentContext("Review this", context)).toContain("Review this");
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("keeps PDFs as explicit file references without pretending to inline content", async () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "q9-attachment-context-"));
    try {
      const attachment = {
        type: "file" as const,
        id: "thread-1-pdf",
        name: "spec.pdf",
        mimeType: "application/pdf" as const,
        sizeBytes: 128,
      };
      const attachmentPath = path.join(attachmentsDir, attachmentRelativePath(attachment));
      fs.writeFileSync(attachmentPath, Buffer.from("%PDF-1.7"));

      const context = await Effect.runPromise(
        buildAttachmentPromptContext({
          attachmentsDir,
          attachments: [attachment],
        }).pipe(Effect.provide(NodeServices.layer)),
      );

      expect(context.promptSuffix).toContain("Attached PDF: spec.pdf");
      expect(context.promptSuffix).toContain(`Path: ${attachmentPath}`);
      expect(context.promptSuffix).toContain("PDF content is not inlined automatically.");
      expect(context.promptSuffix).not.toContain("```text");
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });
});
