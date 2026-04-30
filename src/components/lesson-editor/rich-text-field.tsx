"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

const toolbarBtn =
  "rounded px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700";

type RichTextFieldProps = {
  /** Initial HTML; remount with `key` when switching cards. */
  initialHtml: string;
  onChange: (html: string) => void;
};

export function RichTextField({ initialHtml, onChange }: RichTextFieldProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        bulletList: { HTMLAttributes: { class: "list-disc pl-5" } },
        orderedList: { HTMLAttributes: { class: "list-decimal pl-5" } },
      }),
    ],
    content: initialHtml?.trim() ? initialHtml : "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[72px] max-h-48 overflow-y-auto rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  if (!editor) {
    return (
      <div className="min-h-[72px] rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900" />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex flex-wrap gap-0.5 rounded-md border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-600 dark:bg-zinc-800/80"
        role="toolbar"
        aria-label="Text formatting"
      >
        <button
          type="button"
          className={toolbarBtn}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          className={toolbarBtn}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          className={toolbarBtn}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H2
        </button>
        <button
          type="button"
          className={toolbarBtn}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          H3
        </button>
        <button
          type="button"
          className={toolbarBtn}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          List
        </button>
        <button
          type="button"
          className={toolbarBtn}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.2.
        </button>
        <button
          type="button"
          className={toolbarBtn}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </button>
        <button
          type="button"
          className={toolbarBtn}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          Code
        </button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Rich text (optional). Allowed tags match the SCORM package sanitizer.
      </p>
      <EditorContent editor={editor} />
    </div>
  );
}
