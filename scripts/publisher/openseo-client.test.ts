import { describe, expect, it } from "vitest";
import { parseRpcBody } from "./openseo-client";

describe("parseRpcBody", () => {
  it("reads the JSON-RPC message from an SSE stream or from plain JSON", () => {
    const message = { jsonrpc: "2.0", id: 1, result: { ok: true } };
    const sse = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    expect(parseRpcBody(sse, "text/event-stream")).toEqual(message);
    expect(parseRpcBody(JSON.stringify(message), "application/json")).toEqual(
      message,
    );
  });
});
