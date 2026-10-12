import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DiffInfo } from "@react-doctor/core";
import { finalizeScope, resolveScope, warnDeprecatedDiff } from "../src/cli/utils/resolve-scope.js";
import { prompts } from "../src/cli/utils/prompts.js";

vi.mock("../src/cli/utils/prompts.js", () => ({
  prompts: vi.fn(),
}));

interface ConsoleWarnHandle {
  capturedMessages: string[];
  restore: () => void;
}

const captureConsoleWarn = (): ConsoleWarnHandle => {
  const capturedMessages: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    capturedMessages.push(args.map(String).join(" "));
  });
  return { capturedMessages, restore: () => spy.mockRestore() };
};

const buildDiffInfo = (overrides: Partial<DiffInfo> = {}): DiffInfo => ({
  currentBranch: "feature",
  baseBranch: "main",
  changedFiles: ["src/App.tsx"],
  ...overrides,
});

describe("resolveScope", () => {
  let consoleHandle: ConsoleWarnHandle;
  beforeEach(() => {
    consoleHandle = captureConsoleWarn();
  });
  afterEach(() => {
    consoleHandle.restore();
    vi.clearAllMocks();
  });

  it("accepts contextual scope from flags and config", () => {
    expect(resolveScope({ scope: "contextual" }, null).scope).toBe("contextual");
    expect(resolveScope({}, { scope: "contextual" }).scope).toBe("contextual");
  });

  it("reads an explicit --scope value", () => {
    expect(resolveScope({ scope: "lines" }, null)).toEqual({
      scope: "lines",
      base: undefined,
      usedDeprecatedDiff: false,
    });
  });

  it("lets --scope win over config.scope (flags beat config)", () => {
    expect(resolveScope({ scope: "full" }, { scope: "changed" }).scope).toBe("full");
  });

  it("falls back to config.scope when no flag is set", () => {
    expect(resolveScope({}, { scope: "files" }).scope).toBe("files");
  });

  it("coerces the deprecated --diff <base> alias to changed + base", () => {
    expect(resolveScope({ diff: "origin/main" }, null)).toEqual({
      scope: "changed",
      base: "origin/main",
      usedDeprecatedDiff: true,
    });
  });

  it("coerces --diff false to full and --diff true to changed", () => {
    expect(resolveScope({ diff: false }, null).scope).toBe("full");
    expect(resolveScope({ diff: true }, null).scope).toBe("changed");
  });

  it("lets the deprecated flag --diff win over config.scope (flags beat config)", () => {
    expect(resolveScope({ diff: "main" }, { scope: "files" }).scope).toBe("changed");
  });

  it("threads --base through and lets it win over a --diff base", () => {
    expect(resolveScope({ diff: "main", base: "dev" }, null).base).toBe("dev");
  });

  it("returns scope undefined when nothing is configured", () => {
    expect(resolveScope({}, null).scope).toBeUndefined();
  });

  it("warns and ignores an invalid --scope value", () => {
    expect(resolveScope({ scope: "bogus" }, null).scope).toBeUndefined();
    expect(consoleHandle.capturedMessages.join("\n")).toMatch(/Invalid --scope/);
  });
});

describe("warnDeprecatedDiff", () => {
  let consoleHandle: ConsoleWarnHandle;
  beforeEach(() => {
    consoleHandle = captureConsoleWarn();
  });
  afterEach(() => {
    consoleHandle.restore();
    vi.clearAllMocks();
  });

  it("does not warn when neither --diff nor config.diff is set", () => {
    warnDeprecatedDiff({}, null);
    expect(consoleHandle.capturedMessages).toHaveLength(0);
  });

  it("points --diff false at --scope full (not changed)", () => {
    warnDeprecatedDiff({ diff: false }, null);
    const message = consoleHandle.capturedMessages.join("\n");
    expect(message).toMatch(/--scope full/);
    expect(message).not.toMatch(/--scope changed/);
  });

  it("points --diff <base> at --scope changed with a --base hint", () => {
    warnDeprecatedDiff({ diff: "main" }, null);
    const message = consoleHandle.capturedMessages.join("\n");
    expect(message).toMatch(/--scope changed/);
    expect(message).toMatch(/--base/);
  });

  it("warns about the config option with the resolved scope", () => {
    warnDeprecatedDiff({}, { diff: false });
    expect(consoleHandle.capturedMessages.join("\n")).toMatch(/scope: "full"/);
  });
});

describe("finalizeScope", () => {
  let consoleHandle: ConsoleWarnHandle;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleHandle = captureConsoleWarn();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(prompts).mockResolvedValue({ scanScope: "full" });
  });

  afterEach(() => {
    consoleHandle.restore();
    consoleLogSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("keeps an explicit non-full scope when a diff resolved", async () => {
    const scope = await finalizeScope({
      requested: { scope: "lines", base: undefined, usedDeprecatedDiff: false },
      diffInfo: buildDiffInfo(),
      skipPrompts: true,
      isQuiet: false,
    });
    expect(scope).toBe("lines");
  });

  it("falls back to full and warns (base-aware) when a non-full scope can't diff", async () => {
    const scope = await finalizeScope({
      requested: { scope: "changed", base: "origin/master", usedDeprecatedDiff: false },
      diffInfo: null,
      skipPrompts: true,
      isQuiet: false,
    });
    expect(scope).toBe("full");
    expect(consoleHandle.capturedMessages.join("\n")).toMatch(/origin\/master/);
  });

  it("stays silent in quiet mode when a non-full scope can't diff", async () => {
    const scope = await finalizeScope({
      requested: { scope: "changed", base: undefined, usedDeprecatedDiff: false },
      diffInfo: null,
      skipPrompts: true,
      isQuiet: true,
    });
    expect(scope).toBe("full");
    expect(consoleHandle.capturedMessages).toHaveLength(0);
  });

  it("prompts full vs changed when no scope was requested on a branch", async () => {
    vi.mocked(prompts).mockResolvedValue({ scanScope: "changed" });
    const scope = await finalizeScope({
      requested: { scope: undefined, base: undefined, usedDeprecatedDiff: false },
      diffInfo: buildDiffInfo({ changedFiles: ["src/App.tsx", "src/hooks.ts"] }),
      skipPrompts: false,
      isQuiet: false,
    });
    expect(scope).toBe("changed");
    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({ name: "scanScope", message: "Choose what to scan" }),
    );
  });

  it("does not prompt when prompts are skipped", async () => {
    const scope = await finalizeScope({
      requested: { scope: undefined, base: undefined, usedDeprecatedDiff: false },
      diffInfo: buildDiffInfo(),
      skipPrompts: true,
      isQuiet: false,
    });
    expect(scope).toBe("full");
    expect(prompts).not.toHaveBeenCalled();
  });
});
