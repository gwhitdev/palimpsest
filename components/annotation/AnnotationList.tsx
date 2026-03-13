"use client";

import { useMemo } from "react";
import { Annotation, AnnotatorUser } from "@/lib/types";
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

type Props = {
  annotations: Annotation[];
  accessUsers: AnnotatorUser[];
  currentUserId: string | null;
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
  onToggleMerged: (annotationId: string, keep: boolean) => Promise<void>;
};

export default function AnnotationList({
  annotations,
  accessUsers,
  currentUserId,
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
  onToggleMerged,
}: Props) {
  const { hoveredAnnotationId, setHoveredAnnotationId } = useAnnotationStore();

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

  const visibleHistory = useMemo(() => {
    if (viewMode === "user" && selectedAnnotatorId !== "all") {
      return history.filter((annotation) => annotation.coder_id === selectedAnnotatorId);
    }

    if (viewMode === "merged") {
      return history.filter((annotation) => mergedAnnotationIds.has(annotation.id));
    }

    return history;
  }, [history, mergedAnnotationIds, selectedAnnotatorId, viewMode]);

  const userOptions = useMemo(() => {
    const users = new Map<string, string>();
    annotatedUsers.forEach((user) => users.set(user.id, user.display_name));
    accessUsers.forEach((user) => {
      if (!users.has(user.id)) users.set(user.id, user.display_name);
    });
    return [...users.entries()].map(([id, display_name]) => ({ id, display_name }));
  }, [accessUsers, annotatedUsers]);

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Annotator Overview</h2>

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
      <ul className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
        {visibleHistory.map((annotation) => {
          const technique = TAXONOMY.find((item) => item.id === annotation.tech_id);
          const isMerged = mergedAnnotationIds.has(annotation.id);

          return (
            <li
              key={annotation.id}
              className={`rounded-md border p-2 transition ${
                hoveredAnnotationId === annotation.id
                  ? "border-gray-900 bg-gray-50 ring-1 ring-gray-800"
                  : "border-gray-200"
              }`}
              onMouseEnter={() => setHoveredAnnotationId(annotation.id)}
              onMouseLeave={() => setHoveredAnnotationId(null)}
            >
              <p className="text-xs font-semibold">{annotation.tech_id} {technique ? `- ${technique.name}` : ""}</p>
              <p className="line-clamp-3 text-xs text-gray-600">{annotation.quoted_text}</p>
              <p className="mt-1 text-[11px] text-gray-500">
                {annotation.coder_name} - {new Date(annotation.created_at).toLocaleString()}
              </p>

              {canManageMergedSet && (
                <div className="mt-2">
                  <button
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                      isMerged
                        ? "border-indigo-700 bg-indigo-50 text-indigo-800"
                        : "border-gray-300 bg-white text-gray-700"
                    }`}
                    onClick={() => void onToggleMerged(annotation.id, !isMerged)}
                    type="button"
                  >
                    {isMerged ? "Remove from merged" : "Keep in merged"}
                  </button>
                </div>
              )}

              {annotation.coder_id === currentUserId && (
                <p className="mt-1 text-[11px] text-gray-500">You can edit/delete this annotation.</p>
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
