import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { REACT_DOCTOR_RULES } from "oxlint-plugin-react-doctor/core";
import { buildTestProject } from "../regressions/_helpers.js";
import { BASIC_REACT_DIRECTORY } from "./_helpers.js";

describe("runOxlint", () => {
  describe("customRulesOnly mode", () => {
    const buildCustomOnlyOptions = () => ({
      rootDirectory: BASIC_REACT_DIRECTORY,
      project: buildTestProject({
        rootDirectory: BASIC_REACT_DIRECTORY,
        tanstackQueryVersion: "^5.66.0",
        mobxVersion: null,
        styledComponentsVersion: null,
      }),
      customRulesOnly: true,
    });

    it("excludes ported rules by default when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(buildCustomOnlyOptions());

      const portedRuleDiagnostics = customOnlyDiagnostics.filter((diagnostic) =>
        REACT_DOCTOR_RULES.some(
          (entry) =>
            entry.originallyExternal && entry.key === `${diagnostic.plugin}/${diagnostic.rule}`,
        ),
      );
      expect(portedRuleDiagnostics).toHaveLength(0);
    });

    it.each(["react-doctor/alt-text", "jsx-a11y/alt-text"])(
      "reports an explicitly enabled ported rule through %s",
      async (ruleKey) => {
        const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "custom-rules-only-"));
        try {
          fs.writeFileSync(
            path.join(rootDirectory, "app.tsx"),
            'export const App = () => <><img src="photo.png" /><input autoFocus /></>;',
          );
          const diagnostics = await runOxlint({
            rootDirectory,
            project: buildTestProject({ rootDirectory, hasReactCompiler: true }),
            customRulesOnly: true,
            userConfig: { rules: { [ruleKey]: "error" } },
          });

          expect(diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                plugin: "react-doctor",
                rule: "alt-text",
                severity: "error",
              }),
            ]),
          );
          expect(diagnostics.some((diagnostic) => diagnostic.rule === "no-autofocus")).toBe(false);
          expect(diagnostics.some((diagnostic) => diagnostic.plugin === "react-hooks-js")).toBe(
            false,
          );
        } finally {
          fs.rmSync(rootDirectory, { recursive: true, force: true });
        }
      },
    );

    it("still includes react-doctor/* rules when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(buildCustomOnlyOptions());

      const reactDoctorDiagnostics = customOnlyDiagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor",
      );
      expect(reactDoctorDiagnostics.length).toBeGreaterThan(0);
    });
  });
});
