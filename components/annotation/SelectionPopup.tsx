"use client";

import { useEffect, useRef } from "react";
import { TAXONOMY } from "@/lib/taxonomy";

type Props = {
  position: { x: number; y: number } | null;
  selectedText: string;
  onSelect: (techId: string) => void;
  onComment: () => void;
  onDismiss: () => void;
};

export default function SelectionPopup({ position, selectedText, onSelect, onComment, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onDismiss]);

  if (!position) return null;

  return (
    <div
      ref={ref}
      className="fixed z-50 max-w-xs rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      <p className="mb-1 text-xs font-medium text-gray-500">Assign technique to selection</p>
      <p className="mb-2 line-clamp-2 text-xs text-gray-700">&quot;{selectedText}&quot;</p>
      <button
        className="mb-2 w-full rounded border border-sky-600 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
        onClick={onComment}
        type="button"
      >
        Add Comment
      </button>
      <div className="flex flex-wrap gap-1">
        {TAXONOMY.map((technique) => (
          <button
            key={technique.id}
            onClick={() => onSelect(technique.id)}
            className={`rounded border px-2 py-1 text-xs font-medium hover:bg-gray-50 ${
              technique.level === 1
                ? "border-teal-600 text-teal-800"
                : technique.level === 2
                  ? "border-amber-600 text-amber-800"
                  : "border-violet-600 text-violet-800"
            }`}
            title={technique.definition}
            type="button"
          >
            {technique.id}
          </button>
        ))}
      </div>
    </div>
  );
}
