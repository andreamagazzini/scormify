<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

### Overview

Scormify is a single Next.js 16 application (no external services, no database). It lets users create SCORM 1.2 e-learning packages in the browser.

### Running the app

- `pnpm dev` starts the dev server on port 3000 (the only service needed)
- No `.env` file required; `EXPORT_ERROR_DETAIL=1` can be set for verbose export API errors

### Commands

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Dev server | `pnpm dev` |
| Lint | `pnpm lint` |
| Build | `pnpm build` |

### API testing notes

- `POST /api/export` accepts `application/json` or `multipart/form-data`
- Quiz questions use `type: "choice"` (not "multiple-choice") with `correctIndex` (0-based) — not `answer`
- Mastery field is `masteryPercent` (not `mastery`)
- See `src/lib/scorm/validate-payload.ts` for full payload validation schema
