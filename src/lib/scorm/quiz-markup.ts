import { escapeHtmlText } from "./content";
import type { QuizQuestionInput } from "./types";

export const QUIZ_INLINE_STYLES = `
.visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0; }
.sco-short-input { width:100%; max-width:24rem; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:0.375rem; font: inherit; }
`.trim();

function renderOneQuestion(qi: number, q: QuizQuestionInput): string {
  const leg = escapeHtmlText(q.prompt);
  let inner = "";

  switch (q.kind) {
    case "choice": {
      q.choices.forEach((c, ci) => {
        const id = `sco-q${qi}-c${ci}`;
        const req = ci === 0 ? " required" : "";
        inner += `<label class="sco-choice" for="${id}"><input type="radio" name="sco_q_${qi}" id="${id}" value="${ci}"${req} /> <span>${escapeHtmlText(c)}</span></label>`;
      });
      break;
    }
    case "true_false": {
      const tId = `sco-q${qi}-t`;
      const fId = `sco-q${qi}-f`;
      inner += `<label class="sco-choice" for="${tId}"><input type="radio" name="sco_q_${qi}" id="${tId}" value="1" required /> <span>True</span></label>`;
      inner += `<label class="sco-choice" for="${fId}"><input type="radio" name="sco_q_${qi}" id="${fId}" value="0" /> <span>False</span></label>`;
      break;
    }
    case "multi": {
      q.choices.forEach((c, ci) => {
        const id = `sco-q${qi}-c${ci}`;
        inner += `<label class="sco-choice" for="${id}"><input type="checkbox" name="sco_q_${qi}_m" id="${id}" value="${ci}" /> <span>${escapeHtmlText(c)}</span></label>`;
      });
      break;
    }
    case "short": {
      inner += `<label class="sco-short"><span class="visually-hidden">Answer</span><input type="text" name="sco_q_${qi}_short" class="sco-short-input" autocomplete="off" required /></label>`;
      break;
    }
  }

  return `<fieldset class="sco-q" data-qkind="${q.kind}"><legend>${leg}</legend>${inner}</fieldset>`;
}

/** Question fieldsets with global indices starting at `startIndex` (for interleaved quiz slides). */
export function renderQuestionFieldsets(
  questions: QuizQuestionInput[],
  startIndex: number
): string {
  return questions
    .map((q, i) => renderOneQuestion(startIndex + i, q))
    .join("\n");
}

export function renderQuizSection(questions: QuizQuestionInput[]): string {
  if (questions.length === 0) {
    return "";
  }

  let html = `<section id="sco-quiz" class="sco-quiz" aria-label="Quiz">
<h2 class="sco-quiz-title">Quiz</h2>
<form id="sco-quiz-form" novalidate>
<style>
${QUIZ_INLINE_STYLES}
</style>
`;

  html += renderQuestionFieldsets(questions, 0);

  html += `<p><button type="submit" id="sco-quiz-submit" class="sco-quiz-submit">Submit answers</button></p>
</form>
<p id="sco-quiz-feedback" class="sco-quiz-feedback" hidden></p>
</section>`;

  return html;
}

export function renderQuizConfigScript(
  masteryPercent: number,
  questions: QuizQuestionInput[]
): string {
  const payload = { masteryPercent, questions: questions.map(toRuntimeStub) };
  return `<script>window.__SCO_QUIZ__=${JSON.stringify(payload)};<\/script>`;
}

function toRuntimeStub(q: QuizQuestionInput) {
  switch (q.kind) {
    case "choice":
      return { kind: "choice", correctIndex: q.correctIndex };
    case "true_false":
      return { kind: "true_false", correctTrue: q.correctTrue };
    case "multi":
      return { kind: "multi", correctIndices: [...q.correctIndices].sort((a, b) => a - b) };
    case "short":
      return {
        kind: "short",
        acceptableAnswers: q.acceptableAnswers.map((a) => normalizeAnswer(a)),
      };
  }
}

function normalizeAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
