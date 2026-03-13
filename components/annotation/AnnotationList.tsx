"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Annotation, AnnotationCodeChange, AnnotatorUser } from "@/lib/types";
import { TAXONOMY } from "@/lib/taxonomy";
import { useAnnotationStore } from "@/store/annotationStore";

type AnnotationViewMode = "all" | "user" | "merged";

type InterRaterOverall = {
  kappa: number | null;
  observedAgreement: number;
  expectedAgreement: number;
  interpretation: string;
};

type InterRaterPairwise = {
  raterAName: string;
  raterBName: string;
  kappa: number | null;
  observedAgreement: number;
  interpretation: string;
};

type ViewerRole = "owner" | "coder";

type ChecklistResult = {
  passed: number;
  total: number;
  items: Array<{
    key: string;
    label: string;
    isValid: boolean;
    message: string;
  }>;
};

const TAXONOMY_IDS = new Set(TAXONOMY.map((technique) => technique.id));

function buildAnnotationChecklist(annotation: Annotation, documentLength?: number): ChecklistResult {
  const startValue = annotation.start_offset;
  const endValue = annotation.end_offset;
  const startLabel = Number.isInteger(startValue) ? String(startValue) : "missing";
  const endLabel = Number.isInteger(endValue) ? String(endValue) : "missing";
  const quoteLength = annotation.quoted_text.trim().length;
  const spanLength =
    Number.isInteger(startValue) && Number.isInteger(endValue)
      ? endValue - startValue
      : null;
  const spanLengthLabel = spanLength === null ? "n/a" : String(spanLength);
  const documentLengthLabel =
    typeof documentLength === "number" ? String(documentLength) : "unknown";

  const hasTechnique = TAXONOMY_IDS.has(annotation.tech_id);
  const trimmedQuote = annotation.quoted_text.trim();
  const hasQuotedText = trimmedQuote.length > 0;
  const hasOffsets =
    Number.isInteger(annotation.start_offset) && Number.isInteger(annotation.end_offset);
  const hasValidRange =
    hasOffsets && annotation.start_offset >= 0 && annotation.end_offset > annotation.start_offset;
  const withinDocumentBounds =
    hasValidRange && typeof documentLength === "number"
      ? annotation.end_offset <= documentLength
      : hasValidRange;
  const quoteLengthMatchesSpan =
    hasValidRange && hasQuotedText
      ? annotation.end_offset - annotation.start_offset === trimmedQuote.length
      : false;

  const items: ChecklistResult["items"] = [
    {
      key: "technique",
      label: "Technique ID is valid",
      isValid: hasTechnique,
      message: hasTechnique
        ? `Technique '${annotation.tech_id}' exists in taxonomy.`
        : `Technique '${annotation.tech_id}' is not in taxonomy. Choose a valid code.`,
    },
    {
      key: "quote",
      label: "Quoted text is present",
      isValid: hasQuotedText,
      message: hasQuotedText
        ? `Quote captured (${quoteLength} chars).`
        : "Quote is empty. Recreate the annotation from a non-empty text selection.",
    },
    {
      key: "offsets",
      label: "Start/end offsets are captured",
      isValid: hasOffsets,
      message: hasOffsets
        ? `Offsets recorded: start=${startLabel}, end=${endLabel}.`
        : `Offsets missing: start=${startLabel}, end=${endLabel}. Recreate annotation to save offsets.`,
    },
    {
      key: "range",
      label: "Offset range is valid",
      isValid: hasValidRange,
      message: hasValidRange
        ? `Range is valid: start=${startLabel}, end=${endLabel}, span=${spanLengthLabel}.`
        : `Invalid range: start=${startLabel}, end=${endLabel}. End must be greater than start.`,
    },
    {
      key: "bounds",
      label: "Offsets are within document bounds",
      isValid: withinDocumentBounds,
      message: withinDocumentBounds
        ? `Within bounds: end=${endLabel}, document length=${documentLengthLabel}.`
        : `Out of bounds: end=${endLabel}, document length=${documentLengthLabel}. Recreate annotation after content updates.`,
    },
    {
      key: "length-match",
      label: "Quote length matches span length",
      isValid: quoteLengthMatchesSpan,
      message: quoteLengthMatchesSpan
        ? `Lengths match: span=${spanLengthLabel}, quote=${quoteLength}.`
        : `Length mismatch: span=${spanLengthLabel}, quote=${quoteLength}. Recreate annotation so quote and offsets align.`,
    },
  ];

  const passed = items.filter((item) => item.isValid).length;

  return {
    passed,
    total: items.length,
    items,
  };
}

type Props = {
  annotations: Annotation[];
  accessUsers: AnnotatorUser[];
  currentUserId: string | null;
  viewerRole: ViewerRole | null;
  documentLength?: number;
  restrictHistoryToCurrentUser?: boolean;
  showAnnotationFilters?: boolean;
  viewMode: AnnotationViewMode;
  selectedAnnotatorId: string;
  onChangeViewMode: (mode: AnnotationViewMode) => void;
  onChangeSelectedAnnotatorId: (id: string) => void;
  mergedAnnotationIds: Set<string>;
  canManageMergedSet: boolean;
  interRaterOverall: InterRaterOverall | null;
  interRaterPairwise: InterRaterPairwise[];
  interRaterInsufficient: boolean;
  interRaterRaterCount: number;
  interRaterInvalidAnnotationCount: number;
  interRaterHiddenReason: string | null;
  annotationChangesById: Record<string, AnnotationCodeChange[]>;
  onOpenAnnotationEditor: (annotationId: string) => void;
  onToggleMerged: (annotationId: string, keep: boolean) => Promise<void>;
};

export default function AnnotationList({
  annotations,
  accessUsers,
  currentUserId,
  viewerRole,
  documentLength,
  restrictHistoryToCurrentUser = false,
  showAnnotationFilters = true,
  viewMode,
  selectedAnnotatorId,
  onChangeViewMode,
  onChangeSelectedAnnotatorId,
  mergedAnnotationIds,
  canManageMergedSet,
  interRaterOverall,
  interRaterPairwise,
  interRaterInsufficient,
  interRaterRaterCount,
  interRaterInvalidAnnotationCount,
  interRaterHiddenReason,
  annotationChangesById,
  onOpenAnnotationEditor,
  onToggleMerged,
}: Props) {
  const { hoveredAnnotationId, setHoveredAnnotationId } = useAnnotationStore();
  const [expandedAnnotationIds, setExpandedAnnotationIds] = useState<Set<string>>(new Set());
  const previousLatestIdRef = useRef<string | null>(null);

  const annotatedUsers = useMemo(() => {
    const byId = new Map<string, AnnotatorUser>();

    annotations.forEach((annotation) => {
      byId.set(annotation.coder_id, {
        id: annotation.coder_id,
        display_name: annotation.coder_name,
      });
    });

    return [...byId.values()];
  }, [annotations]);

  const history = useMemo(() => {
    return [...annotations].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [annotations]);

  const ownHistory = useMemo(() => {
    if (!currentUserId) return [];
    return history.filter((annotation) => annotation.coder_id === currentUserId);
  }, [currentUserId, history]);

  const ownCodingValidity = useMemo(() => {
    const issues = {
      missingOffsets: 0,
      invalidRange: 0,
      outOfBounds: 0,
      emptyQuote: 0,
    };

    ownHistory.forEach((annotation) => {
      const hasStart = typeof annotation.start_offset === "number";
      const hasEnd = typeof annotation.end_offset === "number";

      if (!hasStart || !hasEnd) {
        issues.missingOffsets += 1;
      } else {
        const start = annotation.start_offset;
        const end = annotation.end_offset;

        if (start < 0 || end <= start) {
          issues.invalidRange += 1;
        }

        if (typeof documentLength === "number" && end > documentLength) {
          issues.outOfBounds += 1;
        }
      }

      if (!annotation.quoted_text?.trim()) {
        issues.emptyQuote += 1;
      }
    });

    const invalidCount =
      issues.missingOffsets + issues.invalidRange + issues.outOfBounds + issues.emptyQuote;
    const validCount = Math.max(0, ownHistory.length - invalidCount);

    const actions: string[] = [];
    if (issues.missingOffsets > 0) {
      actions.push("Recreate affected annotations by selecting text directly in the document to capture offsets.");
    }
    if (issues.invalidRange > 0) {
      actions.push("Ensure each selected span has a positive length (end offset must be greater than start offset).");
    }
    if (issues.outOfBounds > 0) {
      actions.push("Delete and recreate annotations that exceed current document length, especially after source text edits.");
    }
    if (issues.emptyQuote > 0) {
      actions.push("Avoid empty selections; highlight explicit text before assigning a technique.");
    }

    return {
      total: ownHistory.length,
      validCount,
      invalidCount,
      actions,
    };
  }, [documentLength, ownHistory]);

  const visibleHistory = useMemo(() => {
    if (restrictHistoryToCurrentUser && currentUserId) {
      return history.filter((annotation) => annotation.coder_id === currentUserId);
    }

    if (viewMode === "user" && selectedAnnotatorId !== "all") {
      return history.filter((annotation) => annotation.coder_id === selectedAnnotatorId);
    }

    if (viewMode === "merged") {
      return history.filter((annotation) => mergedAnnotationIds.has(annotation.id));
    }

    return history;
  }, [currentUserId, history, mergedAnnotationIds, restrictHistoryToCurrentUser, selectedAnnotatorId, viewMode]);

  const userOptions = useMemo(() => {
    const users = new Map<string, string>();
    annotatedUsers.forEach((user) => users.set(user.id, user.display_name));
    accessUsers.forEach((user) => {
      if (!users.has(user.id)) users.set(user.id, user.display_name);
    });
    return [...users.entries()].map(([id, display_name]) => ({ id, display_name }));
  }, [accessUsers, annotatedUsers]);

  const checklistsByAnnotationId = useMemo(() => {
    const byId = new Map<string, ChecklistResult>();
    history.forEach((annotation) => {
      byId.set(annotation.id, buildAnnotationChecklist(annotation, documentLength));
    });
    return byId;
  }, [documentLength, history]);

  useEffect(() => {
    const latestId = visibleHistory[0]?.id ?? null;
    const visibleIds = new Set(visibleHistory.map((annotation) => annotation.id));

    setExpandedAnnotationIds((current) => {
      if (!latestId) return new Set();

      // Keep existing expanded items that are still visible.
      const next = new Set([...current].filter((id) => visibleIds.has(id)));

      // If the newest item changed (new annotation or filter change), default to newest only.
      if (previousLatestIdRef.current !== latestId) {
        return new Set([latestId]);
      }

      if (next.size === 0) {
        next.add(latestId);
      }

      return next;
    });

    previousLatestIdRef.current = latestId;
  }, [visibleHistory]);

  const toggleExpanded = (annotationId: string) => {
    setExpandedAnnotationIds((current) => {
      const next = new Set(current);
      if (next.has(annotationId)) {
        next.delete(annotationId);
      } else {
        next.add(annotationId);
      }
      return next;
    });
  };

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Annotator Overview</h2>

      {viewerRole === "owner" && (
        <div className="mb-4 rounded-md border border-gray-200 p-2">
          <p className="text-xs font-semibold">Inter-rater agreement (kappa)</p>
          {interRaterHiddenReason ? (
            <p className="mt-1 text-xs text-gray-600">{interRaterHiddenReason}</p>
          ) : interRaterInsufficient ? (
            <p className="mt-1 text-xs text-gray-600">
              Need at least 2 annotators with valid span offsets for kappa scoring.
            </p>
          ) : interRaterOverall ? (
            <>
              <p className="mt-1 text-xs text-gray-700">
                Fleiss&apos; kappa: <span className="font-semibold">{interRaterOverall.kappa === null ? "N/A" : interRaterOverall.kappa.toFixed(3)}</span>
                {" "}({interRaterOverall.interpretation})
              </p>
              <p className="text-xs text-gray-700">
                Observed agreement: <span className="font-semibold">{(interRaterOverall.observedAgreement * 100).toFixed(1)}%</span>
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-gray-600">Agreement metrics are loading.</p>
          )}

          <p className="mt-1 text-[11px] text-gray-500">Raters included: {interRaterRaterCount}</p>
          {interRaterInvalidAnnotationCount > 0 && (
            <p className="text-[11px] text-amber-700">
              {interRaterInvalidAnnotationCount} annotations were skipped due to missing/invalid offsets.
            </p>
          )}

          {interRaterPairwise.length > 0 && (
            <ul className="mt-2 space-y-1">
              {interRaterPairwise.map((pair) => (
                <li key={`${pair.raterAName}:${pair.raterBName}`} className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700">
                  {pair.raterAName} vs {pair.raterBName}: {pair.kappa === null ? "N/A" : pair.kappa.toFixed(3)} ({pair.interpretation})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showAnnotationFilters && (
        <div className="mb-4 rounded-md border border-gray-200 p-2">
          <p className="text-xs font-semibold">View annotations</p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            <button
              className={`rounded px-2 py-1 text-xs font-medium ${
                viewMode === "all" ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-800"
              }`}
              onClick={() => onChangeViewMode("all")}
              type="button"
            >
              All
            </button>
            <button
              className={`rounded px-2 py-1 text-xs font-medium ${
                viewMode === "user" ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-800"
              }`}
              onClick={() => onChangeViewMode("user")}
              type="button"
            >
              By User
            </button>
            <button
              className={`rounded px-2 py-1 text-xs font-medium ${
                viewMode === "merged"
                  ? "bg-gray-900 text-white"
                  : "border border-gray-300 bg-white text-gray-800"
              }`}
              onClick={() => onChangeViewMode("merged")}
              type="button"
            >
              Merged
            </button>
          </div>

          {viewMode === "user" && (
            <select
              className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
              onChange={(event) => onChangeSelectedAnnotatorId(event.target.value)}
              value={selectedAnnotatorId}
            >
              <option value="all">All users</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mb-4 rounded-md border border-gray-200 p-2">
        <p className="text-xs font-semibold">Users who annotated this text ({annotatedUsers.length})</p>
        {annotatedUsers.length === 0 && <p className="mt-1 text-xs text-gray-600">No annotations yet.</p>}
        <ul className="mt-1 space-y-1">
          {annotatedUsers.map((user) => (
            <li key={user.id} className="text-xs text-gray-700">
              {user.display_name}
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-4 rounded-md border border-gray-200 p-2">
        <p className="text-xs font-semibold">Users with access to annotate ({accessUsers.length})</p>
        {accessUsers.length === 0 && <p className="mt-1 text-xs text-gray-600">No users currently assigned.</p>}
        <ul className="mt-1 space-y-1">
          {accessUsers.map((user) => (
            <li key={user.id} className="text-xs text-gray-700">
              {user.display_name}
              {user.role ? ` (${user.role})` : ""}
            </li>
          ))}
        </ul>
      </div>

      <h3 className="mb-2 text-sm font-semibold">Annotation History ({visibleHistory.length})</h3>
      {viewerRole === "coder" && (
        <div
          className={`mb-2 rounded-md border px-2 py-2 text-xs ${
            ownCodingValidity.invalidCount > 0
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-emerald-300 bg-emerald-50 text-emerald-900"
          }`}
        >
          <p className="font-semibold">
            Your coding validity: {ownCodingValidity.validCount}/{ownCodingValidity.total} valid
          </p>
          {ownCodingValidity.total === 0 ? (
            <p className="mt-1">Create annotations by selecting text in the document. Valid offsets are required for reliability scoring.</p>
          ) : ownCodingValidity.invalidCount > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {ownCodingValidity.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">All of your current annotations have valid spans for scoring.</p>
          )}
        </div>
      )}
      <ul className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
        {visibleHistory.map((annotation) => {
          const technique = TAXONOMY.find((item) => item.id === annotation.tech_id);
          const isMerged = mergedAnnotationIds.has(annotation.id);
          const checklist = checklistsByAnnotationId.get(annotation.id);
          const isExpanded = expandedAnnotationIds.has(annotation.id);
          const changes = annotationChangesById[annotation.id] ?? [];
          const originalTechId = changes.length > 0 ? changes[changes.length - 1].previous_tech_id : annotation.tech_id;
          const currentTechId = changes.length > 0 ? changes[0].next_tech_id : annotation.tech_id;

          return (
            <li
              key={annotation.id}
              className={`rounded-md border p-2 transition ${
                hoveredAnnotationId === annotation.id
                  ? "border-gray-900 bg-gray-50 ring-1 ring-gray-800"
                  : "border-gray-200"
              }`}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button")) return;
                onOpenAnnotationEditor(annotation.id);
              }}
              onMouseEnter={() => setHoveredAnnotationId(annotation.id)}
              onMouseLeave={() => setHoveredAnnotationId(null)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">{annotation.tech_id} {technique ? `- ${technique.name}` : ""}</p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {annotation.coder_name} - {new Date(annotation.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleExpanded(annotation.id);
                  }}
                  type="button"
                >
                  {isExpanded ? "Collapse" : "Expand"}
                </button>
              </div>

              <p className={`mt-1 text-xs text-gray-600 ${isExpanded ? "line-clamp-none" : "line-clamp-1"}`}>
                {annotation.quoted_text}
              </p>

              {isExpanded && (
                <>
                  <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-900">
                    <p className="font-semibold">Code evolution</p>
                    <p className="mt-1">
                      Was: <span className="font-semibold">{originalTechId}</span> {"->"} Now: <span className="font-semibold">{currentTechId}</span>
                    </p>
                    {changes.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {changes.map((change) => (
                          <li key={change.id}>
                            {new Date(change.changed_at).toLocaleString()} - {change.previous_tech_id} {"->"} {change.next_tech_id} ({change.changed_by_name})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-blue-700">No code changes yet.</p>
                    )}
                  </div>

                  {checklist && (
                    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2">
                      <p className="text-[11px] font-semibold text-gray-700">
                        Checklist: {checklist.passed}/{checklist.total} passed
                      </p>
                      <ul className="mt-1 space-y-1">
                        {checklist.items.map((item) => (
                          <li
                            key={`${annotation.id}-${item.key}`}
                            className={`text-[11px] ${item.isValid ? "text-emerald-800" : "text-amber-800"}`}
                          >
                            <span className="font-semibold" role="img" aria-label={item.isValid ? "Passed criterion" : "Failed criterion"}>
                              {item.isValid ? "✓" : "✗"}
                            </span>{" "}
                            {item.label}
                            <span className="text-gray-600"> - {item.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {canManageMergedSet && (
                    <div className="mt-2">
                      <button
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                          isMerged
                            ? "border-indigo-700 bg-indigo-50 text-indigo-800"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onToggleMerged(annotation.id, !isMerged);
                        }}
                        type="button"
                      >
                        {isMerged ? "Remove from merged" : "Keep in merged"}
                      </button>
                    </div>
                  )}

                  {annotation.coder_id === currentUserId && (
                    <p className="mt-1 text-[11px] text-gray-500">You can edit/delete this annotation.</p>
                  )}
                </>
              )}
            </li>
          );
        })}

        {visibleHistory.length === 0 && (
          <li className="rounded-md border border-dashed border-gray-300 p-2 text-xs text-gray-600">
            No annotations in this view yet.
          </li>
        )}
      </ul>
    </div>
  );
}
