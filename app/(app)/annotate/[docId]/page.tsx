"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AISuggestionsDrawer from "@/components/annotation/AISuggestionsDrawer";
import AnnotationList from "@/components/annotation/AnnotationList";
import SelectionPopup from "@/components/annotation/SelectionPopup";
import TechniquePanel from "@/components/annotation/TechniquePanel";
import TextAnnotator from "@/components/annotation/TextAnnotator";
import { parseResponseJson } from "@/lib/http";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";
import { createClient } from "@/lib/supabase/client";
import { Annotation, Document } from "@/lib/types";
import { useAnnotationStore } from "@/store/annotationStore";

type SelectionState = {
  text: string;
  position: { x: number; y: number };
  start: number;
  end: number;
};

export default function AnnotatePage() {
  const { docId } = useParams<{ docId: string }>();
  const [document, setDocument] = useState<Document | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [coderName, setCoderName] = useState("Coder");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    annotations,
    addAnnotation,
    removeAnnotation,
    setAnnotations,
    setHoveredAnnotationId,
    setSuggestionContext,
  } = useAnnotationStore();
  const supabase = createClient();

  useEffect(() => {
    const queryProjectId =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId");
    const preferredProjectId = queryProjectId || getActiveProjectId();
    const url = withProjectQuery("/api/projects", preferredProjectId);

    (async () => {
      try {
        const response = await fetch(url);
        const payload = await parseResponseJson<{ error?: string; currentProjectId?: string }>(response, {});

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to resolve project context.");
        }

        if (!payload.currentProjectId) {
          throw new Error("No active project found.");
        }

        setProjectId(payload.currentProjectId);
        setActiveProjectId(payload.currentProjectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to resolve project context.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!docId || !projectId) return;

    supabase
      .from("documents")
      .select("id, title, source, content, created_at")
      .eq("id", docId)
      .eq("project_id", projectId)
      .single()
      .then(({ data, error: documentError }) => {
        if (documentError) {
          setError(documentError.message);
          setDocument(null);
          return;
        }

        setDocument((data as Document | null) ?? null);
      });

    (async () => {
      try {
        const response = await fetch(withProjectQuery(`/api/annotate?docId=${docId}`, projectId));
        const data = await parseResponseJson<{ annotations?: Annotation[]; error?: string }>(response, {});

        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load annotations.");
        }

        setAnnotations(data.annotations ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load annotations.");
      }
    })();

    supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) return;

      const fallbackName = user.email?.split("@")[0] ?? "Coder";
      const { data: coder } = await supabase
        .from("coders")
        .select("display_name")
        .eq("id", user.id)
        .single();

      setCoderName(coder?.display_name ?? fallbackName);
    });
  }, [docId, projectId, setAnnotations, supabase]);

  useEffect(() => {
    if (!docId || !projectId) return;

    setSuggestionContext(`${projectId}:${docId}`);
    setHoveredAnnotationId(null);

    return () => {
      setHoveredAnnotationId(null);
    };
  }, [docId, projectId, setHoveredAnnotationId, setSuggestionContext]);

  useEffect(() => {
    if (!docId || !projectId) return;

    const channel = supabase
      .channel(`annotations-${projectId}-${docId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "annotations",
          filter: `document_id=eq.${docId}`,
        },
        ({ new: row }) => addAnnotation(row as Annotation),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "annotations",
          filter: `document_id=eq.${docId}`,
        },
        ({ old: row }) => removeAnnotation((row as { id: string }).id),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addAnnotation, docId, projectId, removeAnnotation, supabase]);

  const handleSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !document) return;

    const text = sel.toString().trim();
    if (text.length < 3) return;

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const start = document.content.indexOf(text);
    const end = start === -1 ? -1 : start + text.length;

    setSelection({
      text,
      position: { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 8 },
      start,
      end,
    });
  };

  const handleAnnotate = async (techId: string) => {
    if (!selection || !docId || !projectId) return;

    await fetch("/api/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        document_id: docId,
        tech_id: techId,
        quoted_text: selection.text,
        coder_name: coderName,
        is_ai: false,
        accepted: true,
        start_offset: selection.start,
        end_offset: selection.end,
      }),
    });

    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleRemove = async (id: string) => {
    if (!projectId) return;

    const annotationToRestore = annotations.find((annotation) => annotation.id === id);
    removeAnnotation(id);

    try {
      const response = await fetch("/api/annotate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, projectId }),
      });

      const payload = await parseResponseJson<{ error?: string }>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to remove annotation.");
      }
    } catch (err) {
      if (annotationToRestore) {
        addAnnotation(annotationToRestore);
      }
      setError(err instanceof Error ? err.message : "Failed to remove annotation.");
    }
  };

  const handleAcceptSuggestion = async (suggestion: { techId: string; text: string }) => {
    if (!projectId || !docId || !document) {
      throw new Error("Document context is not ready.");
    }

    const quotedText = suggestion.text.trim();
    if (!quotedText) {
      throw new Error("Suggestion text is empty.");
    }

    const start = document.content.indexOf(quotedText);
    if (start === -1) {
      throw new Error("Suggested quote was not found in the document. Please annotate it manually.");
    }

    const end = start + quotedText.length;
    const response = await fetch("/api/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        document_id: docId,
        tech_id: suggestion.techId,
        quoted_text: quotedText,
        coder_name: coderName,
        is_ai: true,
        accepted: true,
        start_offset: start,
        end_offset: end,
      }),
    });

    const payload = await parseResponseJson<{ error?: string }>(response, {});
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to save accepted suggestion.");
    }
  };

  return (
    <div className="relative grid h-[calc(100vh-65px)] grid-cols-[280px_1fr_320px] overflow-hidden">
      <aside className="overflow-y-auto border-r p-4">
        <AnnotationList annotations={annotations} />
      </aside>

      <main className="overflow-y-auto p-6" onMouseUp={handleSelection}>
        {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {document ? (
          <TextAnnotator
            content={document.content}
            annotations={annotations}
            onAnnotate={() => undefined}
            onRemove={handleRemove}
          />
        ) : (
          <p className="text-sm text-gray-600">Loading document...</p>
        )}

        <SelectionPopup
          position={selection?.position ?? null}
          selectedText={selection?.text ?? ""}
          onSelect={handleAnnotate}
          onDismiss={() => setSelection(null)}
        />
      </main>

      <aside className="overflow-y-auto border-l">
        <TechniquePanel docId={docId} docContent={document?.content} projectId={projectId} />
      </aside>

      <AISuggestionsDrawer onAcceptSuggestion={handleAcceptSuggestion} />
    </div>
  );
}
