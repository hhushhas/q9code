import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS,
} from "@t3tools/contracts";

import type { ComposerAttachment, ComposerFileAttachment } from "./composerDraftStore";
import type { ChatAttachment } from "./types";

const FILE_MIME_TYPE_BY_EXTENSION = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
} as const satisfies Record<
  (typeof PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS)[number],
  ComposerFileAttachment["mimeType"]
>;

export const COMPOSER_ATTACHMENT_ACCEPT = [
  "image/*",
  ...PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS,
].join(",");

export function getAttachmentExtension(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match ? `.${match[1]!.toLowerCase()}` : "";
}

export function isImageAttachment(
  attachment: ChatAttachment | ComposerAttachment,
): attachment is Extract<ChatAttachment | ComposerAttachment, { type: "image" }> {
  return attachment.type === "image";
}

export function normalizeComposerAttachmentFile(input: {
  readonly file: File;
  readonly attachmentCount: number;
}):
  | { readonly attachment: ComposerAttachment; readonly pdfNote?: boolean }
  | { readonly error: string } {
  const { file } = input;
  if (input.attachmentCount >= 8) {
    return {
      error: "You can attach up to 8 files per message.",
    };
  }

  if (file.type.startsWith("image/")) {
    if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return {
        error: `'${file.name}' exceeds the ${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB image attachment limit.`,
      };
    }
    return {
      attachment: {
        type: "image",
        id: crypto.randomUUID(),
        name: file.name || "image",
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl: URL.createObjectURL(file),
        file,
      },
    };
  }

  const extension = getAttachmentExtension(file.name);
  if (
    !PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS.includes(
      extension as (typeof PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS)[number],
    )
  ) {
    return {
      error: `Unsupported file type for '${file.name}'. Attach images, .txt, .md, .json, .csv, or .pdf files only.`,
    };
  }
  if (file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
    return {
      error: `'${file.name}' exceeds the ${Math.round(PROVIDER_SEND_TURN_MAX_FILE_BYTES / (1024 * 1024))}MB file attachment limit.`,
    };
  }
  const mimeType =
    FILE_MIME_TYPE_BY_EXTENSION[extension as keyof typeof FILE_MIME_TYPE_BY_EXTENSION] ??
    "text/plain";
  return {
    attachment: {
      type: "file",
      id: crypto.randomUUID(),
      name: file.name,
      mimeType,
      sizeBytes: file.size,
      file,
    },
    ...(mimeType === "application/pdf" ? { pdfNote: true } : {}),
  };
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }
  if (sizeBytes < 1024) {
    return `${Math.round(sizeBytes)} B`;
  }
  const kib = sizeBytes / 1024;
  if (kib < 1024) {
    return `${kib >= 100 ? Math.round(kib) : kib.toFixed(1).replace(/\.0$/, "")} KB`;
  }
  const mib = kib / 1024;
  return `${mib >= 100 ? Math.round(mib) : mib.toFixed(1).replace(/\.0$/, "")} MB`;
}

export function partitionAttachments<T extends ChatAttachment | ComposerAttachment>(
  attachments: ReadonlyArray<T>,
): {
  readonly images: Array<Extract<T, { type: "image" }>>;
  readonly files: Array<Extract<T, { type: "file" }>>;
} {
  const images: Array<Extract<T, { type: "image" }>> = [];
  const files: Array<Extract<T, { type: "file" }>> = [];
  for (const attachment of attachments) {
    if (attachment.type === "image") {
      images.push(attachment as Extract<T, { type: "image" }>);
    } else {
      files.push(attachment as Extract<T, { type: "file" }>);
    }
  }
  return { images, files };
}
