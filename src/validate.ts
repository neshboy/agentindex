import { parseDocument, isMap, isSeq, isScalar, LineCounter } from "yaml";
import type { Node, Pair, YAMLMap, YAMLSeq } from "yaml";
import type { AgentIndexFile, ValidationError, ValidationResult } from "./types.js";
import { SUPPORTED_VERSIONS } from "./types.js";

/** Looks a locations up in a mapping's items by scalar key name. */
function getPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((p) => isScalar(p.key) && (p.key as any).value === key);
}

/** Resolves 1-based line/column info for a YAML AST node, if possible. */
function posOf(
  node: unknown,
  lineCounter: LineCounter
): { line: number; column: number } | undefined {
  const range = (node as Node | undefined)?.range;
  if (!range) return undefined;
  const { line, col } = lineCounter.linePos(range[0]);
  return { line, column: col };
}

/** Extracts the plain JS value out of a YAML AST node (scalar or otherwise). */
function scalarValue(node: unknown): unknown {
  if (node === undefined || node === null) return undefined;
  if (isScalar(node)) return (node as { value: unknown }).value;
  const maybeToJSON = (node as { toJSON?: () => unknown }).toJSON;
  return typeof maybeToJSON === "function" ? maybeToJSON.call(node) : node;
}

const CONTACT_RE = /^(mailto:.+@.+\..+|https?:\/\/\S+|\S+@\S+\.\S+)$/i;
/** A path pattern must be an absolute, non-empty string. */
const PATTERN_RE = /^\/\S*$/;

export function validateAgentIndex(text: string): ValidationResult {
  const errors: ValidationError[] = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: true });

  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      const pos = err.linePos?.[0];
      errors.push({
        message: `YAML syntax error: ${err.message}`,
        path: "<root>",
        line: pos?.line,
        column: pos?.col,
      });
    }
    return { valid: false, errors };
  }

  const root = doc.contents;
  if (!root || !isMap(root)) {
    const pos = posOf(root, lineCounter) ?? { line: 1, column: 1 };
    errors.push({
      message: "Document root must be a YAML mapping (key: value pairs).",
      path: "<root>",
      ...pos,
    });
    return { valid: false, errors };
  }

  const rootMap = root as YAMLMap;
  const rootPos = posOf(rootMap, lineCounter) ?? { line: 1, column: 1 };

  // --- version ---------------------------------------------------------
  let version: number | undefined;
  const versionPair = getPair(rootMap, "version");
  if (!versionPair) {
    errors.push({
      message: "Missing required field: version",
      path: "version",
      ...rootPos,
    });
  } else {
    const node = versionPair.value;
    const value = scalarValue(node);
    const pos = posOf(node, lineCounter) ?? rootPos;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push({
        message: `Field "version" must be an integer, got ${JSON.stringify(value)}`,
        path: "version",
        ...pos,
      });
    } else if (!SUPPORTED_VERSIONS.includes(value)) {
      errors.push({
        message: `Unsupported version: ${value} (supported: ${SUPPORTED_VERSIONS.join(", ")})`,
        path: "version",
        ...pos,
      });
    } else {
      version = value;
    }
  }

  // --- default -----------------------------------------------------------
  let defaultPolicy: "allow" | "disallow" | undefined;
  const defaultPair = getPair(rootMap, "default");
  if (!defaultPair) {
    errors.push({
      message: "Missing required field: default",
      path: "default",
      ...rootPos,
    });
  } else {
    const node = defaultPair.value;
    const value = scalarValue(node);
    const pos = posOf(node, lineCounter) ?? rootPos;
    if (value !== "allow" && value !== "disallow") {
      errors.push({
        message: `Field "default" must be "allow" or "disallow", got ${JSON.stringify(value)}`,
        path: "default",
        ...pos,
      });
    } else {
      defaultPolicy = value;
    }
  }

  // --- contact (optional, top-level) -------------------------------------
  let contact: string | undefined;
  const contactPair = getPair(rootMap, "contact");
  if (contactPair) {
    const node = contactPair.value;
    const value = scalarValue(node);
    const pos = posOf(node, lineCounter) ?? rootPos;
    if (typeof value !== "string" || !CONTACT_RE.test(value)) {
      errors.push({
        message: `Field "contact" must be an email, mailto: URI, or https URL, got ${JSON.stringify(value)}`,
        path: "contact",
        ...pos,
      });
    } else {
      contact = value;
    }
  }

  // --- rules ---------------------------------------------------------
  const rules: AgentIndexFile["rules"] = [];
  const rulesPair = getPair(rootMap, "rules");
  if (!rulesPair) {
    errors.push({
      message: "Missing required field: rules (use an empty list [] if there are none)",
      path: "rules",
      ...rootPos,
    });
  } else {
    const seqNode = rulesPair.value;
    const seqPos = posOf(seqNode, lineCounter) ?? rootPos;
    if (!seqNode || !isSeq(seqNode)) {
      errors.push({
        message: "Field \"rules\" must be a list of rule objects",
        path: "rules",
        ...seqPos,
      });
    } else {
      (seqNode as YAMLSeq).items.forEach((item, index) => {
        const rulePath = `rules[${index}]`;
        const itemPos = posOf(item, lineCounter) ?? seqPos;
        if (!isMap(item)) {
          errors.push({
            message: `Rule at ${rulePath} must be a mapping with at least "pattern" and "allow"`,
            path: rulePath,
            ...itemPos,
          });
          return;
        }
        const ruleMap = item as YAMLMap;

        // pattern
        let pattern: string | undefined;
        const patternPair = getPair(ruleMap, "pattern");
        if (!patternPair) {
          errors.push({
            message: `Rule ${rulePath} is missing required field: pattern`,
            path: `${rulePath}.pattern`,
            ...itemPos,
          });
        } else {
          const node = patternPair.value;
          const value = scalarValue(node);
          const pos = posOf(node, lineCounter) ?? itemPos;
          if (typeof value !== "string" || !PATTERN_RE.test(value)) {
            errors.push({
              message: `Invalid path pattern at ${rulePath}.pattern: ${JSON.stringify(
                value
              )} (must be a non-empty string starting with "/", with no spaces)`,
              path: `${rulePath}.pattern`,
              ...pos,
            });
          } else {
            pattern = value;
          }
        }

        // allow
        let allow: boolean | undefined;
        const allowPair = getPair(ruleMap, "allow");
        if (!allowPair) {
          errors.push({
            message: `Rule ${rulePath} is missing required field: allow`,
            path: `${rulePath}.allow`,
            ...itemPos,
          });
        } else {
          const node = allowPair.value;
          const value = scalarValue(node);
          const pos = posOf(node, lineCounter) ?? itemPos;
          if (typeof value !== "boolean") {
            errors.push({
              message: `Field ${rulePath}.allow must be a boolean (true/false), got ${JSON.stringify(
                value
              )}`,
              path: `${rulePath}.allow`,
              ...pos,
            });
          } else {
            allow = value;
          }
        }

        // rate_limit (optional)
        let rateLimit: number | undefined;
        const rateLimitPair = getPair(ruleMap, "rate_limit");
        if (rateLimitPair) {
          const node = rateLimitPair.value;
          const value = scalarValue(node);
          const pos = posOf(node, lineCounter) ?? itemPos;
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            errors.push({
              message: `Invalid rate_limit at ${rulePath}.rate_limit: ${JSON.stringify(
                value
              )} (must be a positive number of requests per minute)`,
              path: `${rulePath}.rate_limit`,
              ...pos,
            });
          } else {
            rateLimit = value;
          }
        }

        // require_attribution (optional)
        let requireAttribution: boolean | undefined;
        const attrPair = getPair(ruleMap, "require_attribution");
        if (attrPair) {
          const node = attrPair.value;
          const value = scalarValue(node);
          const pos = posOf(node, lineCounter) ?? itemPos;
          if (typeof value !== "boolean") {
            errors.push({
              message: `Field ${rulePath}.require_attribution must be a boolean, got ${JSON.stringify(
                value
              )}`,
              path: `${rulePath}.require_attribution`,
              ...pos,
            });
          } else {
            requireAttribution = value;
          }
        }

        // contact (optional, per-rule override)
        let ruleContact: string | undefined;
        const ruleContactPair = getPair(ruleMap, "contact");
        if (ruleContactPair) {
          const node = ruleContactPair.value;
          const value = scalarValue(node);
          const pos = posOf(node, lineCounter) ?? itemPos;
          if (typeof value !== "string" || !CONTACT_RE.test(value)) {
            errors.push({
              message: `Field ${rulePath}.contact must be an email, mailto: URI, or https URL, got ${JSON.stringify(
                value
              )}`,
              path: `${rulePath}.contact`,
              ...pos,
            });
          } else {
            ruleContact = value;
          }
        }

        if (pattern !== undefined && allow !== undefined) {
          rules.push({
            pattern,
            allow,
            ...(rateLimit !== undefined ? { rate_limit: rateLimit } : {}),
            ...(requireAttribution !== undefined ? { require_attribution: requireAttribution } : {}),
            ...(ruleContact !== undefined ? { contact: ruleContact } : {}),
          });
        }
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const data: AgentIndexFile = {
    version: version as number,
    default: defaultPolicy as "allow" | "disallow",
    ...(contact !== undefined ? { contact } : {}),
    rules,
  };

  return { valid: true, errors: [], data };
}
