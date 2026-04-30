"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RichTextField } from "./rich-text-field";
import { isLessonHtmlEmpty, sanitizeLessonHtml } from "@/lib/scorm/sanitize-html";
import type {
  LessonSegment,
  QuizQuestionInput,
  QuizQuestionKind,
} from "@/lib/scorm/types";

const MAX_CARDS = 80;

type MediaKind = "image" | "video" | "audio";

type CardDraft = {
  id: string;
  title: string;
  caption: string;
  bodyHtml: string;
  file: File | null;
  previewUrl: string | null;
};

type QuizRow =
  | {
      kind: "choice";
      prompt: string;
      choices: string[];
      correctIndex: number;
    }
  | {
      kind: "true_false";
      prompt: string;
      correctTrue: boolean;
    }
  | {
      kind: "multi";
      prompt: string;
      choices: string[];
      correctIndices: number[];
    }
  | {
      kind: "short";
      prompt: string;
      acceptableText: string;
    };

type TimelineRow =
  | { id: string; type: "content"; card: CardDraft }
  | { id: string; type: "quiz"; questions: QuizRow[] };

type PreviewSlide =
  | {
      kind: "content";
      title: string;
      caption: string;
      bodyHtml: string;
      src: string | null;
      mediaKind: MediaKind | null;
    }
  | { kind: "quiz"; questionCount: number };

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeExportFilename(file: File, contentIndex: number): string {
  const raw = file.name.split(/[/\\]/).pop() || "asset";
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `c${contentIndex}-${cleaned}`.slice(0, 120);
}

function defaultCard(): CardDraft {
  return {
    id: newId(),
    title: "",
    caption: "",
    bodyHtml: "",
    file: null,
    previewUrl: null,
  };
}

function defaultQuestion(kind: QuizQuestionKind = "choice"): QuizRow {
  switch (kind) {
    case "true_false":
      return { kind: "true_false", prompt: "", correctTrue: true };
    case "multi":
      return { kind: "multi", prompt: "", choices: ["", ""], correctIndices: [0] };
    case "short":
      return { kind: "short", prompt: "", acceptableText: "" };
    case "choice":
    default:
      return { kind: "choice", prompt: "", choices: ["", ""], correctIndex: 0 };
  }
}

function defaultTimelineRow(type: "content" | "quiz"): TimelineRow {
  if (type === "quiz") {
    return { id: newId(), type: "quiz", questions: [defaultQuestion("choice")] };
  }
  return { id: newId(), type: "content", card: defaultCard() };
}

function mediaKindFromFile(file: File): MediaKind {
  const t = file.type;
  if (t.startsWith("video/")) {
    return "video";
  }
  if (t.startsWith("audio/")) {
    return "audio";
  }
  if (t.startsWith("image/")) {
    return "image";
  }
  const name = file.name.toLowerCase();
  if (/\.(mp4|webm|ogv|mov|m4v)$/.test(name)) {
    return "video";
  }
  if (/\.(mp3|wav|m4a|aac|ogg|oga|flac)$/.test(name)) {
    return "audio";
  }
  return "image";
}

function isCardEmpty(c: CardDraft): boolean {
  return (
    !c.file &&
    !c.title.trim() &&
    !c.caption.trim() &&
    isLessonHtmlEmpty(c.bodyHtml)
  );
}

function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const readable = base.replace(/[_-]+/g, " ").trim();
  return readable.slice(0, 500) || "Slide";
}

function cardFromImage(file: File): CardDraft {
  return {
    id: newId(),
    title: titleFromFilename(file.name),
    caption: "",
    bodyHtml: "",
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function toggleIndex(indices: number[], i: number): number[] {
  const set = new Set(indices);
  if (set.has(i)) {
    set.delete(i);
  } else {
    set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

function quizRowsToInputs(rows: QuizRow[]): QuizQuestionInput[] {
  const out: QuizQuestionInput[] = [];
  for (const q of rows) {
    const prompt = q.prompt.trim();
    if (!prompt) {
      continue;
    }
    if (q.kind === "choice") {
      const choices = q.choices.map((c) => c.trim()).filter((c) => c.length > 0);
      if (choices.length < 2) {
        continue;
      }
      if (q.correctIndex < 0 || q.correctIndex >= choices.length) {
        throw new Error("Each multiple-choice question needs a valid correct answer.");
      }
      out.push({
        kind: "choice",
        prompt,
        choices,
        correctIndex: q.correctIndex,
      });
      continue;
    }
    if (q.kind === "true_false") {
      out.push({
        kind: "true_false",
        prompt,
        correctTrue: q.correctTrue,
      });
      continue;
    }
    if (q.kind === "multi") {
      const choices = q.choices.map((c) => c.trim()).filter((c) => c.length > 0);
      if (choices.length < 2) {
        continue;
      }
      const correctIndices = q.correctIndices.filter(
        (i) => i >= 0 && i < choices.length
      );
      const unique = [...new Set(correctIndices)].sort((a, b) => a - b);
      if (unique.length === 0) {
        throw new Error(
          "Select at least one correct choice for multiple-response questions."
        );
      }
      out.push({ kind: "multi", prompt, choices, correctIndices: unique });
      continue;
    }
    if (q.kind === "short") {
      const acceptableAnswers = q.acceptableText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (acceptableAnswers.length === 0) {
        continue;
      }
      out.push({ kind: "short", prompt, acceptableAnswers });
    }
  }
  return out;
}

function GripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

function QuizQuestionsEditor({
  questions,
  onChange,
  inputCls,
}: {
  questions: QuizRow[];
  onChange: (rows: QuizRow[]) => void;
  inputCls: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Questions in this block
        </span>
        <button
          type="button"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
          onClick={() => onChange([...questions, defaultQuestion("choice")])}
        >
          Add question
        </button>
      </div>
      {questions.map((q, qi) => (
        <div
          key={qi}
          className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-600 dark:bg-zinc-900/40"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold">Question {qi + 1}</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <span className="text-zinc-500">Type</span>
                <select
                  className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                  value={q.kind}
                  onChange={(e) => {
                    const k = e.target.value as QuizQuestionKind;
                    onChange(
                      questions.map((row, i) =>
                        i === qi ? { ...defaultQuestion(k), prompt: row.prompt } : row
                      )
                    );
                  }}
                >
                  <option value="choice">Multiple choice</option>
                  <option value="true_false">True / false</option>
                  <option value="multi">Multiple response</option>
                  <option value="short">Short answer</option>
                </select>
              </label>
              <button
                type="button"
                className="text-xs text-red-600"
                onClick={() => onChange(questions.filter((_, i) => i !== qi))}
              >
                Remove
              </button>
            </div>
          </div>
          <textarea
            className={`mb-2 min-h-[64px] w-full text-sm ${inputCls}`}
            placeholder="Prompt"
            value={q.prompt}
            onChange={(e) =>
              onChange(
                questions.map((r, i) =>
                  i === qi ? { ...r, prompt: e.target.value } : r
                )
              )
            }
          />

          {q.kind === "choice" ? (
            <>
              {q.choices.map((c, ci) => (
                <label key={ci} className="mb-1 flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`seg-q-${qi}-correct`}
                    checked={q.correctIndex === ci}
                    onChange={() =>
                      onChange(
                        questions.map((r, i) =>
                          i === qi && r.kind === "choice"
                            ? { ...r, correctIndex: ci }
                            : r
                        )
                      )
                    }
                  />
                  <input
                    className={inputCls}
                    value={c}
                    placeholder={`Choice ${ci + 1}`}
                    onChange={(e) =>
                      onChange(
                        questions.map((r, i) => {
                          if (i !== qi || r.kind !== "choice") {
                            return r;
                          }
                          const choices = [...r.choices];
                          choices[ci] = e.target.value;
                          return { ...r, choices };
                        })
                      )
                    }
                  />
                </label>
              ))}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="text-xs"
                  onClick={() =>
                    onChange(
                      questions.map((r, i) => {
                        if (i !== qi || r.kind !== "choice" || r.choices.length >= 8) {
                          return r;
                        }
                        return { ...r, choices: [...r.choices, ""] };
                      })
                    )
                  }
                >
                  Add choice
                </button>
                <button
                  type="button"
                  className="text-xs"
                  onClick={() =>
                    onChange(
                      questions.map((r, i) => {
                        if (i !== qi || r.kind !== "choice" || r.choices.length <= 2) {
                          return r;
                        }
                        const choices = r.choices.slice(0, -1);
                        let correctIndex = r.correctIndex;
                        if (correctIndex >= choices.length) {
                          correctIndex = choices.length - 1;
                        }
                        return { ...r, choices, correctIndex };
                      })
                    )
                  }
                >
                  Remove last choice
                </button>
              </div>
            </>
          ) : null}

          {q.kind === "true_false" ? (
            <div className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-zinc-500">Correct answer</span>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`tf-${qi}`}
                  checked={q.correctTrue === true}
                  onChange={() =>
                    onChange(
                      questions.map((r, i) =>
                        i === qi && r.kind === "true_false"
                          ? { ...r, correctTrue: true }
                          : r
                      )
                    )
                  }
                />
                True
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`tf-${qi}`}
                  checked={q.correctTrue === false}
                  onChange={() =>
                    onChange(
                      questions.map((r, i) =>
                        i === qi && r.kind === "true_false"
                          ? { ...r, correctTrue: false }
                          : r
                      )
                    )
                  }
                />
                False
              </label>
            </div>
          ) : null}

          {q.kind === "multi" ? (
            <>
              {q.choices.map((c, ci) => (
                <div key={ci} className="mb-1 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={q.correctIndices.includes(ci)}
                    onChange={() =>
                      onChange(
                        questions.map((r, i) => {
                          if (i !== qi || r.kind !== "multi") {
                            return r;
                          }
                          return {
                            ...r,
                            correctIndices: toggleIndex(r.correctIndices, ci),
                          };
                        })
                      )
                    }
                    aria-label={`Correct: choice ${ci + 1}`}
                  />
                  <input
                    className={`flex-1 ${inputCls}`}
                    value={c}
                    placeholder={`Option ${ci + 1}`}
                    onChange={(e) =>
                      onChange(
                        questions.map((r, i) => {
                          if (i !== qi || r.kind !== "multi") {
                            return r;
                          }
                          const choices = [...r.choices];
                          choices[ci] = e.target.value;
                          return { ...r, choices };
                        })
                      )
                    }
                  />
                </div>
              ))}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="text-xs"
                  onClick={() =>
                    onChange(
                      questions.map((r, i) => {
                        if (i !== qi || r.kind !== "multi" || r.choices.length >= 8) {
                          return r;
                        }
                        return { ...r, choices: [...r.choices, ""] };
                      })
                    )
                  }
                >
                  Add option
                </button>
                <button
                  type="button"
                  className="text-xs"
                  onClick={() =>
                    onChange(
                      questions.map((r, i) => {
                        if (i !== qi || r.kind !== "multi" || r.choices.length <= 2) {
                          return r;
                        }
                        const choices = r.choices.slice(0, -1);
                        const correctIndices = r.correctIndices.filter(
                          (idx) => idx < choices.length
                        );
                        return { ...r, choices, correctIndices };
                      })
                    )
                  }
                >
                  Remove last option
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                Check every option that must be selected for a correct answer.
              </p>
            </>
          ) : null}

          {q.kind === "short" ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Acceptable answers (one per line)
              </span>
              <textarea
                className={`min-h-[80px] w-full text-sm ${inputCls}`}
                placeholder={"Paris\nparis, France"}
                value={q.acceptableText}
                onChange={(e) =>
                  onChange(
                    questions.map((r, i) =>
                      i === qi && r.kind === "short"
                        ? { ...r, acceptableText: e.target.value }
                        : r
                    )
                  )
                }
              />
            </label>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SlideshowPreview({ slides }: { slides: PreviewSlide[] }) {
  const [idx, setIdx] = useState(0);

  if (slides.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Add timeline blocks to see the preview.
      </p>
    );
  }

  const n = slides.length;
  const safeIdx = Math.min(Math.max(0, idx), n - 1);
  const cur = slides[safeIdx];

  if (cur.kind === "quiz") {
    return (
      <div className="sco-preview">
        <div className="overflow-hidden rounded-xl border border-indigo-200 bg-indigo-50/80 p-6 shadow-md dark:border-indigo-800 dark:bg-indigo-950/40">
          <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
            Quiz block
          </p>
          <p className="mt-2 text-sm text-indigo-800 dark:text-indigo-200">
            {cur.questionCount} question{cur.questionCount === 1 ? "" : "s"} — same
            order as in the published SCORM player.
          </p>
        </div>
        {n > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              disabled={safeIdx <= 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              Previous
            </button>
            <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
              {safeIdx + 1} / {n}
            </span>
            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              disabled={safeIdx >= n - 1}
              onClick={() => setIdx((i) => Math.min(n - 1, i + 1))}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const safeBody = cur.bodyHtml ? sanitizeLessonHtml(cur.bodyHtml) : "";

  return (
    <div className="sco-preview">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-md dark:border-zinc-600 dark:bg-zinc-800/80">
        <div className="flex min-h-[200px] items-center justify-center bg-zinc-100 dark:bg-zinc-900/60">
          {cur.src && cur.mediaKind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cur.src}
              alt=""
              className="max-h-[min(50vh,320px)] w-full object-contain"
            />
          ) : null}
          {cur.src && cur.mediaKind === "video" ? (
            <video
              src={cur.src}
              className="max-h-[min(50vh,320px)] w-full object-contain"
              controls
            />
          ) : null}
          {cur.src && cur.mediaKind === "audio" ? (
            <audio src={cur.src} className="w-full max-w-md px-4" controls />
          ) : null}
          {!cur.src ? (
            <span className="text-sm text-zinc-400">No media on this slide</span>
          ) : null}
        </div>
        <div className="space-y-2 p-4">
          {cur.title ? (
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {cur.title}
            </h3>
          ) : null}
          {cur.caption ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{cur.caption}</p>
          ) : null}
          {safeBody ? (
            <div
              className="prose prose-sm max-w-none text-zinc-800 dark:prose-invert dark:text-zinc-200"
              dangerouslySetInnerHTML={{ __html: safeBody }}
            />
          ) : null}
        </div>
      </div>
      {n > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            disabled={safeIdx <= 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
          >
            Previous
          </button>
          <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            {safeIdx + 1} / {n}
          </span>
          <button
            type="button"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            disabled={safeIdx >= n - 1}
            onClick={() => setIdx((i) => Math.min(n - 1, i + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
      <p className="mt-3 text-center text-xs text-zinc-500">
        Matches SCORM slideshow (arrow keys work in the published package).
      </p>
    </div>
  );
}

function SortableTimelineRow({
  row,
  inputCls,
  contentCount,
  onChangeCard,
  onFile,
  onChangeQuiz,
  onChangeType,
  onRemove,
}: {
  row: TimelineRow;
  inputCls: string;
  contentCount: number;
  onChangeCard: (id: string, patch: Partial<CardDraft>) => void;
  onFile: (id: string, file: File | null) => void;
  onChangeQuiz: (id: string, questions: QuizRow[]) => void;
  onChangeType: (id: string, type: "content" | "quiz") => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : 0,
    opacity: isDragging ? 0.85 : 1,
  };

  const boxCls =
    "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div ref={setNodeRef} style={style} className={boxCls}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="mt-0.5 cursor-grab touch-none rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing dark:hover:bg-zinc-800"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Block type
            <select
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              value={row.type}
              onChange={(e) =>
                onChangeType(row.id, e.target.value as "content" | "quiz")
              }
            >
              <option value="content">Content</option>
              <option value="quiz">Quiz</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="text-xs text-red-600 hover:underline dark:text-red-400"
          onClick={() => onRemove(row.id)}
        >
          Remove block
        </button>
      </div>

      {row.type === "content" ? (
        <ContentFields
          rowId={row.id}
          card={row.card}
          contentCount={contentCount}
          onChange={(patch) => onChangeCard(row.id, patch)}
          onFile={(f) => onFile(row.id, f)}
        />
      ) : (
        <QuizQuestionsEditor
          questions={row.questions}
          onChange={(q) => onChangeQuiz(row.id, q)}
          inputCls={inputCls}
        />
      )}
    </div>
  );
}

function ContentFields({
  rowId,
  card,
  contentCount,
  onChange,
  onFile,
}: {
  rowId: string;
  card: CardDraft;
  contentCount: number;
  onChange: (patch: Partial<CardDraft>) => void;
  onFile: (file: File | null) => void;
}) {
  const mediaKind = card.file ? mediaKindFromFile(card.file) : null;

  return (
    <>
      <p className="mb-3 text-xs text-zinc-500">
        Content slide {contentCount > 0 ? `(${contentCount} of max ${MAX_CARDS})` : ""}
      </p>
      <div className="mb-3">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Media (image, video, or audio)
        </label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start">
          <input
            type="file"
            accept="image/*,video/*,audio/*"
            className="text-sm text-zinc-700 file:mr-2 dark:text-zinc-300"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onFile(f);
            }}
          />
          {card.previewUrl && mediaKind === "image" ? (
            <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.previewUrl}
                alt=""
                className="max-h-40 w-full max-w-xs object-contain"
              />
            </div>
          ) : null}
          {card.previewUrl && mediaKind === "video" ? (
            <video
              src={card.previewUrl}
              className="max-h-40 w-full max-w-xs rounded-lg border border-zinc-200 dark:border-zinc-600"
              controls
            />
          ) : null}
          {card.previewUrl && mediaKind === "audio" ? (
            <audio src={card.previewUrl} className="w-full max-w-xs" controls />
          ) : null}
          {!card.previewUrl ? (
            <span className="text-xs text-zinc-400">No media yet</span>
          ) : null}
        </div>
      </div>
      <div className="space-y-2">
        <input
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          placeholder="Card title (optional)"
          value={card.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <input
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          placeholder="Short caption (optional)"
          value={card.caption}
          onChange={(e) => onChange({ caption: e.target.value })}
        />
        <RichTextField
          key={`${rowId}-rt`}
          initialHtml={card.bodyHtml}
          onChange={(html) => onChange({ bodyHtml: html })}
        />
      </div>
    </>
  );
}

export function LessonCardEditor() {
  const bulkImagesInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("My card lesson");
  const [organization, setOrganization] = useState("");
  const [masteryPercent, setMasteryPercent] = useState(80);
  const [timeline, setTimeline] = useState<TimelineRow[]>([
    { id: newId(), type: "content", card: defaultCard() },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const contentRows = useMemo(
    () => timeline.filter((t) => t.type === "content"),
    [timeline]
  );

  const previewSlides = useMemo((): PreviewSlide[] => {
    const slides: PreviewSlide[] = [];
    for (const row of timeline) {
      if (row.type === "content") {
        const c = row.card;
        slides.push({
          kind: "content",
          title: c.title,
          caption: c.caption,
          bodyHtml: c.bodyHtml,
          src: c.previewUrl,
          mediaKind: c.file ? mediaKindFromFile(c.file) : null,
        });
      } else {
        const n = row.questions.filter((q) => q.prompt.trim()).length;
        slides.push({
          kind: "quiz",
          questionCount: n || row.questions.length,
        });
      }
    }
    return slides;
  }, [timeline]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setTimeline((items) => {
      const oldIndex = items.findIndex((x) => x.id === active.id);
      const newIndex = items.findIndex((x) => x.id === over.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  }

  function updateCard(id: string, patch: Partial<CardDraft>) {
    setTimeline((prev) =>
      prev.map((row) => {
        if (row.id !== id || row.type !== "content") {
          return row;
        }
        return { ...row, card: { ...row.card, ...patch } };
      })
    );
  }

  function setCardFile(id: string, file: File | null) {
    setTimeline((prev) =>
      prev.map((row) => {
        if (row.id !== id || row.type !== "content") {
          return row;
        }
        const c = row.card;
        if (c.previewUrl) {
          URL.revokeObjectURL(c.previewUrl);
        }
        if (!file) {
          return { ...row, card: { ...c, file: null, previewUrl: null } };
        }
        return {
          ...row,
          card: {
            ...c,
            file,
            previewUrl: URL.createObjectURL(file),
          },
        };
      })
    );
  }

  function changeRowType(id: string, newType: "content" | "quiz") {
    setTimeline((prev) =>
      prev.map((row) => {
        if (row.id !== id) {
          return row;
        }
        if (row.type === newType) {
          return row;
        }
        if (row.type === "content" && row.card.previewUrl) {
          URL.revokeObjectURL(row.card.previewUrl);
        }
        if (newType === "content") {
          return { id, type: "content", card: defaultCard() };
        }
        return { id, type: "quiz", questions: [defaultQuestion("choice")] };
      })
    );
  }

  function updateQuiz(id: string, questions: QuizRow[]) {
    setTimeline((prev) =>
      prev.map((row) =>
        row.id === id && row.type === "quiz" ? { ...row, questions } : row
      )
    );
  }

  function addBlock(type: "content" | "quiz") {
    if (type === "content" && contentRows.length >= MAX_CARDS) {
      setError(`At most ${MAX_CARDS} content slides.`);
      return;
    }
    setError(null);
    setTimeline((t) => [...t, defaultTimelineRow(type)]);
  }

  function handleBulkImagesChosen(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      setError("No image files found. Use PNG, JPEG, WebP, GIF, or SVG.");
      if (bulkImagesInputRef.current) {
        bulkImagesInputRef.current.value = "";
      }
      return;
    }

    const contentBlocks = timeline.filter((t) => t.type === "content");
    const onlyEmptyStarter =
      timeline.length === 1 &&
      timeline[0].type === "content" &&
      isCardEmpty(timeline[0].card);
    const baseLen = onlyEmptyStarter ? 0 : contentBlocks.length;
    const room = MAX_CARDS - baseLen;
    const slice = images.slice(0, room);

    if (slice.length === 0) {
      setError(`You already have ${MAX_CARDS} content slides (maximum).`);
      if (bulkImagesInputRef.current) {
        bulkImagesInputRef.current.value = "";
      }
      return;
    }

    if (images.length > slice.length) {
      setError(
        `Added ${slice.length} slide(s). ${images.length - slice.length} image(s) skipped (max ${MAX_CARDS} content slides).`
      );
    } else {
      setError(null);
    }

    setTimeline((prev) => {
      const onlyEmpty =
        prev.length === 1 &&
        prev[0].type === "content" &&
        isCardEmpty(prev[0].card);
      if (onlyEmpty && prev[0].type === "content" && prev[0].card.previewUrl) {
        URL.revokeObjectURL(prev[0].card.previewUrl);
      }
      const base = onlyEmpty ? [] : [...prev];
      const newRows: TimelineRow[] = slice.map((f) => ({
        id: newId(),
        type: "content" as const,
        card: cardFromImage(f),
      }));
      return [...base, ...newRows];
    });

    if (bulkImagesInputRef.current) {
      bulkImagesInputRef.current.value = "";
    }
  }

  function removeRow(id: string) {
    setTimeline((prev) => {
      const next = prev.filter((row) => {
        if (row.id !== id) {
          return true;
        }
        if (row.type === "content" && row.card.previewUrl) {
          URL.revokeObjectURL(row.card.previewUrl);
        }
        return false;
      });
      return next.length ? next : [defaultTimelineRow("content")];
    });
  }

  function buildLessonSegments(): LessonSegment[] {
    const segments: LessonSegment[] = [];
    let contentIdx = 0;

    for (const row of timeline) {
      if (row.type === "content") {
        const c = row.card;
        const fn = c.file ? safeExportFilename(c.file, contentIdx) : null;
        contentIdx += 1;
        segments.push({
          type: "content",
          title: c.title.trim(),
          caption: c.caption.trim(),
          bodyHtml: c.bodyHtml.trim()
            ? sanitizeLessonHtml(c.bodyHtml)
            : "",
          mediaFilename: fn,
          mediaType: c.file && fn ? mediaKindFromFile(c.file) : null,
        });
      } else {
        const qs = quizRowsToInputs(row.questions);
        if (qs.length > 0) {
          segments.push({ type: "quiz", questions: qs });
        }
      }
    }

    return segments;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const segments = buildLessonSegments();
      if (segments.length === 0) {
        setError("Add at least one content or quiz block with content.");
        return;
      }

      const totalQuiz = segments
        .filter((s): s is { type: "quiz"; questions: QuizQuestionInput[] } => s.type === "quiz")
        .reduce((n, s) => n + s.questions.length, 0);
      if (totalQuiz > 25) {
        setError("At most 25 quiz questions total across all quiz blocks.");
        return;
      }

      const metadata = JSON.stringify({
        title,
        organization,
        body: "",
        masteryPercent,
        segments,
      });

      const form = new FormData();
      form.append("metadata", metadata);

      let contentIdx = 0;
      for (const row of timeline) {
        if (row.type !== "content" || !row.card.file) {
          continue;
        }
        const name = safeExportFilename(row.card.file, contentIdx);
        contentIdx += 1;
        const renamed = new File([row.card.file], name, {
          type: row.card.file.type,
        });
        form.append("assets", renamed);
      }

      const res = await fetch("/api/export", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Export failed (${res.status})`);
        return;
      }

      const cd = res.headers.get("Content-Disposition");
      let downloadName = "course_scorm12.zip";
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) {
        downloadName = m[1];
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error while exporting."
      );
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          SCORM card lesson
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Build an ordered lesson: drag blocks to reorder. Mix content slides and quiz
          blocks anywhere. One SCORM score uses all quiz questions and the mastery %
          below.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-6 py-8 lg:grid-cols-2 lg:items-start">
        <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              Course title
            </span>
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              Organization / author{" "}
              <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <input
              className={inputCls}
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              maxLength={200}
            />
          </label>

          <label className="flex max-w-xs flex-col gap-1 text-xs">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              Quiz mastery % (all quiz blocks combined)
            </span>
            <input
              type="number"
              min={0}
              max={100}
              className={inputCls}
              value={masteryPercent}
              onChange={(e) =>
                setMasteryPercent(parseInt(e.target.value, 10) || 0)
              }
            />
          </label>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Lesson timeline
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={bulkImagesInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => handleBulkImagesChosen(e.target.files)}
                />
                <button
                  type="button"
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium dark:border-zinc-600 dark:bg-zinc-800"
                  onClick={() => addBlock("content")}
                >
                  Add content
                </button>
                <button
                  type="button"
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium dark:border-zinc-600 dark:bg-zinc-800"
                  onClick={() => addBlock("quiz")}
                >
                  Add quiz block
                </button>
                <button
                  type="button"
                  className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-900 dark:border-indigo-600 dark:bg-indigo-950/80 dark:text-indigo-100"
                  onClick={() => bulkImagesInputRef.current?.click()}
                >
                  Create slides from images
                </button>
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Bulk upload adds content slides (one per image). Quiz blocks can hold
              multiple questions, like the old single quiz section.
            </p>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={timeline.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-4">
                  {timeline.map((row, rowIndex) => {
                    const contentNum =
                      row.type === "content"
                        ? timeline
                            .slice(0, rowIndex)
                            .filter((r) => r.type === "content").length + 1
                        : 0;
                    return (
                      <SortableTimelineRow
                        key={row.id}
                        row={row}
                        inputCls={inputCls}
                        contentCount={contentNum}
                        onChangeCard={updateCard}
                        onFile={setCardFile}
                        onChangeQuiz={updateQuiz}
                        onChangeType={changeRowType}
                        onRemove={removeRow}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {busy ? "Building zip…" : "Download SCORM 1.2 package"}
          </button>
        </form>

        <aside className="lg:sticky lg:top-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Live preview
          </h2>
          <SlideshowPreview
            key={timeline.map((t) => t.id).join("|")}
            slides={previewSlides}
          />
        </aside>
      </div>
    </div>
  );
}
