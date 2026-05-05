import { describe, expect, test } from "bun:test";
import { CapabilityNotSupportedError } from "@/errors";
import { validateMcpServersWithCapabilities } from "@/runtime/host";
import type { IAgentCapabilities } from "@/types/agent";
import type { IMcpServer } from "@/types/options";

const makeCapabilities = (http: boolean, sse: boolean): IAgentCapabilities => ({
  loadSession: false,
  forkSession: false,
  resumeSession: false,
  closeSession: false,
  listSessions: false,
  additionalDirectories: false,
  mcp: { stdio: true, http, sse },
  prompt: { text: true, image: false, audio: false, embeddedContext: false },
});

const stdioServer: IMcpServer = { type: "stdio", name: "my-stdio", command: "npx", args: ["some-server"] };
const httpServer: IMcpServer = { type: "http", name: "my-http", url: "http://localhost:3000" };
const sseServer: IMcpServer = { type: "sse", name: "my-sse", url: "http://localhost:4000/sse" };

describe("validateMcpServersWithCapabilities", () => {
  test("stdio server is always allowed when http and sse are false", () => {
    const caps = makeCapabilities(false, false);
    expect(() => validateMcpServersWithCapabilities("claude", caps, [stdioServer])).not.toThrow();
  });

  test("stdio server is allowed when http and sse are true", () => {
    const caps = makeCapabilities(true, true);
    expect(() => validateMcpServersWithCapabilities("claude", caps, [stdioServer])).not.toThrow();
  });

  test("http server throws CapabilityNotSupportedError when http capability is false", () => {
    const caps = makeCapabilities(false, false);
    expect(() => validateMcpServersWithCapabilities("cursor", caps, [httpServer])).toThrow(CapabilityNotSupportedError);
  });

  test("sse server throws CapabilityNotSupportedError when sse capability is false", () => {
    const caps = makeCapabilities(false, false);
    expect(() => validateMcpServersWithCapabilities("copilot", caps, [sseServer])).toThrow(CapabilityNotSupportedError);
  });

  test("http server is allowed when http capability is true", () => {
    const caps = makeCapabilities(true, false);
    expect(() => validateMcpServersWithCapabilities("claude", caps, [httpServer])).not.toThrow();
  });

  test("sse server is allowed when sse capability is true", () => {
    const caps = makeCapabilities(false, true);
    expect(() => validateMcpServersWithCapabilities("claude", caps, [sseServer])).not.toThrow();
  });

  test("thrown error has code === 'capability-not-supported'", () => {
    const caps = makeCapabilities(false, false);
    let caught: unknown;
    try {
      validateMcpServersWithCapabilities("cursor", caps, [httpServer]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CapabilityNotSupportedError);
    expect((caught as CapabilityNotSupportedError).code).toBe("capability-not-supported");
  });

  test("thrown error has agent === the provided agentId", () => {
    const caps = makeCapabilities(false, false);
    let caught: unknown;
    try {
      validateMcpServersWithCapabilities("cursor", caps, [httpServer]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CapabilityNotSupportedError);
    expect((caught as CapabilityNotSupportedError).agent).toBe("cursor");
  });

  test("sse error has agent === the provided agentId", () => {
    const caps = makeCapabilities(false, false);
    let caught: unknown;
    try {
      validateMcpServersWithCapabilities("copilot", caps, [sseServer]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CapabilityNotSupportedError);
    expect((caught as CapabilityNotSupportedError).agent).toBe("copilot");
    expect((caught as CapabilityNotSupportedError).code).toBe("capability-not-supported");
  });

  test("empty server list never throws", () => {
    const caps = makeCapabilities(false, false);
    expect(() => validateMcpServersWithCapabilities("claude", caps, [])).not.toThrow();
  });

  test("mixed list with stdio and http throws when http not supported", () => {
    const caps = makeCapabilities(false, false);
    expect(() => validateMcpServersWithCapabilities("cursor", caps, [stdioServer, httpServer])).toThrow(CapabilityNotSupportedError);
  });

  test("mixed list with all supported types does not throw", () => {
    const caps = makeCapabilities(true, true);
    expect(() => validateMcpServersWithCapabilities("claude", caps, [stdioServer, httpServer, sseServer])).not.toThrow();
  });
});
