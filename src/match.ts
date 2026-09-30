import { minimatch } from "minimatch";
import type { AgentIndexFile, AgentIndexRule } from "./types.js";

/** The outcome of checking a target path against an AgentIndexFile. */
export interface CheckResult {
  /** Final allow/disallow verdict. */
  allow: boolean;
  /** Whether the verdict came from a specific rule, or the file's default. */
  reason: "matched-rule" | "default";
  /** The path that was actually matched against (after normalization). */
  path: string;
  /** The winning rule, if any. */
  rule?: AgentIndexRule;
  /** Index of the winning rule within `rules`, if any. */
  ruleIndex?: number;
  /** Convenience accessor for the winning rule's pattern. */
  matchedPattern?: string;
  /** Requests-per-minute limit that applies, if the winning rule states one. */
  rateLimit?: number;
  /** Whether attribution is required, if the winning rule states so. */
  requireAttribution?: boolean;
  /** Effective contact address (rule-level override, else file-level, else undefined). */
  contact?: string;
}

/**
 * Turns a URL or a bare path into an absolute path suitable for matching,
 * e.g. "https://example.com/docs/x?y=1" -> "/docs/x".
 */
export function toPath(urlOrPath: string): string {
  const trimmed = urlOrPath.trim();
  try {
    // Throws if `trimmed` isn't a fully-qualified URL (no scheme/host).
    const u = new URL(trimmed);
    return u.pathname.length > 0 ? u.pathname : "/";
  } catch {
    const bare = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    // Strip any trailing query string/fragment so bare paths normalize the
    // same way full URLs do (see the `new URL(...).pathname` branch above).
    return bare.split(/[?#]/)[0] || "/";
  }
}

/**
 * How "specific" a pattern is, for most-specific-pattern-wins resolution
 * (the same real-world semantics robots.txt uses: the record that matches
 * the most characters of the path wins). We rank first by the length of the
 * pattern's literal (non-wildcard) prefix, then by total pattern length as
 * a tie-breaker, so "/docs/internal/**" outranks "/docs/**" for paths under
 * /docs/internal/, even though both match.
 */
function specificityOf(pattern: string): number {
  const wildcardIndex = pattern.search(/[*?[\]{}]/);
  const literalPrefixLength = wildcardIndex === -1 ? pattern.length : wildcardIndex;
  return literalPrefixLength * 100_000 + pattern.length;
}

/** Real glob-style matching (minimatch) of a path against a rule pattern. */
export function matchesPattern(pattern: string, path: string): boolean {
  return minimatch(path, pattern, { dot: true });
}

/**
 * Resolves which rule (if any) applies to `targetPathOrUrl` and returns a
 * full verdict. Ties among equally-specific matching rules are broken by
 * "last one in the file wins", mirroring how most real policy files (and
 * robots.txt implementations) treat later, more-specific-looking entries.
 */
export function checkPath(index: AgentIndexFile, targetPathOrUrl: string): CheckResult {
  const path = toPath(targetPathOrUrl);

  let best: { rule: AgentIndexRule; index: number; specificity: number } | undefined;
  index.rules.forEach((rule, ruleIndex) => {
    if (!matchesPattern(rule.pattern, path)) return;
    const specificity = specificityOf(rule.pattern);
    if (
      !best ||
      specificity > best.specificity ||
      (specificity === best.specificity && ruleIndex > best.index)
    ) {
      best = { rule, index: ruleIndex, specificity };
    }
  });

  if (best) {
    const { rule, index: ruleIndex } = best;
    return {
      allow: rule.allow,
      reason: "matched-rule",
      path,
      rule,
      ruleIndex,
      matchedPattern: rule.pattern,
      rateLimit: rule.rate_limit,
      requireAttribution: rule.require_attribution,
      contact: rule.contact ?? index.contact,
    };
  }

  return {
    allow: index.default === "allow",
    reason: "default",
    path,
    contact: index.contact,
  };
}
