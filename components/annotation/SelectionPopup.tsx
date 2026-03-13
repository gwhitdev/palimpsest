"use client";

import { useEffect, useRef, useState } from "react";
import { TAXONOMY } from "@/lib/taxonomy";

type Props = {
  position: { x: number; y: number } | null;
  selectedText: string;
  onSelect: (techIds: string[]) => void;
  onComment: () => void;
  onDismiss: () => void;
};

export default function SelectionPopup({ position, selectedText, onSelect, onComment, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);

  useEffect(() => {
    if (!position) {
      setSelectedTechIds([]);
      return;
    }

    setSelectedTechIds([]);
  }, [position, selectedText]);

  const toggleTechnique = (techId: string) => {
    setSelectedTechIds((current) => {
      if (current.includes(techId)) {
        return current.filter((id) => id !== techId);
      }

      return [...current, techId];
    });
  };

  const applySelection = () => {
    if (selectedTechIds.length === 0) return;
    onSelect(selectedTechIds);
  };

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
      <p className="mb-2 text-[11px] text-gray-500">Select one or more techniques, then apply.</p>
      <div className="flex flex-wrap gap-1">
        {TAXONOMY.map((technique) => (
          <button
            key={technique.id}
            onClick={() => toggleTechnique(technique.id)}
            className={`rounded border px-2 py-1 text-xs font-medium hover:bg-gray-50 ${
              selectedTechIds.includes(technique.id)
                ? "bg-gray-900 text-white border-gray-900"
                : technique.level === 1
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

      <div className="mt-3 flex items-center gap-2">
        <button
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-50"
          onClick={() => setSelectedTechIds([])}
          disabled={selectedTechIds.length === 0}
          type="button"
        >
          Clear
        </button>
        <button
          className="w-full rounded border border-gray-900 bg-gray-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          onClick={applySelection}
          disabled={selectedTechIds.length === 0}
          type="button"
        >
          Apply ({selectedTechIds.length})
        </button>
      </div>
    </div>
  );
}
