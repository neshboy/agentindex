#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateAgentIndex } from "./validate.js";
import { checkPath } from "./match.js";
import { fetchAndCheck, NoAgentIndexError, InvalidAgentIndexError } from "./fetch.js";
import type { ValidationError } from "./types.js";

const HELP = `agentindex - robots.txt for AI agents

Usage:
  agentindex validate <file>                 Validate a local AgentIndex YAML file
  agentindex check <url-or-path> --index <file>
                                              Check permission for a path against a local file
  agentindex fetch <site> <url-or-path>       Fetch a site's published AgentIndex file over
                                              the network and check permission for a path
  agentindex help                             Show this help

Examples:
  agentindex validate ./agent-index.yaml
  agentindex check /docs/internal/secret --index ./agent-index.yaml
  agentindex fetch https://example.com /blog/my-post
`;

function printErrors(file: string, errors: ValidationError[]): void {
  for (const err of errors) {
    const loc = err.line ? `${file}:${err.line}${err.column ? `:${err.column}` : ""}` : file;
    console.error(`  ${loc}  [${err.path}]  ${err.message}`);
  }
}

function formatVerdict(result: {
  allow: boolean;
  reason: string;
  path: string;
  matchedPattern?: string;
  rateLimit?: number;
  requireAttribution?: boolean;
  contact?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Path:        ${result.path}`);
  lines.push(`Verdict:     ${result.allow ? "ALLOW" : "DISALLOW"}`);
  lines.push(
    `Matched by:  ${result.reason === "matched-rule" ? `rule "${result.matchedPattern}"` : "default policy"}`
  );
  if (result.rateLimit !== undefined) lines.push(`Rate limit:  ${result.rateLimit} req/min`);
  if (result.requireAttribution) lines.push(`Attribution: required`);
  if (result.contact) lines.push(`Contact:     ${result.contact}`);
  return lines.join("\n");
}

async function cmdValidate(args: string[]): Promise<number> {
  const file = args[0];
  if (!file) {
    console.error("Usage: agentindex validate <file>");
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch (err) {
    console.error(`Could not read file: ${file} (${(err as Error).message})`);
    return 2;
  }
  const result = validateAgentIndex(text);
  if (!result.valid) {
    console.error(`Invalid AgentIndex file: ${file}`);
    printErrors(file, result.errors);
    return 1;
  }
  console.log(`Valid AgentIndex file: ${file}`);
  console.log(`  version: ${result.data!.version}`);
  console.log(`  default: ${result.data!.default}`);
  console.log(`  rules:   ${result.data!.rules.length}`);
  return 0;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      flags[key] = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function cmdCheck(args: string[]): Promise<number> {
  const { positional, flags } = parseFlags(args);
  const target = positional[0];
  const indexFile = flags["index"];
  if (!target || !indexFile) {
    console.error("Usage: agentindex check <url-or-path> --index <file>");
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(indexFile, "utf-8");
  } catch (err) {
    console.error(`Could not read index file: ${indexFile} (${(err as Error).message})`);
    return 2;
  }
  const validated = validateAgentIndex(text);
  if (!validated.valid) {
    console.error(`Invalid AgentIndex file: ${indexFile}`);
    printErrors(indexFile, validated.errors);
    return 1;
  }
  const result = checkPath(validated.data!, target);
  console.log(formatVerdict(result));
  return result.allow ? 0 : 1;
}

async function cmdFetch(args: string[]): Promise<number> {
  const { positional } = parseFlags(args);
  const [site, target] = positional;
  if (!site || !target) {
    console.error("Usage: agentindex fetch <site> <url-or-path>");
    return 2;
  }
  try {
    const { result, sourceUrl } = await fetchAndCheck(site, target);
    console.log(`Fetched:     ${sourceUrl}`);
    console.log(formatVerdict(result));
    return result.allow ? 0 : 1;
  } catch (err) {
    if (err instanceof NoAgentIndexError) {
      console.error(err.message);
      return 1;
    }
    if (err instanceof InvalidAgentIndexError) {
      console.error(err.message);
      return 1;
    }
    console.error(`Unexpected error: ${(err as Error).message}`);
    return 2;
  }
}

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case "validate":
      return cmdValidate(rest);
    case "check":
      return cmdCheck(rest);
    case "fetch":
      return cmdFetch(rest);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      return command === undefined ? 2 : 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  }
);
