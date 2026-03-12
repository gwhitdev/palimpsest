"use client";

import { useState } from "react";
import { TAXONOMY } from "@/lib/taxonomy";
import { useAnnotationStore } from "@/store/annotationStore";

type Props = {
  docId: string;
  docContent?: string;
  projectId?: string | null;
};

export default function TechniquePanel({ docId, docContent, projectId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const { aiSuggestions, setAISuggestions, setLoadingAI, isLoadingAI, setSuggestionsDrawerOpen } =
    useAnnotationStore();

  const requestAiSuggestions = async () => {
    if (!docContent) return;

    setError(null);
    setLoadingAI(true);

    try {
      const response = await fetch("/api/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: docContent, documentId: docId, projectId }),
      });

      const raw = await response.text();
      let data: { suggestions?: { techId: string; text: string }[]; error?: string } = {};

      if (raw.trim().length > 0) {
        try {
          data = JSON.parse(raw) as { suggestions?: { techId: string; text: string }[]; error?: string };
        } catch {
          data = { error: "AI service returned an unexpected response." };
        }
      }

      if (!response.ok) {
        throw new Error(data.error ?? `Unable to fetch suggestions (HTTP ${response.status}).`);
      }

      setAISuggestions(data.suggestions ?? []);
      setSuggestionsDrawerOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to fetch suggestions.");
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div className="h-full space-y-4 p-4">
      <div className="rounded-xl border border-gray-200 p-3">
        <h2 className="text-sm font-semibold">AI Assist</h2>
        <p className="mb-3 mt-1 text-xs text-gray-600">Generate suggestions with Anthropic for this document.</p>
        <button
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!docContent || isLoadingAI}
          onClick={requestAiSuggestions}
          type="button"
        >
          {isLoadingAI ? "Generating..." : "Generate AI Suggestions"}
        </button>
        <button
          className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900"
          onClick={() => setSuggestionsDrawerOpen(true)}
          type="button"
        >
          Open Suggestions Drawer ({aiSuggestions.length})
        </button>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>

      <div className="rounded-xl border border-gray-200 p-3">
        <h3 className="text-sm font-semibold">Taxonomy</h3>
        <ul className="mt-2 space-y-2">
          {TAXONOMY.map((technique) => (
            <li key={technique.id} className="rounded-md border border-gray-100 p-2">
              <p className="text-xs font-semibold">{technique.id} - {technique.name}</p>
              <p className="text-xs text-gray-600">{technique.plainName}</p>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-gray-500">Suggestions are available in the separate AI drawer.</p>
    </div>
  );
}
