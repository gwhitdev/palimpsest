"use client";

import { useMemo } from "react";
import { Annotation } from "@/lib/types";
import { TAXONOMY } from "@/lib/taxonomy";

type Props = {
  content: string;
  annotations: Annotation[];
  onAnnotate: (techId: string, text: string, start: number, end: number) => void;
  onRemove: (id: string) => void;
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default function TextAnnotator({ content, annotations, onRemove }: Props) {
  const html = useMemo(() => {
    let rendered = escapeHtml(content);
    const sorted = [...annotations].sort((a, b) => b.start_offset - a.start_offset);

    sorted.forEach((annotation) => {
      const tech = TAXONOMY.find((item) => item.id === annotation.tech_id);
      if (!tech || !annotation.quoted_text) return;

      const levelClass = `level-${tech.level}`;
      const quoted = escapeHtml(annotation.quoted_text);
      rendered = rendered.replace(
        quoted,
        `<mark class="${levelClass}" data-id="${annotation.id}" title="${escapeHtml(`${tech.name}: ${tech.plainName}`)}">${quoted}<button type="button" class="ann-tag" data-remove-id="${annotation.id}">${annotation.tech_id} x</button></mark>`,
      );
    });

    return rendered;
  }, [annotations, content]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const removeId = target.dataset.removeId;
    if (removeId) {
      event.preventDefault();
      onRemove(removeId);
    }
  };

  return (
    <div
      className="text-display cursor-text select-text text-base leading-relaxed"
      onClick={handleClick}
      // Rendering annotations inline within prose requires controlled HTML output.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
