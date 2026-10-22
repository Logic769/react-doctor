import * as crypto from "node:crypto";
import * as fs from "node:fs";
import {
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_PROBE_COUNT,
} from "./constants.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import { captureCrossFileProbes } from "./cross-file-probe-recorder.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { ProductionSourceFiles } from "./list-production-source-files.js";
import { listProductionSourceFiles } from "./list-production-source-files.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resetFilesystemCaches } from "./reset-filesystem-caches.js";

interface SourceProjectProbeSnapshot {
  readonly absolutePath: string;
  readonly kind: "content" | "existence";
  readonly signature: string;
}

const serializeProductionMembership = (files: ProductionSourceFiles): string =>
  JSON.stringify({
    sourceFilePaths: [...files.sourceFilePaths].sort(),
    htmlFilePaths: [...files.htmlFilePaths].sort(),
    hasOpaqueMdxConsumerSurface: files.hasOpaqueMdxConsumerSurface,
  });

export const computeSourceProjectFingerprint = (rootDirectory: string): string | null => {
  const snapshots = new Map<string, SourceProjectProbeSnapshot>();
  let isComplete = true;
  let totalBytes = 0;
  const limits = {
    maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
    maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
    maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
    maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
  };
  const readSignature = (absolutePath: string, kind: "content" | "existence"): string => {
    const fileStat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
    if (!fileStat) return "absent";
    if (fileStat.isSymbolicLink()) throw new Error("Unsupported source dependency link");
    if (kind === "existence") {
      if (fileStat.isFile()) return "file";
      if (fileStat.isDirectory()) return "directory";
      throw new Error("Unsupported source dependency entry");
    }
    if (!fileStat.isFile() || fileStat.size > SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES) {
      throw new Error("Unsupported source dependency content");
    }
    const content = fs.readFileSync(absolutePath);
    if (content.byteLength !== fileStat.size) throw new Error("Source dependency changed");
    return crypto.createHash("sha256").update(content).digest("hex");
  };
  const beforeProbe = (absolutePath: string, kind: "content" | "existence"): void => {
    if (!isComplete) throw new Error("Incomplete source dependency snapshot");
    const key = JSON.stringify([kind, absolutePath]);
    if (snapshots.has(key)) return;
    try {
      if (snapshots.size >= SOURCE_PROJECT_FINGERPRINT_MAX_PROBE_COUNT) {
        throw new Error("Source dependency count exceeded");
      }
      if (kind === "content") {
        const fileStat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
        totalBytes += fileStat?.size ?? 0;
        if (totalBytes > SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES) {
          throw new Error("Source dependency bytes exceeded");
        }
      }
      const signature = readSignature(absolutePath, kind);
      snapshots.set(key, { absolutePath, kind, signature });
    } catch (error) {
      isComplete = false;
      throw error;
    }
  };
  try {
    const absoluteRoot = fs.realpathSync(rootDirectory);
    const productionFiles = listProductionSourceFiles(absoluteRoot, limits);
    if (!productionFiles) return null;
    const membership = serializeProductionMembership(productionFiles);
    for (const filePath of [...productionFiles.sourceFilePaths, ...productionFiles.htmlFilePaths]) {
      beforeProbe(filePath, "content");
    }
    resetFilesystemCaches();
    const capture = captureCrossFileProbes(
      () => {
        const firstFilePath = productionFiles.sourceFilePaths[0];
        if (!firstFilePath) return true;
        const programNode = parseSourceFile(firstFilePath);
        if (!isNodeOfType(programNode, "Program")) return false;
        return (
          buildSourceProjectIndex({
            rootDirectory: absoluteRoot,
            currentFilePath: firstFilePath,
            currentProgramNode: programNode,
          }) !== null
        );
      },
      { beforeProbe },
    );
    if (!capture.value || !isComplete) return null;
    const finalProductionFiles = listProductionSourceFiles(absoluteRoot, limits);
    if (!finalProductionFiles || serializeProductionMembership(finalProductionFiles) !== membership)
      return null;
    for (const snapshot of snapshots.values()) {
      if (readSignature(snapshot.absolutePath, snapshot.kind) !== snapshot.signature) return null;
    }
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          membership,
          [...snapshots.entries()].sort(([left], [right]) => {
            if (left < right) return -1;
            if (left > right) return 1;
            return 0;
          }),
        ]),
      )
      .digest("hex");
  } catch {
    return null;
  }
};
