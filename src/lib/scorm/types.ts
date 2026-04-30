export type QuizQuestionKind = "choice" | "true_false" | "multi" | "short";

export type QuizQuestionInput =
  | {
      kind: "choice";
      prompt: string;
      choices: string[];
      correctIndex: number;
    }
  | {
      kind: "true_false";
      prompt: string;
      /** True = “True” is correct; false = “False” is correct */
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
      acceptableAnswers: string[];
    };

export type QuizPayload = {
  masteryPercent: number;
  questions: QuizQuestionInput[];
};

/** Ordered lesson timeline: content slides and quiz blocks (any order). */
export type LessonSegment =
  | ({ type: "content" } & LessonCardPayload)
  | { type: "quiz"; questions: QuizQuestionInput[] };

export type LessonMediaType = "image" | "video" | "audio";

export type LessonCardPayload = {
  title: string;
  caption: string;
  /** Sanitized subset HTML */
  bodyHtml: string;
  mediaType: LessonMediaType | null;
  /** Filename inside assets/ */
  mediaFilename: string | null;
};
