"use client";

import { useMemo } from "react";
import { Annotation } from "@/lib/types";
import { TAXONOMY } from "@/lib/taxonomy";
import { useAnnotationStore } from "@/store/annotationStore";

type Props = {
  content: string;
  annotations: Annotation[];
  onAnnotate: (techId: string, text: string, start: number, end: number) => void;
  onRemove: (id: string) => void;
  currentUserId?: string | null;
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default function TextAnnotator({ content, annotations, onRemove, currentUserId }: Props) {
  const { hoveredAnnotationId, setHoveredAnnotationId } = useAnnotationStore();

  const html = useMemo(() => {
    let rendered = escapeHtml(content);
    const sorted = [...annotations].sort((a, b) => b.start_offset - a.start_offset);

    sorted.forEach((annotation) => {
      const tech = TAXONOMY.find((item) => item.id === annotation.tech_id);
      if (!tech || !annotation.quoted_text) return;

      const levelClass = `level-${tech.level} ann-mark${hoveredAnnotationId === annotation.id ? " ann-hovered" : ""}`;
      const quoted = escapeHtml(annotation.quoted_text);
      const canRemove = Boolean(currentUserId && annotation.coder_id === currentUserId);
      const tagText = canRemove ? `${annotation.tech_id} x` : annotation.tech_id;
      const removeAttr = canRemove ? ` data-remove-id="${annotation.id}"` : "";

      rendered = rendered.replace(
        quoted,
        `<mark class="${levelClass}" data-id="${annotation.id}" title="${escapeHtml(`${tech.name}: ${tech.plainName}`)}">${quoted}<button type="button" class="ann-tag"${removeAttr}>${tagText}</button></mark>`,
      );
    });

    return rendered;
  }, [annotations, content, hoveredAnnotationId]);

  const getMarkFromTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest("mark[data-id]") as HTMLElement | null;
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const removeId = target.dataset.removeId;
    if (removeId) {
      event.preventDefault();
      onRemove(removeId);
    }
  };

  const handleMouseOver = (event: React.MouseEvent<HTMLDivElement>) => {
    const mark = getMarkFromTarget(event.target);
    const markId = mark?.dataset.id ?? null;
    if (markId && hoveredAnnotationId !== markId) {
      setHoveredAnnotationId(markId);
    }
  };

  const handleMouseOut = (event: React.MouseEvent<HTMLDivElement>) => {
    const currentMark = getMarkFromTarget(event.target);
    if (!currentMark) return;

    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && currentMark.contains(relatedTarget)) {
      return;
    }

    if (hoveredAnnotationId !== null) {
      setHoveredAnnotationId(null);
    }
  };

  return (
    <div
      className="text-display cursor-text select-text text-base leading-relaxed"
      onClick={handleClick}
      onMouseOut={handleMouseOut}
      onMouseOver={handleMouseOver}
      // Rendering annotations inline within prose requires controlled HTML output.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
