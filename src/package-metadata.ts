import { readFileSync } from "node:fs";

export type PackageMetadata = Readonly<{
  name: string;
  version: string;
}>;

export function parsePackageMetadata(value: unknown): PackageMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error("Package metadata must declare a name and version.");
  }
  const { name, version } = value as Readonly<{ name?: unknown; version?: unknown }>;
  if (typeof name !== "string" || name.trim() === "" || typeof version !== "string") {
    throw new Error("Package metadata must declare a name and version.");
  }
  const normalizedVersion = version.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalizedVersion)) {
    throw new Error("Package metadata version must be a release version.");
  }
  return Object.freeze({ name: name.trim(), version: normalizedVersion });
}

function loadPackageMetadata(): PackageMetadata {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  let raw: string;
  try {
    raw = readFileSync(packageJsonUrl, "utf8");
  } catch {
    throw new Error("Package metadata is unavailable: package.json cannot be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Package metadata is unavailable: package.json is not valid JSON.");
  }
  return parsePackageMetadata(parsed);
}

export const PACKAGE_METADATA: PackageMetadata = loadPackageMetadata();
