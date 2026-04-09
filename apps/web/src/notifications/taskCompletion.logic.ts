import { isLatestTurnSettled } from "../session-logic";
import type { Thread } from "../types";

export interface CompletedThreadCandidate {
  threadId: Thread["id"];
  projectId: Thread["projectId"];
  title: string;
  completedAt: string;
  assistantSummary: string | null;
}

function summarizeLatestAssistantMessage(thread: Thread): string | null {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const trimmed = message.text.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) {
      continue;
    }
    return trimmed.length <= 140 ? trimmed : `${trimmed.slice(0, 137)}...`;
  }
  return null;
}

export function collectCompletedThreadCandidates(
  previousThreads: readonly Thread[],
  nextThreads: readonly Thread[],
): CompletedThreadCandidate[] {
  const previousById = new Map(previousThreads.map((thread) => [thread.id, thread] as const));
  const candidates: CompletedThreadCandidate[] = [];

  for (const thread of nextThreads) {
    const previousThread = previousById.get(thread.id);
    if (!previousThread) {
      continue;
    }

    const previousSettled = isLatestTurnSettled(previousThread.latestTurn, previousThread.session);
    const nextSettled = isLatestTurnSettled(thread.latestTurn, thread.session);
    if (!nextSettled) {
      continue;
    }

    const completedAt = thread.latestTurn?.completedAt;
    if (!completedAt) {
      continue;
    }

    const turnChanged = previousThread.latestTurn?.turnId !== thread.latestTurn?.turnId;
    const completedAtChanged = previousThread.latestTurn?.completedAt !== completedAt;
    if (!turnChanged && !completedAtChanged && previousSettled) {
      continue;
    }

    candidates.push({
      threadId: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      completedAt,
      assistantSummary: summarizeLatestAssistantMessage(thread),
    });
  }

  return candidates;
}

export function buildTaskCompletionCopy(candidate: CompletedThreadCandidate): {
  title: string;
  body: string;
} {
  const normalizedTitle = candidate.title.trim();
  const threadLabel = normalizedTitle.length > 0 ? normalizedTitle : "Untitled thread";

  return {
    title: "Task completed",
    body: candidate.assistantSummary
      ? `${threadLabel}: ${candidate.assistantSummary}`
      : `${threadLabel} finished working.`,
  };
}
