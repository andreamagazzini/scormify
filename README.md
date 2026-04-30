# Scormify

A small [Next.js](https://nextjs.org) app (**scormify**) that turns **image cards** (with optional text) and a **multiple-choice quiz** into a **SCORM 1.2** zip. The editor is **card-based** with [dnd-kit](https://github.com/clauderic/dnd-kit) (drag to reorder, image upload with inline preview) and a **live slideshow preview** that matches the published SCO.

The SCO is static HTML + `sco-runtime.js` (source of truth: `public/sco-runtime.js`, copied into each zip) that uses **parent-frame API discovery** (the same idea as [pipwerks](https://github.com/pipwerks/scorm-api-wrapper)) and talks to the LMS with `LMSSetValue` / `LMSCommit` / `LMSFinish`. **Next / Previous** between cards is done in the SCO with JavaScript (one `index.html`, no SCORM 2004 sequencing required); arrow keys are also supported in the player.

Packaging uses [`simple-scorm-packager`](https://github.com/lmihaidaniel/simple-scorm-packager) (`imsmanifest.xml`, XSDs, zip)—similar to [`vite-plugin-scorm`](https://www.npmjs.com/package/vite-plugin-scorm) post-build zips.

## Run locally

Uses [pnpm](https://pnpm.io). This repo pins `pnpm@9.15.9` via `packageManager` in `package.json` (Corepack). If your Corepack install fails to verify signatures, use standalone pnpm (e.g. `npm i -g pnpm`) or run commands via `npx pnpm@9.15.9`.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), fill in the form, and download the zip.

## Card lessons (default UI)

- Add **cards**; each card can have an **image** (upload in the browser), **title**, **caption**, and **body text** (all optional, but the lesson must have at least one non-empty field or an image somewhere).
- **Create cards from images** (next to *Add card*) runs a multi-file picker and creates **one card per image** (title prefilled from the filename). If the lesson still has only the initial empty card, that card is **replaced** by the new image cards.
- Reorder with the **drag handle** (dnd-kit).
- **Live preview** on the right shows the same **Previous / Next** flow as the SCORM package.
- Export uploads images as `assets/c{N}-{filename}` and generates the slideshow markup automatically.

## Legacy lesson text (API only)

`POST /api/export` with JSON can still send **`body`** plus optional `{{img:…}}` / `{{video:…}}` placeholders if you build metadata yourself—see earlier commits or use **`cards`** in metadata for the structured format.

## Quiz

- Add questions in the UI: prompt, 2–8 choices, mark the correct answer.
- If there is at least one question, the export includes a quiz form. Submitting scores **`cmi.core.score.raw`** (0–100), **`cmi.core.lesson_status`** (`passed` / `failed`) vs your **mastery %**, then commits and finishes. The **Mark complete** button is omitted when a quiz is present.
- Correct answers are embedded in the HTML for browser scoring (same as any client-side quiz—inspectable).

## API

- **`POST /api/export`** as **`multipart/form-data`**:

  - Field **`metadata`**: JSON string `{ title, organization, body, quiz | null }`
  - Field **`assets`**: repeated file parts (any field name `assets`).

- **`POST /api/export`** with **`application/json`**: same object without files (no media).

## Deploy (e.g. Vercel)

- Build: `pnpm build`
- Start: `pnpm start`
- Use the **Node.js** runtime (filesystem + `simple-scorm-packager`).

`next.config.ts` lists `simple-scorm-packager` in `serverExternalPackages` so the packager resolves its XSD paths under `node_modules`.

## Ideas for extensions

- **`cmi.interactions.*`** for per-question reporting (many LMSs accept score-only first).
- **SCORM 2004** manifest + `API_1484_11` in the runtime.
- **Local LMS mock** using [`scorm-again`](https://github.com/jcputney/scorm-again) for preview only.

## License

Private / your choice — dependencies include MIT (`simple-scorm-packager`).
