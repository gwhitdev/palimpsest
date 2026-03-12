"use client";

import { Annotation } from "@/lib/types";
import { TAXONOMY } from "@/lib/taxonomy";

type Props = {
  annotations: Annotation[];
};

export default function AnnotationList({ annotations }: Props) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Annotations ({annotations.length})</h2>
      <ul className="space-y-2">
        {annotations.map((annotation) => {
          const technique = TAXONOMY.find((item) => item.id === annotation.tech_id);
          return (
            <li key={annotation.id} className="rounded-md border border-gray-200 p-2">
              <p className="text-xs font-semibold">{annotation.tech_id} {technique ? `- ${technique.name}` : ""}</p>
              <p className="line-clamp-3 text-xs text-gray-600">{annotation.quoted_text}</p>
              <p className="mt-1 text-[11px] text-gray-500">{annotation.coder_name}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
