import { plainTextToSafeHtml } from "./content";
import { isLessonHtmlEmpty, sanitizeLessonHtml } from "./sanitize-html";
import type {
  LessonCardPayload,
  LessonMediaType,
  LessonSegment,
  QuizPayload,
  QuizQuestionInput,
  QuizQuestionKind,
} from "./types";

const MAX_BODY = 400_000;
const MAX_BODY_HTML = 120_000;
const MAX_CARDS = 80;
const MAX_QUIZ_QUESTIONS = 25;
const MAX_CHOICES = 8;
const MIN_CHOICES = 2;

export type ParsedExportMetadata = {
  title: string;
  organization: string;
  body: string;
  masteryPercent: number;
  /** Normalized ordered timeline; null when using plain `body` only. */
  segments: LessonSegment[] | null;
};

export function parseExportMetadataJson(raw: string): ParsedExportMetadata {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid metadata JSON");
  }
  return parseExportMetadataObject(data);
}

export function parseExportMetadataObject(data: unknown): ParsedExportMetadata {
  if (!data || typeof data !== "object") {
    throw new Error("Metadata must be an object");
  }
  const o = data as Record<string, unknown>;
  const title =
    typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
  const body = typeof o.body === "string" ? o.body : "";
  const organization =
    typeof o.organization === "string"
      ? o.organization.trim().slice(0, 200)
      : "Author";

  if (!title) {
    throw new Error("Title is required");
  }
  if (body.length > MAX_BODY) {
    throw new Error(`Body exceeds ${MAX_BODY} characters`);
  }

  let masteryPercent = 80;
  if (typeof o.masteryPercent === "number") {
    masteryPercent = Math.round(o.masteryPercent);
  } else if (o.quiz && typeof o.quiz === "object") {
    const qm = (o.quiz as Record<string, unknown>).masteryPercent;
    if (typeof qm === "number") {
      masteryPercent = Math.round(qm);
    }
  }
  if (masteryPercent < 0 || masteryPercent > 100 || !Number.isFinite(masteryPercent)) {
    masteryPercent = 80;
  }

  let segments: LessonSegment[] | null = null;

  if (o.segments != null) {
    segments = parseSegments(o.segments);
  } else {
    segments = legacySegmentsFromCardsAndQuiz(o);
  }

  const hasSegments = segments && segments.length > 0;
  if (!hasSegments && !body.trim()) {
    throw new Error("Add at least one lesson block, or fill in lesson text");
  }

  if (hasSegments) {
    validateSegments(segments!);
  }

  return { title, organization, body, masteryPercent, segments };
}

function legacySegmentsFromCardsAndQuiz(
  o: Record<string, unknown>
): LessonSegment[] | null {
  const cards =
    o.cards != null ? parseLessonCardsArray(o.cards) : null;
  const quiz = o.quiz != null ? parseQuiz(o.quiz) : null;

  if (!cards?.length && !quiz?.questions.length) {
    return null;
  }

  const out: LessonSegment[] = [];
  if (cards?.length) {
    for (const c of cards) {
      out.push({ type: "content", ...c });
    }
  }
  if (quiz?.questions.length) {
    out.push({ type: "quiz", questions: quiz.questions });
  }
  return out.length ? out : null;
}

function parseSegments(raw: unknown): LessonSegment[] {
  if (!Array.isArray(raw)) {
    throw new Error("segments must be an array");
  }
  if (raw.length === 0) {
    throw new Error("segments cannot be empty");
  }

  const out: LessonSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid segment");
    }
    const r = item as Record<string, unknown>;
    const t = r.type;
    if (t === "content") {
      out.push({ type: "content", ...parseLessonCardFields(r) });
    } else if (t === "quiz") {
      const questionsRaw = r.questions;
      if (!Array.isArray(questionsRaw)) {
        throw new Error("Quiz segment needs questions array");
      }
      const questions: QuizQuestionInput[] = [];
      for (const q of questionsRaw) {
        if (!q || typeof q !== "object") {
          throw new Error("Invalid question in quiz segment");
        }
        questions.push(parseOneQuizQuestion(q as Record<string, unknown>));
      }
      if (questions.length === 0) {
        throw new Error("Each quiz segment needs at least one question");
      }
      out.push({ type: "quiz", questions });
    } else {
      throw new Error('Segment type must be "content" or "quiz"');
    }
  }
  return out;
}

function validateSegments(segments: LessonSegment[]): void {
  let contentCount = 0;
  let questionTotal = 0;

  for (const s of segments) {
    if (s.type === "content") {
      contentCount += 1;
      const hasSomething =
        (s.title && s.title.length > 0) ||
        (s.caption && s.caption.length > 0) ||
        (s.bodyHtml && !isLessonHtmlEmpty(s.bodyHtml)) ||
        (s.mediaFilename && s.mediaFilename.length > 0);
      if (!hasSomething) {
        throw new Error(
          "Each content segment needs media, title, caption, or rich text"
        );
      }
    } else {
      questionTotal += s.questions.length;
    }
  }

  if (contentCount > MAX_CARDS) {
    throw new Error(`At most ${MAX_CARDS} content segments allowed`);
  }
  if (questionTotal > MAX_QUIZ_QUESTIONS) {
    throw new Error(`At most ${MAX_QUIZ_QUESTIONS} quiz questions total`);
  }
}

function guessMediaTypeFromFilename(fn: string): LessonMediaType {
  const lower = fn.toLowerCase();
  if (/\.(mp4|webm|ogv|mov|m4v)$/.test(lower)) {
    return "video";
  }
  if (/\.(mp3|wav|m4a|aac|ogg|oga|flac)$/.test(lower)) {
    return "audio";
  }
  return "image";
}

function parseLessonCardFields(c: Record<string, unknown>): LessonCardPayload {
  const title =
    typeof c.title === "string" ? c.title.trim().slice(0, 500) : "";
  const caption =
    typeof c.caption === "string" ? c.caption.trim().slice(0, 500) : "";

  let bodyHtml = "";
  if (typeof c.bodyHtml === "string") {
    if (c.bodyHtml.length > MAX_BODY_HTML) {
      throw new Error(`Card HTML exceeds ${MAX_BODY_HTML} characters`);
    }
    bodyHtml = sanitizeLessonHtml(c.bodyHtml);
  } else if (typeof c.text === "string" && c.text.trim()) {
    bodyHtml = sanitizeLessonHtml(plainTextToSafeHtml(c.text.trim()));
  }

  let mediaFilename: string | null = null;
  let mediaType: LessonMediaType | null = null;

  if (typeof c.mediaFilename === "string" && c.mediaFilename.trim()) {
    const fn = c.mediaFilename.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(fn)) {
      throw new Error(`Invalid media filename: ${fn}`);
    }
    mediaFilename = fn;
    if (
      c.mediaType === "image" ||
      c.mediaType === "video" ||
      c.mediaType === "audio"
    ) {
      mediaType = c.mediaType;
    } else {
      mediaType = guessMediaTypeFromFilename(fn);
    }
  } else if (typeof c.image === "string" && c.image.trim()) {
    const fn = c.image.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(fn)) {
      throw new Error(`Invalid image filename: ${fn}`);
    }
    mediaFilename = fn;
    mediaType = guessMediaTypeFromFilename(fn);
  }

  return { title, caption, bodyHtml, mediaType, mediaFilename };
}

function parseLessonCardsArray(raw: unknown): LessonCardPayload[] | null {
  if (raw == null) {
    return null;
  }
  if (!Array.isArray(raw)) {
    throw new Error("cards must be an array");
  }
  if (raw.length === 0) {
    return null;
  }
  if (raw.length > MAX_CARDS) {
    throw new Error(`At most ${MAX_CARDS} cards allowed`);
  }

  const out: LessonCardPayload[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid card");
    }
    out.push(parseLessonCardFields(item as Record<string, unknown>));
  }
  return out;
}

/** @deprecated Use assertTimelineAssetsExist */
export function assertCardAssetsExist(
  cards: LessonCardPayload[] | null,
  uploadedNames: Set<string>
): void {
  if (!cards) {
    return;
  }
  for (const c of cards) {
    if (c.mediaFilename && !uploadedNames.has(c.mediaFilename)) {
      throw new Error(`Missing upload for media file: ${c.mediaFilename}`);
    }
  }
}

export function assertTimelineAssetsExist(
  segments: LessonSegment[] | null,
  uploadedNames: Set<string>
): void {
  if (!segments) {
    return;
  }
  for (const s of segments) {
    if (s.type === "content" && s.mediaFilename) {
      if (!uploadedNames.has(s.mediaFilename)) {
        throw new Error(`Missing upload for media file: ${s.mediaFilename}`);
      }
    }
  }
}

function inferQuizKind(it: Record<string, unknown>): QuizQuestionKind {
  if (
    it.kind === "choice" ||
    it.kind === "true_false" ||
    it.kind === "multi" ||
    it.kind === "short"
  ) {
    return it.kind;
  }
  if (it.acceptableAnswers != null) {
    return "short";
  }
  if (it.correctIndices != null) {
    return "multi";
  }
  if (typeof it.correctTrue === "boolean") {
    return "true_false";
  }
  return "choice";
}

function parseQuiz(raw: unknown): QuizPayload | null {
  if (raw === null) {
    return null;
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid quiz");
  }
  const q = raw as Record<string, unknown>;
  let mastery = 80;
  if (typeof q.masteryPercent === "number") {
    mastery = Math.round(q.masteryPercent);
  }
  if (mastery < 0 || mastery > 100 || !Number.isFinite(mastery)) {
    throw new Error("masteryPercent must be between 0 and 100");
  }

  const questionsRaw = q.questions;
  if (!Array.isArray(questionsRaw)) {
    throw new Error("quiz.questions must be an array");
  }
  if (questionsRaw.length === 0) {
    return null;
  }
  if (questionsRaw.length > MAX_QUIZ_QUESTIONS) {
    throw new Error(`At most ${MAX_QUIZ_QUESTIONS} quiz questions`);
  }

  const questions: QuizQuestionInput[] = [];
  for (const item of questionsRaw) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid question");
    }
    const it = item as Record<string, unknown>;
    questions.push(parseOneQuizQuestion(it));
  }

  return { masteryPercent: mastery, questions };
}

function parseOneQuizQuestion(it: Record<string, unknown>): QuizQuestionInput {
  const prompt =
    typeof it.prompt === "string"
      ? it.prompt.trim().slice(0, 2000)
      : "Question";

  const kind = inferQuizKind(it);

  switch (kind) {
    case "true_false": {
      if (typeof it.correctTrue !== "boolean") {
        throw new Error("True/false question needs correctTrue boolean");
      }
      return { kind: "true_false", prompt, correctTrue: it.correctTrue };
    }
    case "short": {
      const raw = it.acceptableAnswers;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("Short answer question needs acceptableAnswers array");
      }
      const acceptableAnswers = raw
        .map((x) => (typeof x === "string" ? x.trim().slice(0, 500) : ""))
        .filter((x) => x.length > 0);
      if (acceptableAnswers.length === 0) {
        throw new Error("Provide at least one acceptable answer");
      }
      return { kind: "short", prompt, acceptableAnswers };
    }
    case "multi": {
      const choicesRaw = it.choices;
      if (!Array.isArray(choicesRaw)) {
        throw new Error("Multiple-response question needs choices array");
      }
      if (
        choicesRaw.length < MIN_CHOICES ||
        choicesRaw.length > MAX_CHOICES
      ) {
        throw new Error(
          `Multiple-response needs ${MIN_CHOICES}–${MAX_CHOICES} choices`
        );
      }
      const choices = choicesRaw.map((c) =>
        typeof c === "string" ? c.trim().slice(0, 500) : ""
      );
      if (choices.some((c) => !c)) {
        throw new Error("Choice text cannot be empty");
      }
      const ciRaw = it.correctIndices;
      if (!Array.isArray(ciRaw) || ciRaw.length === 0) {
        throw new Error("Select at least one correct answer");
      }
      const correctIndices = ciRaw
        .map((x) => (typeof x === "number" ? x : NaN))
        .filter((x) => Number.isInteger(x));
      const unique = [...new Set(correctIndices)];
      for (const idx of unique) {
        if (idx < 0 || idx >= choices.length) {
          throw new Error("Invalid correctIndices entry");
        }
      }
      if (unique.length === 0) {
        throw new Error("Invalid correctIndices");
      }
      return { kind: "multi", prompt, choices, correctIndices: unique };
    }
    case "choice": {
      const choicesRaw = it.choices;
      if (!Array.isArray(choicesRaw)) {
        throw new Error("Question choices must be an array");
      }
      if (
        choicesRaw.length < MIN_CHOICES ||
        choicesRaw.length > MAX_CHOICES
      ) {
        throw new Error(
          `Each question needs ${MIN_CHOICES}–${MAX_CHOICES} choices`
        );
      }
      const choices = choicesRaw.map((c) =>
        typeof c === "string" ? c.trim().slice(0, 500) : ""
      );
      if (choices.some((c) => !c)) {
        throw new Error("Choice text cannot be empty");
      }
      const correctIndex = it.correctIndex;
      if (
        typeof correctIndex !== "number" ||
        !Number.isInteger(correctIndex) ||
        correctIndex < 0 ||
        correctIndex >= choices.length
      ) {
        throw new Error("Invalid correctIndex");
      }
      return { kind: "choice", prompt, choices, correctIndex };
    }
  }
}
