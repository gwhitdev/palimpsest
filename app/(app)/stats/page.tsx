"use client";

import { useEffect, useMemo, useState } from "react";
import FrequencyChart from "@/components/stats/FrequencyChart";
import KappaDisplay from "@/components/stats/KappaDisplay";
import { parseResponseJson } from "@/lib/http";
import { fleissKappa } from "@/lib/kappa";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";
import { Annotation } from "@/lib/types";

type ProjectRole = "owner" | "coder";

type ProjectSummary = {
  id: string;
  name: string;
  role: ProjectRole;
  created_at: string;
};

type ProjectApiResponse = {
  currentProjectId?: string;
  projects?: ProjectSummary[];
  error?: string;
};

type StatsVisibilityResponse = {
  statsVisibleToCoders?: boolean;
  canViewStats?: boolean;
  canManageStatsVisibility?: boolean;
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type StatsApiResponse = {
  annotations?: Annotation[];
  error?: string;
};

const SOFT_MIN_SAMPLE = {
  minRaters: 2,
  preferredRaters: 3,
  minAnnotations: 50,
  preferredAnnotations: 100,
  minDocuments: 2,
  minPerCategory: 5,
} as const;

export default function StatsPage() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [canViewStats, setCanViewStats] = useState(false);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatsForProject = async (targetProjectId: string) => {
    const visibilityResponse = await fetch(withProjectQuery("/api/projects/stats-visibility", targetProjectId), {
      cache: "no-store",
    });
    const visibilityPayload = await parseResponseJson<StatsVisibilityResponse>(visibilityResponse, {});

    if (!visibilityResponse.ok) {
      throw new Error(visibilityPayload.error ?? "Failed to load stats visibility settings.");
    }

    setSetupHint(visibilityPayload.setupRequired ? visibilityPayload.setupHint ?? null : null);

    const allowed = Boolean(visibilityPayload.canViewStats);
    setCanViewStats(allowed);

    if (!allowed) {
      setAnnotations([]);
      return;
    }

    const statsResponse = await fetch(withProjectQuery("/api/stats", targetProjectId), {
      cache: "no-store",
    });
    const statsPayload = await parseResponseJson<StatsApiResponse>(statsResponse, {});

    if (!statsResponse.ok) {
      throw new Error(statsPayload.error ?? "Failed to load project stats.");
    }

    setAnnotations(statsPayload.annotations ?? []);
  };

  useEffect(() => {
    const queryProjectId =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId");
    const preferredProjectId = queryProjectId ?? getActiveProjectId();

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const projectResponse = await fetch(withProjectQuery("/api/projects", preferredProjectId));
        const projectData = await parseResponseJson<ProjectApiResponse>(projectResponse, {});

        if (!projectResponse.ok) {
          throw new Error(projectData.error ?? "Unable to resolve project context.");
        }

        setProjects(projectData.projects ?? []);

        const resolvedProjectId = projectData.currentProjectId ?? null;
        setProjectId(resolvedProjectId);
        if (resolvedProjectId) {
          setActiveProjectId(resolvedProjectId);
          await loadStatsForProject(resolvedProjectId);
        } else {
          setCanViewStats(false);
          setAnnotations([]);
        }

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load project stats.");
        setCanViewStats(false);
        setAnnotations([]);
        setLoading(false);
      }
    })();
  }, []);

  const handleProjectChange = async (nextProjectId: string) => {
    setProjectId(nextProjectId);
    setActiveProjectId(nextProjectId);
    setLoading(true);
    setError(null);

    try {
      await loadStatsForProject(nextProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project stats.");
      setAnnotations([]);
      setCanViewStats(false);
    } finally {
      setLoading(false);
    }
  };

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

  const sampleQuality = useMemo(() => {
    const raterCount = new Set(annotations.map((annotation) => annotation.coder_id)).size;
    const documentCount = new Set(annotations.map((annotation) => annotation.document_id)).size;
    const annotationCount = annotations.length;

    const lowSupportCategories = frequency
      .filter((entry) => entry.count < SOFT_MIN_SAMPLE.minPerCategory)
      .map((entry) => entry.techId);

    const warnings: string[] = [];

    if (raterCount < SOFT_MIN_SAMPLE.minRaters) {
      warnings.push(
        `Only ${raterCount} rater is represented. Agreement metrics are unstable below ${SOFT_MIN_SAMPLE.minRaters} raters.`,
      );
    } else if (raterCount < SOFT_MIN_SAMPLE.preferredRaters) {
      warnings.push(
        `${raterCount} raters found. Reliability improves with ${SOFT_MIN_SAMPLE.preferredRaters}+ raters.`,
      );
    }

    if (annotationCount < SOFT_MIN_SAMPLE.minAnnotations) {
      warnings.push(
        `${annotationCount} total annotations is below the soft minimum of ${SOFT_MIN_SAMPLE.minAnnotations}.`,
      );
    } else if (annotationCount < SOFT_MIN_SAMPLE.preferredAnnotations) {
      warnings.push(
        `${annotationCount} annotations loaded; target ${SOFT_MIN_SAMPLE.preferredAnnotations}+ for steadier kappa estimates.`,
      );
    }

    if (documentCount < SOFT_MIN_SAMPLE.minDocuments) {
      warnings.push(
        `${documentCount} document contributes data. Use at least ${SOFT_MIN_SAMPLE.minDocuments} documents to reduce document-specific bias.`,
      );
    }

    if (lowSupportCategories.length > 0) {
      warnings.push(
        `Low-frequency technique labels (<${SOFT_MIN_SAMPLE.minPerCategory} examples): ${lowSupportCategories.join(", ")}.`,
      );
    }

    return {
      raterCount,
      documentCount,
      annotationCount,
      warnings,
      shouldWarn: warnings.length > 0,
    };
  }, [annotations, frequency]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <h1 className="text-2xl font-semibold">Project Statistics</h1>

      {projects.length > 0 && (
        <div className="max-w-md">
          <label className="text-xs font-medium text-gray-700" htmlFor="stats-project-select">
            Select project
          </label>
          <select
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            id="stats-project-select"
            onChange={(event) => void handleProjectChange(event.target.value)}
            value={projectId ?? ""}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} ({project.role})
              </option>
            ))}
          </select>
        </div>
      )}

      {setupHint && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {setupHint}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {loading && <p className="text-sm text-gray-600">Loading stats...</p>}

      {!loading && !projectId && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          No active project selected.
        </p>
      )}

      {!loading && projectId && !canViewStats && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Project stats are hidden from coders by the project owner.
        </p>
      )}

      {!loading && projectId && canViewStats && (
        <>
          {sampleQuality.shouldWarn && (
            <section className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p className="font-semibold">Soft minimum-sample warning</p>
              <p className="mt-1 text-xs">
                Current sample: {sampleQuality.raterCount} raters, {sampleQuality.documentCount} documents, {sampleQuality.annotationCount} annotations.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {sampleQuality.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          )}

          <KappaDisplay kappa={kappa} />
          <FrequencyChart data={frequency} />
          <a
            className="inline-block text-sm font-medium text-gray-900 underline"
            href={withProjectQuery("/api/export", projectId)}
          >
            Export CSV
          </a>
        </>
      )}
    </main>
  );
}
