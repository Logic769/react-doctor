import { describe, expect, it } from "vite-plus/test";
import { GENERATED_SOURCE_CONTEXT_PATTERN } from "../src/plugin/constants/security-scan.js";

describe("GENERATED_SOURCE_CONTEXT_PATTERN", () => {
  it("matches .next build output paths", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test(".next/static/chunks/bundle.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("app/.next/static/chunks/app.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test(".next/server/app.js")).toBe(true);
  });

  it("matches .open-next build output paths", () => {
    expect(
      GENERATED_SOURCE_CONTEXT_PATTERN.test(".open-next/assets/_next/static/chunks/bundle.js"),
    ).toBe(true);
    expect(
      GENERATED_SOURCE_CONTEXT_PATTERN.test(".open-next/server-functions/default/handler.mjs"),
    ).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("app/.open-next/assets/chunks/app.js")).toBe(true);
  });

  it("matches .yarn build cache paths", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test(".yarn/cache/package.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("monorepo/.yarn/releases/yarn.js")).toBe(true);
  });

  it("matches common build output directories", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("dist/bundle.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("build/static/app.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("out/production/main.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("coverage/lcov-report/index.html")).toBe(true);
  });

  it("matches vendored and generated directories", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("vendor/library/index.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("vendors/third-party/module.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("generated/api/client.ts")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("__generated__/graphql.ts")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("third-party/lib/index.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("third_party/protobuf/message.js")).toBe(true);
  });

  it("matches version-pinned filenames", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("jsonwebtoken@8.5.1.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("lodash@4.17.21.min.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("react-17.0.2/index.js")).toBe(true);
  });

  it("matches generated file suffixes", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("api.generated.ts")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("schema.gen.tsx")).toBe(true);
  });

  it("matches minified and asm.js files", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("vendor.min.js")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("app-bundle.min.cjs")).toBe(true);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("crypto.asm.js")).toBe(true);
  });

  it("does not match application source paths", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("src/app/page.tsx")).toBe(false);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("app/routes/index.tsx")).toBe(false);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("components/Button.tsx")).toBe(false);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("lib/utils.ts")).toBe(false);
  });

  it("does not match source files that contain 'next' but are not in .next/", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("src/next-steps.tsx")).toBe(false);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("app/nextjs-example.ts")).toBe(false);
  });

  it("does not match source files with 'open' in their names", () => {
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("src/open-dialog.tsx")).toBe(false);
    expect(GENERATED_SOURCE_CONTEXT_PATTERN.test("app/open-next-handler.ts")).toBe(false);
  });
});
