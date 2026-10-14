import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { collectSecurityScanFiles } from "../src/checks/security-scan/collect-security-scan-files.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-security-scan-files-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("collectSecurityScanFiles", () => {
  it("does not walk excluded descendant projects", () => {
    const excludedDirectory = path.join(temporaryRoot, "packages", "web");
    fs.mkdirSync(excludedDirectory, { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, ".env"), "ROOT_SECRET=value\n");
    fs.writeFileSync(path.join(excludedDirectory, ".env"), "CHILD_SECRET=value\n");

    const relativePaths = [
      ...collectSecurityScanFiles(temporaryRoot, new Set([excludedDirectory])),
    ].flatMap((file) => (file === null ? [] : [file.relativePath]));

    expect(relativePaths).toContain(".env");
    expect(relativePaths).not.toContain("packages/web/.env");
  });

  it("skips .open-next build output directory during walk", () => {
    const projectRoot = path.join(temporaryRoot, "opennext-project");
    const openNextDir = path.join(projectRoot, ".open-next");
    const sourceDir = path.join(projectRoot, "src");

    fs.mkdirSync(path.join(openNextDir, "assets", "_next", "static", "chunks"), { recursive: true });
    fs.mkdirSync(path.join(openNextDir, "server-functions", "default"), { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });

    fs.writeFileSync(path.join(projectRoot, ".env"), "ROOT_SECRET=value\n");
    fs.writeFileSync(path.join(openNextDir, "assets", "_next", "static", "chunks", "bundle.js"), "crypto\n");
    fs.writeFileSync(path.join(openNextDir, "server-functions", "default", "handler.mjs"), "crypto\n");
    fs.writeFileSync(path.join(sourceDir, "App.tsx"), "export const App = () => null;\n");

    const files = [...collectSecurityScanFiles(projectRoot, new Set())];
    const relativePaths = files
      .filter((file): file is Exclude<typeof file, null> => file !== null)
      .map((file) => file.relativePath);

    expect(relativePaths).toContain(".env");
    expect(relativePaths).toContain("src/App.tsx");
    expect(relativePaths.some((p) => p.includes(".open-next"))).toBe(false);
  });

  it("skips other build output directories like .vercel during walk", () => {
    const projectRoot = path.join(temporaryRoot, "multi-build-project");
    fs.mkdirSync(path.join(projectRoot, ".vercel", "output"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });

    fs.writeFileSync(path.join(projectRoot, ".vercel", "output", "bundle.js"), "crypto\n");
    fs.writeFileSync(path.join(projectRoot, "src", "App.tsx"), "export const App = () => null;\n");

    const files = [...collectSecurityScanFiles(projectRoot, new Set())];
    const relativePaths = files
      .filter((file): file is Exclude<typeof file, null> => file !== null)
      .map((file) => file.relativePath);

    expect(relativePaths).toContain("src/App.tsx");
    expect(relativePaths.some((p) => p.includes(".vercel"))).toBe(false);
  });
});
