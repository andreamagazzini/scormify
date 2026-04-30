import path from "path";

/** Reasonable limits for serverless hosts (tune for your deployment). */
export const MAX_ASSETS_COUNT = 40;
export const MAX_SINGLE_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_ASSET_BYTES = 48 * 1024 * 1024;

export function sanitizeAssetFilename(original: string): string | null {
  const base = path.basename(original);
  if (!base || base.length > 120) {
    return null;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) {
    return null;
  }
  return base;
}
