import { describe, expect, it } from "vitest";

import type { WsConnectionStatus } from "../rpc/wsConnectionState";
import {
  buildConnectionDiagnosticDetails,
  buildSlowRpcAckDiagnosticDetails,
  shouldAutoReconnect,
} from "./WebSocketConnectionSurface";

function makeStatus(overrides: Partial<WsConnectionStatus> = {}): WsConnectionStatus {
  return {
    attemptCount: 0,
    closeCode: null,
    closeReason: null,
    connectedAt: null,
    disconnectedAt: null,
    hasConnected: false,
    lastError: null,
    lastErrorAt: null,
    nextRetryAt: null,
    online: true,
    phase: "idle",
    reconnectAttemptCount: 0,
    reconnectMaxAttempts: 8,
    reconnectPhase: "idle",
    socketUrl: null,
    ...overrides,
  };
}

describe("WebSocketConnectionSurface.logic", () => {
  it("forces reconnect on online when the app was offline", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          disconnectedAt: "2026-04-03T20:00:00.000Z",
          online: false,
          phase: "disconnected",
        }),
        "online",
      ),
    ).toBe(true);
  });

  it("forces reconnect on focus only for previously connected disconnected states", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 3,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(true);

    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: false,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 1,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(false);
  });

  it("forces reconnect on focus for exhausted reconnect loops", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 8,
          reconnectPhase: "exhausted",
        }),
        "focus",
      ),
    ).toBe(true);
  });

  it("includes structured websocket diagnostics in copy payloads", () => {
    const details = buildConnectionDiagnosticDetails({
      capturedAt: "2026-04-10T12:10:00.000Z",
      incident: "ws-reconnect-exhausted",
      status: makeStatus({
        attemptCount: 4,
        closeCode: 1006,
        disconnectedAt: "2026-04-10T12:09:00.000Z",
        hasConnected: true,
        lastError: "Unable to connect to the T3 server WebSocket.",
        lastErrorAt: "2026-04-10T12:09:05.000Z",
        phase: "disconnected",
        reconnectAttemptCount: 8,
        reconnectMaxAttempts: 8,
        reconnectPhase: "exhausted",
        socketUrl: "ws://127.0.0.1:51825/ws?token=abc",
      }),
      uiState: "reconnecting",
    });

    expect(details).toContain("incident: ws-reconnect-exhausted");
    expect(details).toContain("capturedAt: 2026-04-10T12:10:00.000Z");
    expect(details).toContain("closeCode: 1006");
    expect(details).toContain("lastError: Unable to connect to the T3 server WebSocket.");
    expect(details).toContain("socket: ws://127.0.0.1:51825/ws?token=abc");
  });

  it("includes slow request metadata in diagnostics", () => {
    const details = buildSlowRpcAckDiagnosticDetails({
      capturedAt: "2026-04-10T12:10:00.000Z",
      requests: [
        {
          requestId: "req-1",
          startedAt: "2026-04-10T12:09:30.000Z",
          startedAtMs: Date.parse("2026-04-10T12:09:30.000Z"),
          tag: "orchestration.sendMessage",
          thresholdMs: 15000,
        },
      ],
      status: makeStatus({
        connectedAt: "2026-04-10T12:09:00.000Z",
        hasConnected: true,
        phase: "connected",
      }),
    });

    expect(details).toContain("incident: rpc-ack-slow");
    expect(details).toContain("slowRequestCount: 1");
    expect(details).toContain("slowRequest.1.requestId: req-1");
    expect(details).toContain("slowRequest.1.tag: orchestration.sendMessage");
    expect(details).toContain("slowRequest.1.ageMs: 30000");
  });
});
