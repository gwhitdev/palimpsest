"use client";

import { useEffect, useState } from "react";
import { TAXONOMY } from "@/lib/taxonomy";
import { Annotation } from "@/lib/types";

type Props = {
  annotation: Annotation | null;
  canEdit: boolean;
  onClose: () => void;
  onSave: (annotationId: string, techId: string) => Promise<void>;
  onDelete: (annotationId: string) => Promise<void>;
};

export default function AnnotationEditorModal({
  annotation,
  canEdit,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [techId, setTechId] = useState("");
  const [busyAction, setBusyAction] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!annotation) {
      setTechId("");
      setError(null);
      setBusyAction(null);
      return;
    }

    setTechId(annotation.tech_id);
    setError(null);
    setBusyAction(null);
  }, [annotation]);

  if (!annotation) return null;

  const handleSave = async () => {
    if (!canEdit || !techId.trim()) return;

    setBusyAction("save");
    setError(null);

    try {
      await onSave(annotation.id, techId.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update annotation.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!canEdit) return;

    setBusyAction("delete");
    setError(null);

    try {
      await onDelete(annotation.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete annotation.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Annotation Editor</h3>
            <p className="mt-1 text-xs text-gray-600">
              {annotation.coder_name} - {new Date(annotation.created_at).toLocaleString()}
            </p>
          </div>
          <button
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
          <p>
            <span className="font-semibold">Offsets:</span> {annotation.start_offset} to {annotation.end_offset}
          </p>
          <p className="mt-1 line-clamp-3">
            <span className="font-semibold">Quote:</span> "{annotation.quoted_text}"
          </p>
        </div>

        <div className="mt-3">
          <label className="text-xs font-semibold text-gray-800" htmlFor="annotation-technique-select">
            Technique
          </label>
          <select
            id="annotation-technique-select"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
            disabled={!canEdit || busyAction !== null}
            onChange={(event) => setTechId(event.target.value)}
            value={techId}
          >
            {TAXONOMY.map((technique) => (
              <option key={technique.id} value={technique.id}>
                (L{technique.level}) {technique.id} - {technique.name}
              </option>
            ))}
          </select>
        </div>

        {!canEdit && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-900">
            You can only edit or delete your own annotations unless you are the project owner.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-800">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            className="rounded border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 disabled:opacity-50"
            disabled={!canEdit || busyAction !== null}
            onClick={() => void handleDelete()}
            type="button"
          >
            {busyAction === "delete" ? "Deleting..." : "Delete Annotation"}
          </button>
          <button
            className="rounded border border-gray-900 bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            disabled={!canEdit || busyAction !== null || !techId.trim()}
            onClick={() => void handleSave()}
            type="button"
          >
            {busyAction === "save" ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
