import { NextResponse } from "next/server";
import { buildScormZip } from "@/lib/scorm/build-package";
import type { AssetFile } from "@/lib/scorm/build-package";
import {
  MAX_ASSETS_COUNT,
  MAX_SINGLE_ASSET_BYTES,
  MAX_TOTAL_ASSET_BYTES,
  sanitizeAssetFilename,
} from "@/lib/scorm/assets";
import {
  assertTimelineAssetsExist,
  parseExportMetadataJson,
  parseExportMetadataObject,
} from "@/lib/scorm/validate-payload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ct = request.headers.get("content-type") || "";

  try {
    if (ct.includes("multipart/form-data")) {
      const form = await request.formData();
      const metadataRaw = form.get("metadata");
      if (typeof metadataRaw !== "string") {
        return NextResponse.json(
          { error: "Missing metadata field (JSON string)" },
          { status: 400 }
        );
      }

      const parsed = parseExportMetadataJson(metadataRaw);

      const assetMap = new Map<string, Buffer>();
      let totalBytes = 0;

      for (const [, value] of form.entries()) {
        if (!(value instanceof File) || value.size === 0) {
          continue;
        }
        const safe = sanitizeAssetFilename(value.name);
        if (!safe) {
          return NextResponse.json(
            {
              error:
                "Invalid asset filename (use letters, numbers, . _ - only): " +
                value.name,
            },
            { status: 400 }
          );
        }
        if (value.size > MAX_SINGLE_ASSET_BYTES) {
          return NextResponse.json(
            {
              error: `File too large: ${safe} (max ${Math.round(MAX_SINGLE_ASSET_BYTES / 1024 / 1024)} MB)`,
            },
            { status: 400 }
          );
        }
        const buf = Buffer.from(await value.arrayBuffer());
        totalBytes += buf.length;
        if (totalBytes > MAX_TOTAL_ASSET_BYTES) {
          return NextResponse.json(
            { error: "Total upload size exceeds limit" },
            { status: 400 }
          );
        }
        assetMap.set(safe, buf);
      }

      if (assetMap.size > MAX_ASSETS_COUNT) {
        return NextResponse.json(
          { error: `At most ${MAX_ASSETS_COUNT} files per package` },
          { status: 400 }
        );
      }

      const assets: AssetFile[] = [...assetMap.entries()].map(
        ([filename, data]) => ({ filename, data })
      );

      assertTimelineAssetsExist(
        parsed.segments,
        new Set(assets.map((a) => a.filename))
      );

      const { buffer, filename } = await buildScormZip({
        title: parsed.title,
        organization: parsed.organization,
        body: parsed.body,
        segments: parsed.segments,
        masteryPercent: parsed.masteryPercent,
        assets,
      });

      return zipResponse(buffer, filename);
    }

    if (ct.includes("application/json")) {
      const json: unknown = await request.json();
      const parsed = parseExportMetadataObject(json);

      const { buffer, filename } = await buildScormZip({
        title: parsed.title,
        organization: parsed.organization,
        body: parsed.body,
        segments: parsed.segments,
        masteryPercent: parsed.masteryPercent,
        assets: [],
      });

      return zipResponse(buffer, filename);
    }

    return NextResponse.json(
      { error: "Use multipart/form-data or application/json" },
      { status: 415 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    if (
      message.includes("Invalid") ||
      message.includes("required") ||
      message.includes("exceeds") ||
      message.includes("must be") ||
      message.includes("At most") ||
      message.includes("Choice") ||
      message.includes("Body") ||
      message.includes("card") ||
      message.includes("Card") ||
      message.includes("Missing") ||
      message.includes("image") ||
      message.includes("lesson text") ||
      message.includes("segment")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json(
      { error: "Failed to build SCORM package" },
      { status: 500 }
    );
  }
}

function zipResponse(buffer: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
}
