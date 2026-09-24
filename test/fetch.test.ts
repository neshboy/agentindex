import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { fetchAgentIndex, fetchAndCheck, wellKnownUrlFor, NoAgentIndexError, InvalidAgentIndexError } from "../src/fetch.js";

const VALID_YAML = `
version: 1
default: disallow
contact: "mailto:agents@example.com"
rules:
  - pattern: "/docs/**"
    allow: true
    rate_limit: 45
    require_attribution: true
  - pattern: "/docs/internal/**"
    allow: false
`;

const INVALID_YAML = `
version: 1
default: not-a-real-policy
rules: "nope"
`;

type Handler = () => { status: number; body: string; contentType?: string };

describe("fetchAgentIndex / fetchAndCheck (real HTTP round-trip)", () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;

  beforeEach(async () => {
    handler = () => ({ status: 404, body: "not found" });
    server = createServer((req, res) => {
      if (req.url === "/.well-known/agent-index.yaml") {
        const { status, body, contentType } = handler();
        res.writeHead(status, { "content-type": contentType ?? "text/yaml" });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to bind test server");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("computes the well-known URL for a site", () => {
    expect(wellKnownUrlFor(baseUrl)).toBe(`${baseUrl}/.well-known/agent-index.yaml`);
  });

  it("fetches and parses a real AgentIndex file served over HTTP", async () => {
    handler = () => ({ status: 200, body: VALID_YAML });
    const index = await fetchAgentIndex(baseUrl);
    expect(index.version).toBe(1);
    expect(index.default).toBe("disallow");
    expect(index.rules).toHaveLength(2);
  });

  it("performs an end-to-end fetch + permission check over the network", async () => {
    handler = () => ({ status: 200, body: VALID_YAML });
    const { result, sourceUrl } = await fetchAndCheck(baseUrl, "/docs/guide");
    expect(sourceUrl).toBe(`${baseUrl}/.well-known/agent-index.yaml`);
    expect(result.allow).toBe(true);
    expect(result.matchedPattern).toBe("/docs/**");
    expect(result.rateLimit).toBe(45);

    const internal = await fetchAndCheck(baseUrl, "/docs/internal/secret");
    expect(internal.result.allow).toBe(false);
    expect(internal.result.matchedPattern).toBe("/docs/internal/**");
  });

  it("throws NoAgentIndexError when the site returns 404 for the well-known path", async () => {
    handler = () => ({ status: 404, body: "not found" });
    await expect(fetchAgentIndex(baseUrl)).rejects.toThrow(NoAgentIndexError);
  });

  it("throws InvalidAgentIndexError when the published file fails schema validation", async () => {
    handler = () => ({ status: 200, body: INVALID_YAML });
    await expect(fetchAgentIndex(baseUrl)).rejects.toThrow(InvalidAgentIndexError);
  });

  it("throws NoAgentIndexError when there is nothing listening at all", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(fetchAgentIndex(baseUrl)).rejects.toThrow(NoAgentIndexError);
    // restart so afterEach's close() doesn't error on an already-closed server
    server = createServer((_req, res) => res.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
});
