"use client";

import { useEffect, useMemo, useState } from "react";
import FrequencyChart from "@/components/stats/FrequencyChart";
import KappaDisplay from "@/components/stats/KappaDisplay";
import { parseResponseJson } from "@/lib/http";
import { fleissKappa } from "@/lib/kappa";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";
import { Annotation } from "@/lib/types";

export default function StatsPage() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    const preferredProjectId = getActiveProjectId();

    (async () => {
      try {
        const projectResponse = await fetch(withProjectQuery("/api/projects", preferredProjectId));
        const projectData = await parseResponseJson<{ currentProjectId?: string }>(projectResponse, {});

        const resolvedProjectId = projectData.currentProjectId ?? null;
        setProjectId(resolvedProjectId);
        if (resolvedProjectId) {
          setActiveProjectId(resolvedProjectId);
        }

        const annotationsResponse = await fetch(withProjectQuery("/api/annotate?docId=all", resolvedProjectId));
        const data = await parseResponseJson<{ annotations?: Annotation[] }>(annotationsResponse, {});
        setAnnotations(data.annotations ?? []);
      } catch {
        setAnnotations([]);
      }
    })();
  }, []);

  const kappa = useMemo(() => fleissKappa(annotations), [annotations]);

  const frequency = useMemo(() => {
    const map = new Map<string, number>();
    annotations.forEach((annotation) => {
      map.set(annotation.tech_id, (map.get(annotation.tech_id) ?? 0) + 1);
    });

    return [...map.entries()]
      .map(([techId, count]) => ({ techId, count }))
      .sort((a, b) => b.count - a.count);
  }, [annotations]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <h1 className="text-2xl font-semibold">Agreement Statistics</h1>
      <KappaDisplay kappa={kappa} />
      <FrequencyChart data={frequency} />
      <a
        className="inline-block text-sm font-medium text-gray-900 underline"
        href={withProjectQuery("/api/export", projectId)}
      >
        Export CSV
      </a>
    </main>
  );
}
