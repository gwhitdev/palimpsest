"use client";

import { useEffect, useMemo, useState } from "react";
import { TAXONOMY } from "@/lib/taxonomy";
import {
  groupTechniquesByLevel,
  TAXONOMY_LEVEL_DESCRIPTIONS,
  TAXONOMY_LEVEL_LABELS,
} from "@/lib/taxonomyLevels";
import TechniqueStatusBadge from "@/components/ui/TechniqueStatusBadge";
import { parseResponseJson } from "@/lib/http";
import { useAnnotationStore } from "@/store/annotationStore";

type Props = {
  docId: string;
  docContent?: string;
  projectId?: string | null;
  canUseAISuggestions?: boolean;
  canEditTaxonomyPractice?: boolean;
};

type PracticeNotesResponse = {
  notes?: Record<string, { practiceNote: string; updatedAt: string | null }>;
  canEdit?: boolean;
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type PracticeNotePatchResponse = {
  note?: { techId: string; practiceNote: string; updatedAt: string | null };
  error?: string;
};

type KappaTechnique = {
  techId: string;
  kappa: number;
  status: "DRAFT" | "UNDER REVISION" | "LOCKED";
  note?: string;
};

type KappaResponse = {
  byTechnique?: KappaTechnique[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type BoundaryExample = {
  id: string;
  tech_id: string;
  quoted_text: string;
  explanation: string | null;
};

type BoundaryExamplesResponse = {
  examples?: BoundaryExample[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

const TAXONOMY_LEVEL_ROW_CLASSES = {
  1: "border-teal-200 bg-teal-50/70",
  2: "border-amber-200 bg-amber-50/70",
  3: "border-violet-200 bg-violet-50/70",
} as const;

export default function TechniquePanel({
  docId,
  docContent,
  projectId,
  canUseAISuggestions = false,
  canEditTaxonomyPractice = false,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [activeTechniqueId, setActiveTechniqueId] = useState<string | null>(null);
  const [practiceNotes, setPracticeNotes] = useState<Record<string, { practiceNote: string; updatedAt: string | null }>>({});
  const [kappaByTechnique, setKappaByTechnique] = useState<Record<string, KappaTechnique>>({});
  const [boundaryExamplesByTechnique, setBoundaryExamplesByTechnique] = useState<Record<string, BoundaryExample[]>>({});
  const [practiceNoteDraft, setPracticeNoteDraft] = useState("");
  const [isSavingPracticeNote, setIsSavingPracticeNote] = useState(false);
  const [effectiveCanEditPractice, setEffectiveCanEditPractice] = useState(canEditTaxonomyPractice);

  const { setAISuggestions, setLoadingAI, isLoadingAI, setSuggestionsDrawerOpen } = useAnnotationStore();

  useEffect(() => {
    setEffectiveCanEditPractice(canEditTaxonomyPractice);
  }, [canEditTaxonomyPractice]);

  useEffect(() => {
    if (!projectId) {
      setPracticeNotes({});
      setKappaByTechnique({});
      setBoundaryExamplesByTechnique({});
      return;
    }

    (async () => {
      try {
        const [practiceResponse, kappaResponse, boundaryResponse] = await Promise.all([
          fetch(`/api/taxonomy-practice?projectId=${projectId}`),
          fetch(`/api/kappa?projectId=${projectId}`),
          fetch(`/api/boundary-examples?projectId=${projectId}`),
        ]);

        const practicePayload = await parseResponseJson<PracticeNotesResponse>(practiceResponse, {});
        const kappaPayload = await parseResponseJson<KappaResponse>(kappaResponse, {});
        const boundaryPayload = await parseResponseJson<BoundaryExamplesResponse>(boundaryResponse, {});

        if (!practiceResponse.ok) {
          throw new Error(practicePayload.error ?? "Unable to load taxonomy practice notes.");
        }

        setPracticeNotes(practicePayload.notes ?? {});
        if (typeof practicePayload.canEdit === "boolean") {
          setEffectiveCanEditPractice(practicePayload.canEdit);
        }

        if (practicePayload.setupRequired && practicePayload.setupHint) {
          setTaxonomyError(practicePayload.setupHint);
        }

        if (!kappaResponse.ok) {
          if (!kappaPayload.setupRequired) {
            throw new Error(kappaPayload.error ?? "Unable to load kappa summary.");
          }
        } else {
          const nextKappaMap: Record<string, KappaTechnique> = {};
          (kappaPayload.byTechnique ?? []).forEach((result) => {
            nextKappaMap[result.techId] = result;
          });
          setKappaByTechnique(nextKappaMap);
        }

        if (!boundaryResponse.ok) {
          if (!boundaryPayload.setupRequired) {
            throw new Error(boundaryPayload.error ?? "Unable to load boundary examples.");
          }
        } else {
          const grouped: Record<string, BoundaryExample[]> = {};
          (boundaryPayload.examples ?? []).forEach((example) => {
            if (!grouped[example.tech_id]) {
              grouped[example.tech_id] = [];
            }
            grouped[example.tech_id].push(example);
          });

          setBoundaryExamplesByTechnique(grouped);
        }
      } catch (err) {
        setTaxonomyError(err instanceof Error ? err.message : "Unable to load taxonomy practice notes.");
      }
    })();
  }, [projectId]);

  const activeTechnique = useMemo(() => {
    if (!activeTechniqueId) return null;
    return TAXONOMY.find((technique) => technique.id === activeTechniqueId) ?? null;
  }, [activeTechniqueId]);

  const techniquesByLevel = useMemo(() => groupTechniquesByLevel(TAXONOMY), []);

  useEffect(() => {
    if (!activeTechniqueId) {
      setPracticeNoteDraft("");
      return;
    }

    setPracticeNoteDraft(practiceNotes[activeTechniqueId]?.practiceNote ?? "");
  }, [activeTechniqueId, practiceNotes]);

  const savePracticeNote = async () => {
    if (!projectId || !activeTechniqueId) return;

    setIsSavingPracticeNote(true);
    setTaxonomyError(null);

    try {
      const response = await fetch("/api/taxonomy-practice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          techId: activeTechniqueId,
          practiceNote: practiceNoteDraft,
        }),
      });

      const payload = await parseResponseJson<PracticeNotePatchResponse>(response, {});
      const savedNote = payload.note;
      if (!response.ok || !savedNote) {
        throw new Error(payload.error ?? "Unable to save practice guidance.");
      }

      setPracticeNotes((current) => ({
        ...current,
        [savedNote.techId]: {
          practiceNote: savedNote.practiceNote,
          updatedAt: savedNote.updatedAt,
        },
      }));
    } catch (err) {
      setTaxonomyError(err instanceof Error ? err.message : "Unable to save practice guidance.");
    } finally {
      setIsSavingPracticeNote(false);
    }
  };

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

  const tooltipForTechnique = (techniqueId: string, defaultDefinition: string) => {
    const boundaryExamples = boundaryExamplesByTechnique[techniqueId] ?? [];
    const boundaryLines = boundaryExamples
      .slice(0, 2)
      .map((example) =>
        example.explanation
          ? `${example.quoted_text} (${example.explanation})`
          : example.quoted_text,
      );

    if (boundaryLines.length === 0) {
      return `Definition: ${defaultDefinition}`;
    }

    return `Definition: ${defaultDefinition}\nBoundary rules: ${boundaryLines.join(" | ")}`;
  };

  return (
    <div className="h-full space-y-4 p-4">
      {canUseAISuggestions && (
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
          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 p-3">
        <h3 className="text-sm font-semibold">Taxonomy</h3>
        <p className="mt-1 text-[11px] text-gray-600">
          Codes are grouped by level to make the taxonomy structure explicit.
        </p>

        <div className="mt-2 space-y-2">
          {([1, 2, 3] as const).map((level) => (
            <div key={`taxonomy-level-${level}`} className="rounded-md border border-gray-200 p-2">
              <p className="mb-2 flex items-center justify-between text-[11px] font-semibold text-gray-700">
                <span>
                  {TAXONOMY_LEVEL_LABELS[level]} - {TAXONOMY_LEVEL_DESCRIPTIONS[level]}
                </span>
                <span className="text-gray-500">{techniquesByLevel[level].length} codes</span>
              </p>

              <ul className="space-y-2">
                {techniquesByLevel[level].map((technique) => (
                  <li
                    key={technique.id}
                    className={`rounded-md border p-2 ${TAXONOMY_LEVEL_ROW_CLASSES[technique.level]}`}
                  >
                    <button
                      className="w-full cursor-pointer text-left"
                      onClick={() => {
                        setActiveTechniqueId((current) => (current === technique.id ? null : technique.id));
                        setTaxonomyError(null);
                      }}
                      title={tooltipForTechnique(technique.id, technique.definition)}
                      type="button"
                    >
                      <p className="flex items-center gap-2 text-xs font-semibold">
                        <span className="font-mono text-[11px]">{technique.id}</span>
                        <span>{technique.name}</span>
                        {kappaByTechnique[technique.id]?.status === "LOCKED" && (
                          <span className="text-[10px] text-green-700">stable</span>
                        )}
                        {kappaByTechnique[technique.id]?.status === "UNDER REVISION" && (
                          <span className="text-[10px] text-amber-700">revise</span>
                        )}
                      </p>
                    </button>
                    {kappaByTechnique[technique.id] && (
                      <div className="mt-1">
                        <TechniqueStatusBadge
                          status={kappaByTechnique[technique.id].status}
                          kappa={kappaByTechnique[technique.id].kappa}
                        />
                      </div>
                    )}
                    <p className="text-xs text-gray-600">{technique.plainName}</p>

                    {activeTechniqueId === technique.id && activeTechnique && (
                      <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-900">
                        <p className="font-semibold">What this means in practice</p>
                        <p className="mt-1">
                          {TAXONOMY_LEVEL_LABELS[activeTechnique.level]} - {TAXONOMY_LEVEL_DESCRIPTIONS[activeTechnique.level]}
                        </p>
                        <p className="mt-1">{activeTechnique.userLabel}</p>
                        <p className="mt-1 text-sky-800">{activeTechnique.definition}</p>
                        {kappaByTechnique[technique.id]?.note && (
                          <p className="mt-1 rounded bg-white px-2 py-1 text-amber-800">
                            Note: {kappaByTechnique[technique.id].note}
                          </p>
                        )}
                        {practiceNotes[technique.id]?.practiceNote && (
                          <p className="mt-1 rounded bg-white px-2 py-1 text-sky-900">
                            Project guidance: {practiceNotes[technique.id].practiceNote}
                          </p>
                        )}
                        {(boundaryExamplesByTechnique[technique.id] ?? []).length > 0 && (
                          <div className="mt-1 rounded bg-white px-2 py-1 text-sky-900">
                            <p className="font-semibold">Latest boundary examples</p>
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                              {(boundaryExamplesByTechnique[technique.id] ?? []).slice(0, 2).map((example) => (
                                <li key={example.id}>
                                  "{example.quoted_text}"
                                  {example.explanation ? ` - ${example.explanation}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {effectiveCanEditPractice && (
                          <div className="mt-2 space-y-2">
                            <textarea
                              className="min-h-20 w-full rounded border border-sky-300 bg-white px-2 py-1 text-[11px]"
                              onChange={(event) => setPracticeNoteDraft(event.target.value)}
                              placeholder="Add practical interpretation for this project..."
                              value={practiceNoteDraft}
                            />
                            <button
                              className="rounded border border-sky-700 bg-sky-700 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                              disabled={isSavingPracticeNote}
                              onClick={() => void savePracticeNote()}
                              type="button"
                            >
                              {isSavingPracticeNote ? "Saving..." : "Save guidance"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {taxonomyError && <p className="mt-2 text-xs text-red-700">{taxonomyError}</p>}
      </div>

      {canUseAISuggestions && (
        <p className="text-xs text-gray-500">Suggestions are available in the separate AI drawer.</p>
      )}
    </div>
  );
}
