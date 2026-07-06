/**
 * PLAN-thinking-gate Phase 5 (Wave 1, w1-p5): the `--benchmark` competitive-
 * benchmark pattern must be REGISTERED across all three source files so the flag
 * is NOT inert (no fallback to the default single-agent spawn), and the
 * benchmark-agent must write a typed BenchmarkScorecard. The loom-benchmark perf
 * skill (a distinct resource that shares the stem) must be untouched.
 *
 * Structural test: asserts the wiring exists and is internally consistent —
 * the trigger declared in orchestration.toml has a matching executor section and
 * a pattern definition, and the agent conforms to the scorecard contract.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const TOML = readFileSync(resolve(ROOT, ".claude/orchestration.toml"), "utf8");
const EXECUTOR = readFileSync(resolve(ROOT, "protocols/pattern-executor.md"), "utf8");
const PATTERNS = readFileSync(resolve(ROOT, "protocols/orchestration-patterns.md"), "utf8");
const AGENT = readFileSync(resolve(ROOT, "agents/benchmark-agent.md"), "utf8");

/** Extract the body of the `[patterns.benchmark]` table (up to the next table header). */
function benchmarkTable(toml: string): string | null {
  const start = toml.indexOf("[patterns.benchmark]");
  if (start === -1) return null;
  const rest = toml.slice(start + "[patterns.benchmark]".length);
  const nextHeader = rest.search(/\n\[[^\]]+\]/);
  return nextHeader === -1 ? rest : rest.slice(0, nextHeader);
}

/** Parse a `key = "value"` string field out of a TOML fragment. */
function tomlStr(fragment: string, key: string): string | null {
  const m = fragment.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : null;
}

describe("orchestration.toml — [patterns.benchmark] registration", () => {
  const table = benchmarkTable(TOML);

  it("declares the [patterns.benchmark] table", () => {
    expect(table).not.toBeNull();
  });

  it("has a non-empty trigger (so the flag can match)", () => {
    const trigger = tomlStr(table!, "trigger");
    expect(trigger).toBeTruthy();
    expect(trigger).toBe("competitive-benchmark");
  });

  it("is type = benchmark and spawns the benchmark-agent", () => {
    expect(tomlStr(table!, "type")).toBe("benchmark");
    expect(tomlStr(table!, "agent")).toBe("benchmark-agent");
  });

  it("preserves the untouched core config (settings/execution/wiki/domain)", () => {
    expect(TOML).toContain("[settings]");
    expect(TOML).toContain("[execution.agents]");
    expect(TOML).toContain("[wiki]");
    expect(TOML).toContain("[domain]");
  });
});

describe("pattern-executor.md — matching ### Benchmark section (non-inert)", () => {
  it("has a ### Benchmark execution section", () => {
    expect(EXECUTOR).toMatch(/^###\s+Benchmark\s*$/m);
  });

  it("names benchmark-agent and the BenchmarkScorecard it writes", () => {
    const idx = EXECUTOR.indexOf("### Benchmark");
    const section = EXECUTOR.slice(idx);
    expect(section).toContain("benchmark-agent");
    expect(section).toContain("BenchmarkScorecard");
  });

  it("documents that a registered pattern beats the default single-agent spawn", () => {
    // The Trigger-Matching fallback wording must still exist...
    expect(EXECUTOR).toContain("fall back to default single-agent spawn");
    // ...and the Benchmark section must explain it overrides that fallback.
    const section = EXECUTOR.slice(EXECUTOR.indexOf("### Benchmark"));
    expect(section.toLowerCase()).toContain("non-inert");
  });

  it("lists benchmark in the PatternResult type enum", () => {
    expect(EXECUTOR).toMatch(/`benchmark`/);
  });
});

describe("orchestration-patterns.md — pattern definition", () => {
  it("defines a Benchmark pattern section", () => {
    expect(PATTERNS).toMatch(/##\s+Pattern\s+7:\s+Benchmark/);
  });

  it("shows the [patterns.benchmark] config with the same trigger", () => {
    expect(PATTERNS).toContain("[patterns.benchmark]");
    expect(PATTERNS).toContain('trigger = "competitive-benchmark"');
  });

  it("documents the name-collision distinction from the loom-benchmark perf skill", () => {
    expect(PATTERNS).toContain("loom-benchmark");
    expect(PATTERNS.toLowerCase()).toMatch(/collision|distinct/);
  });
});

describe("cross-file consistency — trigger is genuinely wired", () => {
  it("the orchestration.toml trigger appears in the pattern definition", () => {
    const trigger = tomlStr(benchmarkTable(TOML)!, "trigger")!;
    expect(PATTERNS).toContain(trigger);
  });
});

describe("agents/benchmark-agent.md — scorecard writer", () => {
  it("exists with a model: frontmatter", () => {
    expect(existsSync(resolve(ROOT, "agents/benchmark-agent.md"))).toBe(true);
    expect(AGENT).toMatch(/^---[\s\S]*?\nmodel:\s*opus\s*\n[\s\S]*?---/);
  });

  it("writes a typed BenchmarkScorecard with 0..10, sourceRefs, and N references", () => {
    expect(AGENT).toContain("BenchmarkScorecard");
    expect(AGENT).toContain("selfScore");
    expect(AGENT).toContain("refScore");
    expect(AGENT).toContain("sourceRefs");
    expect(AGENT).toMatch(/0\.\.10/);
  });

  it("runs PRE-roadmap on a bare idea (distinct from feature-coverage-agent)", () => {
    expect(AGENT.toLowerCase()).toMatch(/pre-roadmap|pre-plan|bare idea/);
    expect(AGENT).toContain("feature-coverage-agent");
  });

  it("references the scorecard schema and requires atomic writes", () => {
    expect(AGENT).toContain("protocols/benchmark-scorecard.schema.md");
    expect(AGENT.toLowerCase()).toContain("atomic");
  });
});

describe("name-collision avoidance — loom-benchmark perf skill untouched", () => {
  it("the perf skill still exists at its own path", () => {
    expect(existsSync(resolve(ROOT, "skills/loom-benchmark/SKILL.md"))).toBe(true);
  });

  it("the benchmark-agent explicitly disclaims the perf skill", () => {
    expect(AGENT).toContain("loom-benchmark");
    expect(AGENT.toLowerCase()).toMatch(/perf|not the/);
  });
});
