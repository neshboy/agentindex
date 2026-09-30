import { validateAgentIndex } from "./validate.js";
import { checkPath, type CheckResult } from "./match.js";
import type { AgentIndexFile } from "./types.js";
import { WELL_KNOWN_PATH } from "./types.js";

/** Thrown when a site does not publish an AgentIndex file at all. */
export class NoAgentIndexError extends Error {
  constructor(public readonly url: string, public readonly status?: number, reason?: string) {
    super(
      reason
        ? `No AgentIndex file published at ${url} (${reason}).`
        : status !== undefined
          ? `No AgentIndex file published at ${url} (HTTP ${status}).`
          : `No AgentIndex file published at ${url}.`
    );
    this.name = "NoAgentIndexError";
  }
}

/** Thrown when a site's published AgentIndex file fails schema validation. */
export class InvalidAgentIndexError extends Error {
  constructor(public readonly url: string, public readonly errors: string[]) {
    super(`AgentIndex file at ${url} failed validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    this.name = "InvalidAgentIndexError";
  }
}

/** Builds the well-known AgentIndex URL for a given site (any URL on that origin, or a bare host). */
export function wellKnownUrlFor(site: string): string {
  const normalized = /^[a-z]+:\/\//i.test(site) ? site : `https://${site}`;
  const origin = new URL(normalized).origin;
  return `${origin}${WELL_KNOWN_PATH}`;
}

/** How long to wait for the remote site before giving up. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Max response body size we'll read. An AgentIndex file is meant to be a
 * small YAML policy document, so a well-behaved site's response should be
 * nowhere near this; it exists to stop a misbehaving/malicious site from
 * making us buffer an unbounded body in memory.
 */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Reads `response`'s body as text, bailing out once more than `limit` bytes
 * have been read (checking `Content-Length` up front as a fast path).
 */
async function readTextWithLimit(response: Response, limit: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > limit) {
    throw new Error(`response body of ${contentLength} bytes exceeds the ${limit}-byte limit`);
  }

  if (!response.body) {
    return await response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limit) {
          throw new Error(`response body exceeds the ${limit}-byte limit`);
        }
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Performs a real network fetch of a site's `.well-known/agent-index.yaml`,
 * parses it, and validates it against the AgentIndex schema. Throws
 * `NoAgentIndexError` if the site doesn't publish one (e.g. 404/network
 * error, or the request times out), or `InvalidAgentIndexError` if it
 * publishes something that doesn't parse/validate (or is unreasonably
 * large).
 */
export async function fetchAgentIndex(site: string): Promise<AgentIndexFile> {
  const url = wellKnownUrlFor(site);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": "AgentIndex-CLI/0.1 (+https://github.com/agentindex/agentindex)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new NoAgentIndexError(url, undefined, "request timed out");
    }
    throw new NoAgentIndexError(url);
  }

  if (!response.ok) {
    throw new NoAgentIndexError(url, response.status);
  }

  let text: string;
  try {
    text = await readTextWithLimit(response, MAX_BODY_BYTES);
  } catch (err) {
    throw new InvalidAgentIndexError(url, [(err as Error).message]);
  }

  const result = validateAgentIndex(text);
  if (!result.valid || !result.data) {
    throw new InvalidAgentIndexError(
      url,
      result.errors.map((e) => `${e.path}${e.line ? ` (line ${e.line})` : ""}: ${e.message}`)
    );
  }
  return result.data;
}

/**
 * End-to-end helper: fetches a site's AgentIndex file over the network and
 * returns the permission verdict for `targetPathOrUrl`.
 */
export async function fetchAndCheck(
  site: string,
  targetPathOrUrl: string
): Promise<{ index: AgentIndexFile; result: CheckResult; sourceUrl: string }> {
  const sourceUrl = wellKnownUrlFor(site);
  const index = await fetchAgentIndex(site);
  const result = checkPath(index, targetPathOrUrl);
  return { index, result, sourceUrl };
}
