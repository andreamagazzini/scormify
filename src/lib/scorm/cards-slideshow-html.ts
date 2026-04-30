import { escapeHtmlAttr, escapeHtmlText } from "./content";
import { sanitizeLessonHtml } from "./sanitize-html";
import { QUIZ_INLINE_STYLES, renderQuestionFieldsets } from "./quiz-markup";
import type {
  LessonCardPayload,
  LessonSegment,
  QuizQuestionInput,
} from "./types";

function mediaBlock(
  mediaType: NonNullable<LessonCardPayload["mediaType"]>,
  src: string,
  alt: string
): string {
  const safeSrc = `assets/${escapeHtmlAttr(src)}`;
  switch (mediaType) {
    case "image":
      return `<div class="sco-card-media"><img src="${safeSrc}" alt="${escapeHtmlAttr(alt)}" /></div>`;
    case "video":
      return `<div class="sco-card-media"><video class="sco-video" controls src="${safeSrc}" preload="metadata"></video></div>`;
    case "audio":
      return `<div class="sco-card-media sco-card-media--audio"><audio class="sco-audio" controls src="${safeSrc}" preload="metadata"></audio></div>`;
  }
}

export function renderContentSlide(
  card: LessonCardPayload,
  slideIndex: number,
  totalSlides: number,
  allowedAssetNames: Set<string>
): string {
  const safeBody = sanitizeLessonHtml(card.bodyHtml);
  const hasMedia =
    card.mediaFilename != null &&
    card.mediaFilename.length > 0 &&
    card.mediaType != null &&
    allowedAssetNames.has(card.mediaFilename);

  const alt = card.title.trim() || `Slide ${slideIndex + 1} of ${totalSlides}`;
  const media = hasMedia
    ? mediaBlock(card.mediaType!, card.mediaFilename!, alt)
    : `<div class="sco-card-media sco-card-media--empty" aria-hidden="true"><span class="sco-card-placeholder">No media</span></div>`;

  const titleHtml = card.title.trim()
    ? `<h2 class="sco-card-title">${escapeHtmlText(card.title.trim())}</h2>`
    : "";
  const capHtml = card.caption.trim()
    ? `<p class="sco-card-caption">${escapeHtmlText(card.caption.trim())}</p>`
    : "";
  const bodyHtml = safeBody
    ? `<div class="sco-card-text sco-prose">${safeBody}</div>`
    : "";

  const hidden = slideIndex === 0 ? "" : " hidden";
  return `<article class="sco-slide" data-slide="${slideIndex}" aria-roledescription="slide"${hidden}>
  <div class="sco-card">
    ${media}
    <div class="sco-card-body">
      ${titleHtml}
      ${capHtml}
      ${bodyHtml}
    </div>
  </div>
</article>`;
}

function renderQuizSlide(fieldsetsHtml: string, slideIndex: number): string {
  const hidden = slideIndex === 0 ? "" : " hidden";
  return `<article class="sco-slide sco-slide--quiz" data-slide="${slideIndex}" aria-roledescription="slide"${hidden}>
  <div class="sco-card">
    <div class="sco-card-body">
      <h2 class="sco-quiz-segment-title">Quiz</h2>
      <div class="sco-quiz-segment">
      ${fieldsetsHtml}
      </div>
    </div>
  </div>
</article>`;
}

export function flattenTimelineQuizQuestions(
  segments: LessonSegment[]
): QuizQuestionInput[] {
  const out: QuizQuestionInput[] = [];
  for (const s of segments) {
    if (s.type === "quiz") {
      out.push(...s.questions);
    }
  }
  return out;
}

/**
 * Renders an ordered mix of content slides and quiz slides. Quiz inputs share one form
 * when `wrapInQuizForm` is true (global question indices are sequential).
 */
export function renderLessonSegmentsHtml(
  segments: LessonSegment[],
  allowedAssetNames: Set<string>,
  options: { wrapInQuizForm: boolean }
): { html: string; allQuizQuestions: QuizQuestionInput[] } {
  const allQuizQuestions = flattenTimelineQuizQuestions(segments);

  const expanded: {
    kind: "content" | "quiz";
    card?: LessonCardPayload;
    questions?: QuizQuestionInput[];
  }[] = [];
  for (const s of segments) {
    if (s.type === "content") {
      expanded.push({ kind: "content", card: s });
    } else if (s.type === "quiz" && s.questions.length > 0) {
      expanded.push({ kind: "quiz", questions: s.questions });
    }
  }

  if (expanded.length === 0) {
    return { html: "", allQuizQuestions };
  }

  const totalSlides = expanded.length;
  const slides: string[] = [];
  let qBase = 0;
  let slideIndex = 0;

  for (const ex of expanded) {
    if (ex.kind === "content" && ex.card) {
      slides.push(
        renderContentSlide(ex.card, slideIndex, totalSlides, allowedAssetNames)
      );
      slideIndex += 1;
    } else if (ex.kind === "quiz" && ex.questions) {
      const inner = renderQuestionFieldsets(ex.questions, qBase);
      qBase += ex.questions.length;
      slides.push(renderQuizSlide(inner, slideIndex));
      slideIndex += 1;
    }
  }

  const nav =
    totalSlides > 1
      ? `<nav class="sco-slide-nav" aria-label="Slides">
  <button type="button" id="sco-prev" class="sco-nav-btn">Previous</button>
  <span id="sco-slide-counter" class="sco-slide-counter">1 / ${totalSlides}</span>
  <button type="button" id="sco-next" class="sco-nav-btn">Next</button>
</nav>`
      : "";

  const slidesInner = slides.join("\n");

  const hasQuiz = allQuizQuestions.length > 0 && options.wrapInQuizForm;

  let inner: string;
  if (hasQuiz) {
    inner = `<form id="sco-quiz-form" novalidate>
<style>
${QUIZ_INLINE_STYLES}
</style>
<div id="sco-slides-root" class="sco-slides-root">
${slidesInner}
</div>
<div class="sco-quiz-footer">
  <p><button type="submit" id="sco-quiz-submit" class="sco-quiz-submit">Submit answers</button></p>
  <p id="sco-quiz-feedback" class="sco-quiz-feedback" hidden></p>
</div>
</form>
${nav}`;
  } else {
    inner = `<div id="sco-slides-root" class="sco-slides-root">
${slidesInner}
</div>
${nav}`;
  }

  const html = `<section class="sco-lesson" aria-label="Lesson" data-slide-count="${totalSlides}">
${inner}
</section>`;

  return { html, allQuizQuestions };
}

/**
 * Slideshow markup: one visible slide at a time, nav wired in sco-runtime.js.
 * @deprecated Prefer {@link renderLessonSegmentsHtml} with content-only segments.
 */
export function renderCardsSlideshowHtml(
  cards: LessonCardPayload[],
  allowedAssetNames: Set<string>
): string {
  if (cards.length === 0) {
    return "";
  }
  const segments: LessonSegment[] = cards.map((c) => ({
    type: "content",
    ...c,
  }));
  return renderLessonSegmentsHtml(segments, allowedAssetNames, {
    wrapInQuizForm: false,
  }).html;
}
