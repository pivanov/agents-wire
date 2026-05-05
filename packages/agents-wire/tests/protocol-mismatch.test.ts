import { describe, expect, test } from "bun:test";
import { ACP_PROTOCOL_VERSION } from "@/constants";
import { ProtocolVersionMismatchError, WireError } from "@/errors";
import { connectMockHost } from "@/testing/mock-host";

describe("ProtocolVersionMismatchError", () => {
  test("constructor sets code to protocol-mismatch", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err.code).toBe("protocol-mismatch");
  });

  test("constructor sets agent field", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err.agent).toBe("claude");
  });

  test("constructor sets clientVersion and agentVersion", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err.clientVersion).toBe(1);
    expect(err.agentVersion).toBe(99);
  });

  test("is instanceof WireError", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err).toBeInstanceOf(WireError);
  });

  test("message includes agent name, versions", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err.message).toContain("claude");
    expect(err.message).toContain("99");
    expect(err.message).toContain("1");
  });

  test("name is ProtocolVersionMismatchError", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err.name).toBe("ProtocolVersionMismatchError");
  });

  test("ACP_PROTOCOL_VERSION constant is 1", () => {
    expect(ACP_PROTOCOL_VERSION).toBe(1);
  });

  test("createWireHost throws ProtocolVersionMismatchError when agent protocolVersion > client", async () => {
    // connectMockHost internally calls createWireHost; when the mock returns protocolVersion: 99,
    // createWireHost should throw ProtocolVersionMismatchError before returning the host.
    let caught: unknown;
    try {
      await connectMockHost({ protocolVersion: 99 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProtocolVersionMismatchError);
    const err = caught as ProtocolVersionMismatchError;
    expect(err.agentVersion).toBe(99);
    expect(err.clientVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(err.agent).toBe("mock");
  });
});
