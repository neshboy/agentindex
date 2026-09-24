import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateAgentIndex } from "../src/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

describe("validateAgentIndex", () => {
  it("accepts a well-formed file and returns typed data", () => {
    const result = validateAgentIndex(fixture("valid.yaml"));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data).toBeDefined();
    expect(result.data!.version).toBe(1);
    expect(result.data!.default).toBe("disallow");
    expect(result.data!.contact).toBe("mailto:agents@example.com");
    expect(result.data!.rules).toHaveLength(4);
    expect(result.data!.rules[0]).toEqual({
      pattern: "/docs/**",
      allow: true,
      rate_limit: 60,
      require_attribution: true,
    });
  });

  it("rejects a file missing the required version field", () => {
    const result = validateAgentIndex(fixture("missing-version.yaml"));
    expect(result.valid).toBe(false);
    expect(result.data).toBeUndefined();
    const err = result.errors.find((e) => e.path === "version");
    expect(err).toBeDefined();
    expect(err!.message).toBe("Missing required field: version");
  });

  it("rejects a file missing the required rules field", () => {
    const result = validateAgentIndex(fixture("missing-rules.yaml"));
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.path === "rules");
    expect(err).toBeDefined();
    expect(err!.message).toBe(
      "Missing required field: rules (use an empty list [] if there are none)"
    );
  });

  it("rejects an invalid default policy value, with a line number", () => {
    const result = validateAgentIndex(fixture("bad-default.yaml"));
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.path === "default");
    expect(err).toBeDefined();
    expect(err!.message).toBe('Field "default" must be "allow" or "disallow", got "maybe"');
    expect(err!.line).toBe(2);
  });

  it("rejects invalid path patterns (non-absolute and empty)", () => {
    const result = validateAgentIndex(fixture("bad-pattern.yaml"));
    expect(result.valid).toBe(false);
    const errs = result.errors.filter((e) => e.path.endsWith(".pattern"));
    expect(errs).toHaveLength(2);
    expect(errs[0].message).toContain('Invalid path pattern at rules[0].pattern: "docs/**"');
    expect(errs[1].message).toContain('Invalid path pattern at rules[1].pattern: ""');
  });

  it("rejects invalid rate_limit values (negative and non-numeric)", () => {
    const result = validateAgentIndex(fixture("bad-rate-limit.yaml"));
    expect(result.valid).toBe(false);
    const errs = result.errors.filter((e) => e.path.endsWith(".rate_limit"));
    expect(errs).toHaveLength(2);
    expect(errs[0].path).toBe("rules[0].rate_limit");
    expect(errs[0].message).toContain("must be a positive number of requests per minute");
    expect(errs[1].path).toBe("rules[1].rate_limit");
    expect(errs[1].message).toContain('rules[1].rate_limit: "fast"');
  });

  it("rejects rules missing required pattern/allow fields", () => {
    const result = validateAgentIndex(fixture("missing-rule-fields.yaml"));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "rules[0].allow",
          message: "Rule rules[0] is missing required field: allow",
        }),
        expect.objectContaining({
          path: "rules[1].pattern",
          message: "Rule rules[1] is missing required field: pattern",
        }),
      ])
    );
  });

  it("reports a YAML syntax error for malformed indentation", () => {
    const result = validateAgentIndex(fixture("syntax-error.yaml"));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/YAML syntax error/);
    expect(result.errors[0].line).toBeGreaterThan(0);
  });

  it("exposes rate_limit and require_attribution on parsed rules", () => {
    const result = validateAgentIndex(fixture("valid.yaml"));
    expect(result.valid).toBe(true);
    const blogRule = result.data!.rules.find((r) => r.pattern === "/blog/**");
    expect(blogRule?.rate_limit).toBe(30);
    expect(blogRule?.require_attribution).toBeUndefined();
    const apiRule = result.data!.rules.find((r) => r.pattern === "/api/*.json");
    expect(apiRule?.rate_limit).toBe(120);
    expect(apiRule?.contact).toBe("mailto:api-team@example.com");
  });
});
