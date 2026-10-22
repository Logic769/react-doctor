import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { computeSourceProjectFingerprint } from "./compute-source-project-fingerprint.js";
import {
  captureCrossFileProbes,
  recordContentProbe,
  replayCrossFileProbes,
} from "./cross-file-probe-recorder.js";
import { SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES } from "./constants.js";

let temporaryDirectory: string;
let projectDirectory: string;

const writeProjectFile = (relativePath: string, contents: string): string => {
  const filePath = path.join(projectDirectory, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
};

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "source-fingerprint-"));
  projectDirectory = path.join(temporaryDirectory, "project");
  fs.mkdirSync(projectDirectory);
  writeProjectFile("entry.js", "export const source = 1;");
});

afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("source project fingerprint", () => {
  it("freshly hashes ignored appearance, same-size restored-mtime edits, and deletion", () => {
    writeProjectFile(".gitignore", "private/\n");
    const initial = computeSourceProjectFingerprint(projectDirectory);
    expect(initial).not.toBeNull();
    expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
    const caller = writeProjectFile("private/caller.js", "export const value = 1;");
    const present = computeSourceProjectFingerprint(projectDirectory);
    expect(present).not.toBeNull();
    expect(present).not.toBe(initial);
    const previousStat = fs.statSync(caller);
    fs.writeFileSync(caller, "export const value = 2;");
    fs.utimesSync(caller, previousStat.atime, previousStat.mtime);
    const changed = computeSourceProjectFingerprint(projectDirectory);
    expect(changed).not.toBeNull();
    expect(changed).not.toBe(present);
    fs.unlinkSync(caller);
    expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
  });

  it("captures nested ignored config and external extends content without mtime trust", () => {
    writeProjectFile("source/entry.js", "import { value } from '@local/value'; export { value };");
    writeProjectFile(".gitignore", "source/tsconfig.json\n");
    writeProjectFile("source/tsconfig.json", JSON.stringify({ extends: "../../shared.json" }));
    writeProjectFile("left/value.js", "export const value = 1;");
    writeProjectFile("rght/value.js", "export const value = 2;");
    const shared = path.join(temporaryDirectory, "shared.json");
    const config = (target: string): string =>
      JSON.stringify({
        compilerOptions: { baseUrl: "./project", paths: { "@local/*": [`${target}/*`] } },
      });
    fs.writeFileSync(shared, config("left"));
    const first = computeSourceProjectFingerprint(projectDirectory);
    expect(first).not.toBeNull();
    const previousStat = fs.statSync(shared);
    fs.writeFileSync(shared, config("rght"));
    fs.utimesSync(shared, previousStat.atime, previousStat.mtime);
    const second = computeSourceProjectFingerprint(projectDirectory);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("captures negative external extends and module candidate appearance", () => {
    writeProjectFile("entry.js", "import { value } from '@local/value'; export { value };");
    writeProjectFile("tsconfig.json", JSON.stringify({ extends: "../shared.json" }));
    const absent = computeSourceProjectFingerprint(projectDirectory);
    expect(absent).not.toBeNull();
    fs.writeFileSync(
      path.join(temporaryDirectory, "shared.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "./external", paths: { "@local/*": ["*"] } },
      }),
    );
    const configured = computeSourceProjectFingerprint(projectDirectory);
    expect(configured).not.toBeNull();
    expect(configured).not.toBe(absent);
    fs.mkdirSync(path.join(temporaryDirectory, "external"));
    fs.writeFileSync(path.join(temporaryDirectory, "external/value.js"), "export const value = 1;");
    const resolved = computeSourceProjectFingerprint(projectDirectory);
    expect(resolved).not.toBeNull();
    expect(resolved).not.toBe(configured);
  });

  it("captures JSX-only external extends despite explicit local paths for every source", () => {
    writeProjectFile("nested/panel.tsx", "export const Panel = () => <span />;");
    writeProjectFile(
      "nested/tsconfig.json",
      JSON.stringify({
        extends: "../../shared.json",
        compilerOptions: { paths: {}, jsx: "react-jsx" },
      }),
    );
    const shared = path.join(temporaryDirectory, "shared.json");
    const initialConfig = JSON.stringify({ compilerOptions: { jsxImportSource: "react" } });
    const changedConfig = JSON.stringify({ compilerOptions: { jsxImportSource: "other" } });
    expect(Buffer.byteLength(changedConfig)).toBe(Buffer.byteLength(initialConfig));
    fs.writeFileSync(shared, initialConfig);
    const initial = computeSourceProjectFingerprint(projectDirectory);
    expect(initial).not.toBeNull();
    expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
    const previousStat = fs.statSync(shared);
    fs.writeFileSync(shared, changedConfig);
    fs.utimesSync(shared, previousStat.atime, previousStat.mtime);
    expect(fs.statSync(shared).mtime.getTime()).toBe(previousStat.mtime.getTime());
    const changed = computeSourceProjectFingerprint(projectDirectory);
    expect(changed).not.toBeNull();
    expect(changed).not.toBe(initial);
    fs.writeFileSync(shared, initialConfig);
    fs.utimesSync(shared, previousStat.atime, previousStat.mtime);
    expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
  });

  it.each(["react/jsx-runtime", "react/jsx-dev-runtime"])(
    "captures configured implicit %s target appearance and deletion outside the source census",
    (runtimeSource) => {
      writeProjectFile("entry.js", "export const source = 1;");
      writeProjectFile(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            jsx: "react-jsx",
            paths: { [runtimeSource]: ["../external/runtime"] },
          },
        }),
      );
      const externalDirectory = path.join(temporaryDirectory, "external");
      fs.mkdirSync(externalDirectory);
      const runtimePath = path.join(externalDirectory, "runtime.ts");
      const initial = computeSourceProjectFingerprint(projectDirectory);
      expect(initial).not.toBeNull();
      expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
      fs.writeFileSync(runtimePath, "export const jsx = () => null;");
      const appeared = computeSourceProjectFingerprint(projectDirectory);
      expect(appeared).not.toBeNull();
      expect(appeared).not.toBe(initial);
      expect(computeSourceProjectFingerprint(projectDirectory)).toBe(appeared);
      fs.unlinkSync(runtimePath);
      expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
    },
  );

  it.skipIf(process.platform === "win32")("declines source links", () => {
    fs.symlinkSync(
      path.join(projectDirectory, "entry.js"),
      path.join(projectDirectory, "linked.js"),
    );
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
  });

  it("declines unparseable modules and over-budget source content", () => {
    writeProjectFile("broken.js", "export const = ;");
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
    fs.unlinkSync(path.join(projectDirectory, "broken.js"));
    writeProjectFile("huge.js", " ".repeat(SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES + 1));
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
  });

  it("remembers a config budget refusal even when the existing resolver catches it", () => {
    writeProjectFile("entry.js", "import { value } from '@local/value'; export { value };");
    writeProjectFile(
      "tsconfig.json",
      " ".repeat(SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES + 1),
    );
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
  });

  it("preserves nested probe capture and restores the default observer after refusal", () => {
    const observed: string[] = [];
    const captured = captureCrossFileProbes(
      () => {
        recordContentProbe("outer");
        return captureCrossFileProbes(() => recordContentProbe("inner"));
      },
      {
        beforeProbe: (filePath) => {
          observed.push(filePath);
        },
      },
    );
    expect(observed).toEqual(["outer", "inner"]);
    expect([...captured.trace.contentPaths]).toEqual(["outer", "inner"]);
    expect([...captured.value.trace.contentPaths]).toEqual(["inner"]);
    const replayed: string[] = [];
    const replay = captureCrossFileProbes(() => replayCrossFileProbes(captured.trace), {
      beforeProbe: (filePath) => {
        replayed.push(filePath);
      },
    });
    expect(replayed).toEqual(["outer", "inner"]);
    expect([...replay.trace.contentPaths]).toEqual(["outer", "inner"]);
    expect(() =>
      captureCrossFileProbes(() => replayCrossFileProbes(captured.trace), {
        beforeProbe: () => {
          throw new Error("replay budget");
        },
      }),
    ).toThrow("replay budget");
    expect(() =>
      captureCrossFileProbes(() => recordContentProbe("rejected"), {
        beforeProbe: () => {
          throw new Error("budget");
        },
      }),
    ).toThrow("budget");
    expect(() => recordContentProbe("default")).not.toThrow();
    expect(observed).toEqual(["outer", "inner"]);
  });
});
