"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AnnotationList from "@/components/annotation/AnnotationList";
import SelectionPopup from "@/components/annotation/SelectionPopup";
import TechniquePanel from "@/components/annotation/TechniquePanel";
import TextAnnotator from "@/components/annotation/TextAnnotator";
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

  const { annotations, addAnnotation, removeAnnotation, setAnnotations } = useAnnotationStore();
  const supabase = createClient();

  useEffect(() => {
    if (!docId) return;

    supabase
      .from("documents")
      .select("id, title, source, content, created_at")
      .eq("id", docId)
      .single()
      .then(({ data }) => {
        setDocument((data as Document | null) ?? null);
      });

    fetch(`/api/annotate?docId=${docId}`)
      .then((response) => response.json())
      .then((data) => {
        setAnnotations((data.annotations ?? []) as Annotation[]);
      });

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
  }, [docId, setAnnotations, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`annotations-${docId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "annotations", filter: `document_id=eq.${docId}` },
        ({ new: row }) => addAnnotation(row as Annotation),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "annotations", filter: `document_id=eq.${docId}` },
        ({ old: row }) => removeAnnotation((row as { id: string }).id),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addAnnotation, docId, removeAnnotation, supabase]);

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
    if (!selection || !docId) return;

    await fetch("/api/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
    await fetch("/api/annotate", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  return (
    <div className="grid h-[calc(100vh-65px)] grid-cols-[280px_1fr_320px] overflow-hidden">
      <aside className="overflow-y-auto border-r p-4">
        <AnnotationList annotations={annotations} />
      </aside>

      <main className="overflow-y-auto p-6" onMouseUp={handleSelection}>
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
        <TechniquePanel docId={docId} docContent={document?.content} />
      </aside>
    </div>
  );
}
