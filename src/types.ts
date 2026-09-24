/**
 * Core types for the AgentIndex spec.
 *
 * See README.md for the full, normative spec definition. This file mirrors
 * that document exactly and is the single source of truth for the shape of
 * a parsed `agent-index.yaml` file within this codebase.
 */

/** The overall fallback stance for any path that no rule matches. */
export type DefaultPolicy = "allow" | "disallow";

/** A single per-path-pattern rule. */
export interface AgentIndexRule {
  /**
   * A glob-style path pattern, always interpreted as absolute
   * (rooted at the site's origin), e.g. "/docs/**", "/api/*.json".
   */
  pattern: string;

  /** Whether agents are allowed to fetch paths matching `pattern`. */
  allow: boolean;

  /**
   * Maximum requests per minute an agent should make against paths
   * matching this rule. Omitted means "no explicit limit stated".
   */
  rate_limit?: number;

  /**
   * If true, agents that use content from paths matching this rule
   * must provide attribution (e.g. a visible link back to the source).
   */
  require_attribution?: boolean;

  /**
   * Contact info (mailto: URI, https URL, or bare email) for questions
   * about this specific rule. Overrides the top-level `contact` field.
   */
  contact?: string;
}

/** The parsed, in-memory representation of an agent-index.yaml file. */
export interface AgentIndexFile {
  /** Spec version. Currently only `1` is supported. */
  version: number;

  /** Fallback policy applied when no rule matches a given path. */
  default: DefaultPolicy;

  /** Site-wide contact info for questions about this policy. */
  contact?: string;

  /** Ordered list of path-pattern rules. May be empty. */
  rules: AgentIndexRule[];
}

/** A single, precise validation problem found in a candidate file. */
export interface ValidationError {
  /** Human-readable description of what is wrong. */
  message: string;
  /** JSON-pointer-ish path to the offending field, e.g. "rules[2].rate_limit". */
  path: string;
  /** 1-based line number in the source file, when it could be resolved. */
  line?: number;
  /** 1-based column number in the source file, when it could be resolved. */
  column?: number;
}

/** Result of validating a candidate agent-index.yaml document. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** The parsed data, only present when `valid` is true. */
  data?: AgentIndexFile;
}

/** The well-known path a site should publish its AgentIndex file at. */
export const WELL_KNOWN_PATH = "/.well-known/agent-index.yaml";

/** Currently supported spec version(s). */
export const SUPPORTED_VERSIONS = [1];
