import { Effect, FileSystem, Path } from "effect";
import {
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES,
} from "@t3tools/contracts";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore";
import { parseBase64DataUrl } from "../attachmentMime";
import { ServerConfig } from "../config";
import { WorkspacePaths } from "../workspace/Services/WorkspacePaths";

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspacePaths = yield* WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    if (command.type === "project.create") {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (command.type === "project.meta.update" && command.workspaceRoot !== undefined) {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (command.type !== "thread.turn.start") {
      return command as OrchestrationCommand;
    }

    const normalizedAttachments = yield* Effect.forEach(
      command.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Invalid attachment payload for '${attachment.name}'.`,
            });
          }

          const attachmentId = createAttachmentId(command.threadId);
          if (!attachmentId) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const normalizedMimeType = parsed.mimeType.toLowerCase();
          const bytes = Buffer.from(parsed.base64, "base64");
          const persistedAttachment =
            attachment.type === "image"
              ? (() => {
                  if (!normalizedMimeType.startsWith("image/")) {
                    throw new OrchestrationDispatchCommandError({
                      message: `Invalid image attachment payload for '${attachment.name}'.`,
                    });
                  }
                  if (
                    bytes.byteLength === 0 ||
                    bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
                  ) {
                    throw new OrchestrationDispatchCommandError({
                      message: `Image attachment '${attachment.name}' is empty or too large.`,
                    });
                  }
                  return {
                    type: "image" as const,
                    id: attachmentId,
                    name: attachment.name,
                    mimeType: normalizedMimeType,
                    sizeBytes: bytes.byteLength,
                  };
                })()
              : (() => {
                  if (
                    !PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES.includes(
                      normalizedMimeType as (typeof PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES)[number],
                    )
                  ) {
                    throw new OrchestrationDispatchCommandError({
                      message: `Invalid file attachment payload for '${attachment.name}'.`,
                    });
                  }
                  if (
                    bytes.byteLength === 0 ||
                    bytes.byteLength > PROVIDER_SEND_TURN_MAX_FILE_BYTES
                  ) {
                    throw new OrchestrationDispatchCommandError({
                      message: `File attachment '${attachment.name}' is empty or too large.`,
                    });
                  }
                  return {
                    type: "file" as const,
                    id: attachmentId,
                    name: attachment.name,
                    mimeType:
                      normalizedMimeType as (typeof PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES)[number],
                    sizeBytes: bytes.byteLength,
                  };
                })();

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new OrchestrationDispatchCommandError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...command,
      message: {
        ...command.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });
