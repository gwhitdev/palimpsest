"use client";

import { useMemo, useState } from "react";
import { TAXONOMY } from "@/lib/taxonomy";
import { TAXONOMY_LEVEL_BADGE_CLASSES, TAXONOMY_LEVEL_LABELS } from "@/lib/taxonomyLevels";
import { useAnnotationStore } from "@/store/annotationStore";

type Suggestion = {
  techId: string;
  text: string;
};

type Props = {
  onAcceptSuggestion: (suggestion: Suggestion, index: number) => Promise<void>;
  showLaunchButton?: boolean;
};

export default function AISuggestionsDrawer({ onAcceptSuggestion, showLaunchButton = true }: Props) {
  const [acceptingIndex, setAcceptingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taxonomyById = useMemo(() => new Map(TAXONOMY.map((technique) => [technique.id, technique])), []);
  const {
    aiSuggestions,
    dismissSuggestion,
    isSuggestionsDrawerOpen,
    setSuggestionsDrawerOpen,
  } = useAnnotationStore();

  const handleAccept = async (index: number) => {
    const suggestion = aiSuggestions[index];
    if (!suggestion) return;

    setError(null);
    setAcceptingIndex(index);

    try {
      await onAcceptSuggestion({ techId: suggestion.techId, text: suggestion.text }, index);
      dismissSuggestion(index);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept suggestion.");
    } finally {
      setAcceptingIndex(null);
    }
  };

  return (
    <>
      {showLaunchButton && !isSuggestionsDrawerOpen && (
        <button
          className="absolute right-3 top-3 z-30 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900"
          onClick={() => setSuggestionsDrawerOpen(true)}
          type="button"
        >
          Show AI Suggestions ({aiSuggestions.length})
        </button>
      )}

      {isSuggestionsDrawerOpen && (
        <aside className="absolute bottom-0 right-0 top-0 z-30 w-80 border-l border-gray-200 bg-white/95 p-4 shadow-xl backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">AI Suggestions ({aiSuggestions.length})</h3>
            <button
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-800"
              onClick={() => setSuggestionsDrawerOpen(false)}
              type="button"
            >
              Hide
            </button>
          </div>

          {error && <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

          {aiSuggestions.length === 0 && <p className="mt-3 text-xs text-gray-600">No suggestions yet.</p>}

          <ul className="mt-3 space-y-2 overflow-y-auto pr-1">
            {aiSuggestions.map((suggestion, index) => {
              const technique = taxonomyById.get(suggestion.techId);

              return (
                <li key={`${suggestion.techId}-${index}`} className="rounded-md border border-gray-200 p-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold">{suggestion.techId}</p>
                    {technique && (
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${TAXONOMY_LEVEL_BADGE_CLASSES[technique.level]}`}
                      >
                        {TAXONOMY_LEVEL_LABELS[technique.level]}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-700">{suggestion.text}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      className="text-xs font-medium text-gray-900 underline disabled:opacity-50"
                      disabled={acceptingIndex === index}
                      onClick={() => void handleAccept(index)}
                      type="button"
                    >
                      {acceptingIndex === index ? "Accepting..." : "Accept"}
                    </button>
                    <button
                      className="text-xs font-medium text-gray-600 underline"
                      onClick={() => dismissSuggestion(index)}
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
    </>
  );
}
