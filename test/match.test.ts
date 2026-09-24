import { describe, expect, it } from "vitest";
import { checkPath, matchesPattern, toPath } from "../src/match.js";
import type { AgentIndexFile } from "../src/types.js";

describe("toPath", () => {
  it("extracts the pathname from a full URL", () => {
    expect(toPath("https://example.com/docs/x?y=1#z")).toBe("/docs/x");
  });

  it("passes bare absolute paths through", () => {
    expect(toPath("/blog/post-1")).toBe("/blog/post-1");
  });

  it("prefixes bare relative paths with a slash", () => {
    expect(toPath("blog/post-1")).toBe("/blog/post-1");
  });
});

describe("matchesPattern (glob-style)", () => {
  it("matches ** across multiple path segments", () => {
    expect(matchesPattern("/docs/**", "/docs/a/b/c")).toBe(true);
    expect(matchesPattern("/docs/**", "/docs")).toBe(false);
  });

  it("matches single-segment * wildcards", () => {
    expect(matchesPattern("/api/*.json", "/api/users.json")).toBe(true);
    expect(matchesPattern("/api/*.json", "/api/v1/users.json")).toBe(false);
  });

  it("does not match unrelated paths", () => {
    expect(matchesPattern("/docs/**", "/blog/post")).toBe(false);
  });
});

describe("checkPath (permission resolution)", () => {
  const index: AgentIndexFile = {
    version: 1,
    default: "disallow",
    contact: "mailto:site@example.com",
    rules: [
      { pattern: "/docs/**", allow: true, rate_limit: 60, require_attribution: true },
      { pattern: "/docs/internal/**", allow: false },
      { pattern: "/blog/**", allow: true, rate_limit: 30 },
      { pattern: "/api/*.json", allow: true, rate_limit: 120, contact: "mailto:api@example.com" },
    ],
  };

  it("falls back to the file default when nothing matches", () => {
    const result = checkPath(index, "/nowhere");
    expect(result.allow).toBe(false);
    expect(result.reason).toBe("default");
    expect(result.rule).toBeUndefined();
  });

  it("applies a matching allow rule and exposes its rate limit + attribution flag", () => {
    const result = checkPath(index, "https://example.com/docs/getting-started");
    expect(result.allow).toBe(true);
    expect(result.reason).toBe("matched-rule");
    expect(result.matchedPattern).toBe("/docs/**");
    expect(result.rateLimit).toBe(60);
    expect(result.requireAttribution).toBe(true);
  });

  it("lets a more specific disallow override a broader allow", () => {
    // /docs/** allows, but /docs/internal/** is more specific and disallows.
    const result = checkPath(index, "/docs/internal/roadmap.md");
    expect(result.allow).toBe(false);
    expect(result.matchedPattern).toBe("/docs/internal/**");
  });

  it("lets a more specific allow override a broader disallow", () => {
    const overridingIndex: AgentIndexFile = {
      version: 1,
      default: "disallow",
      rules: [
        { pattern: "/private/**", allow: false },
        { pattern: "/private/press-kit/**", allow: true, rate_limit: 10 },
      ],
    };
    const result = checkPath(overridingIndex, "/private/press-kit/logo.png");
    expect(result.allow).toBe(true);
    expect(result.matchedPattern).toBe("/private/press-kit/**");
    expect(result.rateLimit).toBe(10);
  });

  it("picks the most specific of several matching patterns regardless of file order", () => {
    const orderIndex: AgentIndexFile = {
      version: 1,
      default: "allow",
      rules: [
        { pattern: "/a/b/c/**", allow: false },
        { pattern: "/a/**", allow: true },
        { pattern: "/a/b/**", allow: false },
      ],
    };
    const result = checkPath(orderIndex, "/a/b/c/d");
    expect(result.matchedPattern).toBe("/a/b/c/**");
    expect(result.allow).toBe(false);
  });

  it("falls back to the rule's own contact, then the file-level contact", () => {
    const jsonResult = checkPath(index, "/api/users.json");
    expect(jsonResult.contact).toBe("mailto:api@example.com");

    const blogResult = checkPath(index, "/blog/hello");
    expect(blogResult.contact).toBe("mailto:site@example.com");
  });

  it("exposes no rate limit when the matched rule doesn't state one", () => {
    const noLimitIndex: AgentIndexFile = {
      version: 1,
      default: "disallow",
      rules: [{ pattern: "/open/**", allow: true }],
    };
    const result = checkPath(noLimitIndex, "/open/thing");
    expect(result.rateLimit).toBeUndefined();
  });
});
