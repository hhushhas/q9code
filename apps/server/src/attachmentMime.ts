import Mime from "@effect/platform-node/Mime";
import {
  PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS,
  type ChatFileAttachment,
} from "@t3tools/contracts";

export const FILE_EXTENSION_BY_MIME_TYPE: Record<ChatFileAttachment["mimeType"], string> = {
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/json": ".json",
  "text/csv": ".csv",
  "application/pdf": ".pdf",
};

const SAFE_FILE_ATTACHMENT_EXTENSIONS = new Set(PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS);
type SupportedFileExtension = (typeof PROVIDER_SEND_TURN_SUPPORTED_FILE_EXTENSIONS)[number];

export function parseBase64DataUrl(
  dataUrl: string,
): { readonly mimeType: string; readonly base64: string } | null {
  const match = /^data:([^,]+),([a-z0-9+/=\r\n ]+)$/i.exec(dataUrl.trim());
  if (!match) return null;

  const headerParts = (match[1] ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (headerParts.length < 2) {
    return null;
  }
  const trailingToken = headerParts.at(-1)?.toLowerCase();
  if (trailingToken !== "base64") {
    return null;
  }

  const mimeType = headerParts[0]?.toLowerCase();
  const base64 = match[2]?.replace(/\s+/g, "");
  if (!mimeType || !base64) return null;

  return { mimeType, base64 };
}

export function inferSupportedFileAttachmentExtension(input: {
  readonly mimeType: ChatFileAttachment["mimeType"];
  readonly fileName?: string;
}): string {
  const key = input.mimeType.toLowerCase() as ChatFileAttachment["mimeType"];
  const fromMime = Object.hasOwn(FILE_EXTENSION_BY_MIME_TYPE, key)
    ? FILE_EXTENSION_BY_MIME_TYPE[key]
    : undefined;
  if (fromMime) {
    return fromMime;
  }

  const fromMimeExtension = Mime.getExtension(input.mimeType);
  if (
    fromMimeExtension &&
    SAFE_FILE_ATTACHMENT_EXTENSIONS.has(fromMimeExtension as SupportedFileExtension)
  ) {
    return fromMimeExtension;
  }

  const fileName = input.fileName?.trim() ?? "";
  const extensionMatch = /\.([a-z0-9]{1,8})$/i.exec(fileName);
  const fileNameExtension = extensionMatch ? `.${extensionMatch[1]!.toLowerCase()}` : "";
  if (SAFE_FILE_ATTACHMENT_EXTENSIONS.has(fileNameExtension as SupportedFileExtension)) {
    return fileNameExtension;
  }

  return ".bin";
}
