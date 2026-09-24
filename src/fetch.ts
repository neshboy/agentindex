import { validateAgentIndex } from "./validate.js";
import { checkPath, type CheckResult } from "./match.js";
import type { AgentIndexFile } from "./types.js";
import { WELL_KNOWN_PATH } from "./types.js";

/** Thrown when a site does not publish an AgentIndex file at all. */
export class NoAgentIndexError extends Error {
  constructor(public readonly url: string, public readonly status?: number) {
    super(
      status !== undefined
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

/**
 * Performs a real network fetch of a site's `.well-known/agent-index.yaml`,
 * parses it, and validates it against the AgentIndex schema. Throws
 * `NoAgentIndexError` if the site doesn't publish one (e.g. 404/network
 * error), or `InvalidAgentIndexError` if it publishes something that
 * doesn't parse/validate.
 */
export async function fetchAgentIndex(site: string): Promise<AgentIndexFile> {
  const url = wellKnownUrlFor(site);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": "AgentIndex-CLI/0.1 (+https://github.com/agentindex/agentindex)" },
    });
  } catch (err) {
    throw new NoAgentIndexError(url);
  }

  if (!response.ok) {
    throw new NoAgentIndexError(url, response.status);
  }

  const text = await response.text();
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
