import { createRequire } from "module";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { escapeHtmlAttr } from "./content";
import {
  flattenTimelineQuizQuestions,
  renderLessonSegmentsHtml,
} from "./cards-slideshow-html";
import { lessonBodyToHtml } from "./lesson-html";
import { renderQuizConfigScript } from "./quiz-markup";
import type { LessonSegment } from "./types";

const require = createRequire(import.meta.url);
const scopackager = require("simple-scorm-packager") as (
  config: Record<string, unknown>,
  callback: (msg: string) => void
) => void;

const RUNTIME_FILENAME = "sco-runtime.js";

export type AssetFile = {
  /** Sanitized filename only (e.g. diagram.png) */
  filename: string;
  data: Buffer;
};

export type ExportCourseInput = {
  title: string;
  organization: string;
  body: string;
  /** When non-empty, replaces plain lesson body with segmented slideshow + quizzes. */
  segments: LessonSegment[] | null;
  masteryPercent: number;
  assets: AssetFile[];
};

function sanitizeFilenamePart(name: string): string {
  return name.replace(/[^\w\-]+/g, "_").slice(0, 80) || "course";
}

/** Prefer `public/` so serverless deploys (no `src/` on disk) still find the file. */
function resolveScoRuntimeSourcePath(): string {
  const publicPath = path.join(process.cwd(), "public", RUNTIME_FILENAME);
  if (existsSync(publicPath)) {
    return publicPath;
  }
  const srcFallback = path.join(
    process.cwd(),
    "src/lib/scorm",
    RUNTIME_FILENAME
  );
  if (existsSync(srcFallback)) {
    return srcFallback;
  }
  throw new Error(
    `Missing ${RUNTIME_FILENAME}: add public/${RUNTIME_FILENAME} (used in production) or keep src/lib/scorm/${RUNTIME_FILENAME} for local dev.`
  );
}

export async function buildScormZip(
  input: ExportCourseInput
): Promise<{ buffer: Buffer; filename: string }> {
  const title = input.title.trim().slice(0, 200) || "Untitled course";
  const organization = input.organization.trim().slice(0, 200) || "Author";

  const allowedNames = new Set(input.assets.map((a) => a.filename));
  const useSegments = input.segments != null && input.segments.length > 0;
  const flatQuiz = useSegments
    ? flattenTimelineQuizQuestions(input.segments!)
    : [];

  const bodyHtml = useSegments
    ? renderLessonSegmentsHtml(input.segments!, allowedNames, {
        wrapInQuizForm: flatQuiz.length > 0,
      }).html
    : lessonBodyToHtml(input.body, allowedNames);

  const masteryScore =
    flatQuiz.length > 0 ? input.masteryPercent : 80;

  const quizScript =
    flatQuiz.length > 0
      ? renderQuizConfigScript(input.masteryPercent, flatQuiz)
      : "";

  const completeFooter =
    flatQuiz.length > 0
      ? ""
      : `<footer class="sco-footer">
    <button type="button" id="sco-complete">Mark complete</button>
  </footer>`;

  const workDir = path.join(os.tmpdir(), `scorm-export-${randomUUID()}`);
  const sourceDir = path.join(workDir, "source");
  const outputFolder = path.join(workDir, "zip-out");
  const assetsDir = path.join(sourceDir, "assets");

  const runtimeSrc = resolveScoRuntimeSourcePath();
  const runtimeDest = path.join(sourceDir, RUNTIME_FILENAME);

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlAttr(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; padding: 1.25rem; color: #111; }
    main { max-width: 42rem; margin: 0 auto; }
    .sco-p { margin: 0 0 1rem; }
    .sco-footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e5e5; }
    #sco-complete { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; border-radius: 0.375rem; border: 1px solid #ccc; background: #fafafa; }
    #sco-complete:hover { background: #f0f0f0; }
    .sco-asset { margin: 1rem 0; }
    .sco-asset img, .sco-video { max-width: 100%; height: auto; display: block; }
    .sco-quiz { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e5e5; }
    .sco-quiz-title { font-size: 1.125rem; margin-bottom: 1rem; }
    .sco-q { margin: 0 0 1.25rem; padding: 0.75rem 1rem; border: 1px solid #e5e5e5; border-radius: 0.375rem; }
    .sco-q legend { font-weight: 600; padding: 0 0.25rem; }
    .sco-choice { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.35rem 0; cursor: pointer; }
    .sco-choice input { margin-top: 0.35rem; }
    .sco-quiz-submit { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; border-radius: 0.375rem; border: 1px solid #ccc; background: #fafafa; }
    .sco-quiz-submit:hover { background: #f0f0f0; }
    .sco-quiz-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .sco-quiz-feedback { margin-top: 1rem; font-weight: 500; }
    .sco-lesson { margin-top: 1rem; }
    .sco-slides-root { min-height: 12rem; }
    .sco-card { border: 1px solid #e5e5e5; border-radius: 0.75rem; overflow: hidden; background: #fafafa; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .sco-card-media { background: #f4f4f5; min-height: 200px; display: flex; align-items: center; justify-content: center; }
    .sco-card-media img { width: 100%; height: auto; max-height: min(70vh, 520px); object-fit: contain; display: block; }
    .sco-card-media--audio { min-height: auto; padding: 0.75rem 1rem; }
    .sco-audio { width: 100%; max-width: 28rem; }
    .sco-prose { font-size: 0.95rem; line-height: 1.55; color: inherit; }
    .sco-prose h2 { font-size: 1.125rem; margin: 0.75rem 0 0.35rem; font-weight: 600; }
    .sco-prose h3 { font-size: 1.02rem; margin: 0.65rem 0 0.3rem; font-weight: 600; }
    .sco-prose p { margin: 0 0 0.5rem; }
    .sco-prose ul, .sco-prose ol { margin: 0.35rem 0 0.5rem 1.25rem; padding: 0; }
    .sco-prose li { margin: 0.15rem 0; }
    .sco-prose blockquote { margin: 0.5rem 0; padding-left: 0.75rem; border-left: 3px solid #d4d4d8; color: #52525b; }
    .sco-prose pre { overflow-x: auto; margin: 0.5rem 0; padding: 0.5rem 0.75rem; background: #f4f4f5; border-radius: 0.375rem; font-size: 0.85rem; }
    .sco-prose code { font-size: 0.9em; background: #f4f4f5; padding: 0.1em 0.35em; border-radius: 0.25rem; }
    .sco-card-media--empty { color: #a1a1aa; }
    .sco-card-placeholder { font-size: 0.875rem; }
    .sco-card-body { padding: 1rem 1.25rem 1.25rem; }
    .sco-card-title { font-size: 1.25rem; margin: 0 0 0.5rem; }
    .sco-card-caption { font-size: 0.9rem; color: #52525b; margin: 0 0 0.75rem; }
    .sco-card-text .sco-p { margin: 0 0 0.5rem; }
    .sco-slide-nav { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.25rem; flex-wrap: wrap; }
    .sco-nav-btn { padding: 0.5rem 1rem; font-size: 0.95rem; cursor: pointer; border-radius: 0.375rem; border: 1px solid #ccc; background: #fff; }
    .sco-nav-btn:hover:not(:disabled) { background: #f4f4f5; }
    .sco-nav-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .sco-slide-counter { font-size: 0.9rem; color: #52525b; min-width: 5rem; text-align: center; }
    .sco-slide--quiz .sco-card-body { padding-top: 1rem; }
    .sco-quiz-segment-title { font-size: 1.125rem; margin: 0 0 0.75rem; }
    .sco-quiz-segment .sco-q:last-child { margin-bottom: 0; }
    .sco-quiz-footer { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e5e5e5; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtmlAttr(title)}</h1>
    ${bodyHtml}
  </main>
  ${completeFooter}
  ${quizScript}
  <script src="${RUNTIME_FILENAME}"></script>
</body>
</html>
`;

  await fs.mkdir(sourceDir, { recursive: true });
  if (input.assets.length > 0) {
    await fs.mkdir(assetsDir, { recursive: true });
    for (const a of input.assets) {
      await fs.writeFile(path.join(assetsDir, a.filename), a.data);
    }
  }
  await fs.copyFile(runtimeSrc, runtimeDest);
  await fs.writeFile(path.join(sourceDir, "index.html"), indexHtml, "utf8");

  const PACK_MS = 120_000;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("SCORM packaging timed out"));
    }, PACK_MS);
    try {
      scopackager(
        {
          version: "1.2",
          organization,
          title,
          language: "en-US",
          identifier: null,
          masteryScore,
          startingPage: "index.html",
          source: sourceDir,
          package: {
            zip: true,
            appendTimeToOutput: true,
            outputFolder,
            name: title,
            version: "1.0.0",
            author: organization,
            description: "Generated by Scormify",
            keywords: ["scorm", "1.2"],
            typicalDuration: "PT0H10M0S",
            rights: `© ${new Date().getFullYear()} ${organization}.`,
          },
        },
        (msg: string) => {
          if (msg === "Done") {
            clearTimeout(timer);
            resolve();
          }
        }
      );
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });

  const zips = (await fs.readdir(outputFolder)).filter((f) =>
    f.toLowerCase().endsWith(".zip")
  );
  if (zips.length === 0) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw new Error("SCORM packager did not produce a zip file");
  }

  const zipPath = path.join(outputFolder, zips[zips.length - 1]);
  const buffer = await fs.readFile(zipPath);

  await fs.rm(workDir, { recursive: true, force: true });

  const filename = `${sanitizeFilenamePart(title)}_scorm12.zip`;

  return { buffer, filename };
}
