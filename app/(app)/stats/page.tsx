"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import TechniqueStatusBadge from "@/components/ui/TechniqueStatusBadge";
import { parseResponseJson } from "@/lib/http";
import { kappaColourClass } from "@/lib/kappa";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";
import { TAXONOMY } from "@/lib/taxonomy";
import { TAXONOMY_LEVEL_LABELS } from "@/lib/taxonomyLevels";

type ProjectRole = "owner" | "coder";

type ProjectSummary = {
  id: string;
  name: string;
  role: ProjectRole;
  status?: "active" | "closed" | "archived";
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
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type KappaTechniqueRow = {
  techId: string;
  kappa: number;
  label: string;
  colour: "red" | "amber" | "green";
  action: string;
  coderCount: number;
  docCount: number;
  status: "DRAFT" | "UNDER REVISION" | "LOCKED";
  disagreements: number;
  note?: string;
};

type RoundHistoryEntry = {
  id: string;
  roundNumber: number;
  status: "active" | "complete" | "archived";
  notes: string | null;
  createdAt: string;
  overall: number | null;
  byTechnique: Array<{
    techId: string;
    kappa: number | null;
    status: "DRAFT" | "UNDER REVISION" | "LOCKED";
    calculatedAt: string;
  }>;
};

type KappaApiResponse = {
  overall?: number;
  byTechnique?: KappaTechniqueRow[];
  roundId?: string;
  calculatedAt?: string;
  roundHistory?: RoundHistoryEntry[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type DisagreementRow = {
  documentId: string;
  documentTitle: string;
  quotedText: string;
  startOffset: number | null;
  endOffset: number | null;
  coderViews: Array<{
    coderId: string;
    coderName: string;
    applied: boolean;
    quotes: Array<{
      quotedText: string;
      startOffset: number | null;
      endOffset: number | null;
    }>;
  }>;
};

type DisagreementResponse = {
  disagreements?: DisagreementRow[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

export default function StatsPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [kappaSummary, setKappaSummary] = useState<KappaApiResponse | null>(null);
  const [expandedTechId, setExpandedTechId] = useState<string | null>(null);
  const [loadingDisagreementsFor, setLoadingDisagreementsFor] = useState<string | null>(null);
  const [disagreementByTechId, setDisagreementByTechId] = useState<Record<string, DisagreementRow[]>>({});
  const [savingBoundaryFor, setSavingBoundaryFor] = useState<string | null>(null);
  const [canViewStats, setCanViewStats] = useState(false);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortAscending, setSortAscending] = useState(true);

  const techniqueById = useMemo(
    () =>
      new Map(
        TAXONOMY.map((technique) => [technique.id, technique]),
      ),
    [],
  );

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
      setKappaSummary(null);
      return;
    }

    const statsResponse = await fetch(withProjectQuery("/api/kappa", targetProjectId), {
      cache: "no-store",
    });
    const statsPayload = await parseResponseJson<KappaApiResponse>(statsResponse, {});

    if (!statsResponse.ok) {
      throw new Error(statsPayload.error ?? "Failed to load project kappa summary.");
    }

    setKappaSummary(statsPayload);
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
          setKappaSummary(null);
        }

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load project stats.");
        setCanViewStats(false);
        setKappaSummary(null);
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
      setKappaSummary(null);
      setCanViewStats(false);
    } finally {
      setLoading(false);
    }
  };

  const sortedTechniques = useMemo(() => {
    const rows = [...(kappaSummary?.byTechnique ?? [])];
    rows.sort((a, b) => (sortAscending ? a.kappa - b.kappa : b.kappa - a.kappa));
    return rows;
  }, [kappaSummary, sortAscending]);

  const passingCount = useMemo(
    () => sortedTechniques.filter((row) => row.kappa >= 0.7).length,
    [sortedTechniques],
  );

  const needsRevisionCount = useMemo(
    () => sortedTechniques.filter((row) => row.kappa < 0.7).length,
    [sortedTechniques],
  );

  const roundHistory = kappaSummary?.roundHistory ?? [];

  const loadDisagreements = async (techId: string) => {
    if (!projectId) return;
    if (disagreementByTechId[techId]) return;

    setLoadingDisagreementsFor(techId);
    setError(null);

    try {
      const response = await fetch(
        withProjectQuery(`/api/kappa/disagreements?techId=${encodeURIComponent(techId)}`, projectId),
      );
      const payload = await parseResponseJson<DisagreementResponse>(response, {});

      if (!response.ok) {
        throw new Error(payload.error ?? payload.setupHint ?? "Failed to load disagreement details.");
      }

      setDisagreementByTechId((current) => ({
        ...current,
        [techId]: payload.disagreements ?? [],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load disagreement details.");
    } finally {
      setLoadingDisagreementsFor(null);
    }
  };

  const handleToggleTechnique = async (techId: string, kappa: number) => {
    if (kappa >= 0.7) return;

    if (expandedTechId === techId) {
      setExpandedTechId(null);
      return;
    }

    setExpandedTechId(techId);
    await loadDisagreements(techId);
  };

  const saveBoundaryExample = async (techId: string, disagreement: DisagreementRow) => {
    if (!projectId) return;

    const explanation = window.prompt("Optional explanation for this boundary example:", "") ?? "";
    const key = `${techId}:${disagreement.documentId}:${disagreement.startOffset ?? "x"}:${disagreement.endOffset ?? "x"}`;

    setSavingBoundaryFor(key);
    setError(null);

    try {
      const response = await fetch("/api/boundary-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          techId,
          quotedText: disagreement.quotedText,
          explanation: explanation.trim() || `Captured from disagreement in ${disagreement.documentTitle}`,
        }),
      });

      const payload = await parseResponseJson<{ error?: string; setupHint?: string }>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? payload.setupHint ?? "Failed to save boundary example.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save boundary example.");
    } finally {
      setSavingBoundaryFor(null);
    }
  };

  const sparklinePath = (values: Array<number | null>) => {
    const usable = values.map((value) => (typeof value === "number" ? value : null));
    const max = 1;
    const width = 120;
    const height = 30;

    const points = usable
      .map((value, index) => {
        if (value === null) return null;
        const x = usable.length <= 1 ? 0 : (index / (usable.length - 1)) * width;
        const y = height - (Math.max(0, Math.min(max, value)) / max) * height;
        return `${x},${y}`;
      })
      .filter((point): point is string => Boolean(point));

    return points.join(" ");
  };

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
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium text-gray-600">Overall kappa</p>
              <p className="mt-2 text-2xl font-semibold">{(kappaSummary?.overall ?? 0).toFixed(3)}</p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-xs font-medium text-green-700">Techniques passing (k &gt;= 0.70)</p>
              <p className="mt-2 text-2xl font-semibold text-green-800">{passingCount}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-medium text-amber-700">Techniques needing revision</p>
              <p className="mt-2 text-2xl font-semibold text-amber-800">{needsRevisionCount}</p>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Per-technique kappa</h2>
              <button
                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700"
                onClick={() => setSortAscending((current) => !current)}
                type="button"
              >
                Sort by kappa {sortAscending ? "asc" : "desc"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2 text-xs">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="px-2 py-1">ID</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Level</th>
                    <th className="px-2 py-1">k</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Interpretation</th>
                    <th className="px-2 py-1">Action</th>
                    <th className="px-2 py-1">Disagreements</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTechniques.map((row) => {
                    const technique = techniqueById.get(row.techId);
                    const isExpandable = row.kappa < 0.7;
                    const isExpanded = expandedTechId === row.techId;

                    return (
                      <Fragment key={row.techId}>
                        <tr
                          className={`${isExpandable ? "cursor-pointer" : ""} rounded-md border ${kappaColourClass(row.colour)}`}
                          onClick={() => void handleToggleTechnique(row.techId, row.kappa)}
                        >
                          <td className="rounded-l-md border border-r-0 px-2 py-2 font-mono">{row.techId}</td>
                          <td className="border border-x-0 px-2 py-2">{technique?.name ?? row.techId}</td>
                          <td className="border border-x-0 px-2 py-2">
                            {technique ? `L${technique.level} (${TAXONOMY_LEVEL_LABELS[technique.level]})` : "-"}
                          </td>
                          <td className="border border-x-0 px-2 py-2 font-semibold">{row.kappa.toFixed(2)}</td>
                          <td className="border border-x-0 px-2 py-2">
                            <TechniqueStatusBadge status={row.status} kappa={row.kappa} />
                          </td>
                          <td className="border border-x-0 px-2 py-2">{row.label}</td>
                          <td className="border border-x-0 px-2 py-2">{row.action}</td>
                          <td className="rounded-r-md border border-l-0 px-2 py-2">{row.disagreements}</td>
                        </tr>

                        {isExpanded && (
                          <tr key={`${row.techId}-details`}>
                            <td className="px-1 pt-1" colSpan={8}>
                              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                                <p className="text-xs font-semibold text-gray-800">Disagreement drill-down</p>
                                {loadingDisagreementsFor === row.techId && (
                                  <p className="mt-2 text-xs text-gray-600">Loading disagreement examples...</p>
                                )}

                                {(disagreementByTechId[row.techId] ?? []).length === 0 && loadingDisagreementsFor !== row.techId && (
                                  <p className="mt-2 text-xs text-gray-600">No disagreement examples found for this technique in the current scope.</p>
                                )}

                                <div className="mt-2 space-y-2">
                                  {(disagreementByTechId[row.techId] ?? []).map((disagreement) => {
                                    const saveKey = `${row.techId}:${disagreement.documentId}:${disagreement.startOffset ?? "x"}:${disagreement.endOffset ?? "x"}`;
                                    return (
                                      <div key={saveKey} className="rounded border border-gray-200 bg-white p-2">
                                        <p className="text-xs font-semibold text-gray-800">{disagreement.documentTitle}</p>
                                        <p className="mt-1 text-xs text-gray-700">"{disagreement.quotedText}"</p>
                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                          {disagreement.coderViews.map((view) => (
                                            <div key={`${saveKey}-${view.coderId}`} className="rounded border border-gray-200 px-2 py-1">
                                              <p className="text-[11px] font-medium text-gray-800">{view.coderName}</p>
                                              <p className={`text-[11px] ${view.applied ? "text-green-700" : "text-red-700"}`}>
                                                {view.applied ? "Applied" : "Not applied"}
                                              </p>
                                              {view.quotes.length > 0 && (
                                                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-gray-700">
                                                  {view.quotes.map((quote, index) => (
                                                    <li key={`${saveKey}-${view.coderId}-${index}`}>{quote.quotedText}</li>
                                                  ))}
                                                </ul>
                                              )}
                                            </div>
                                          ))}
                                        </div>

                                        <button
                                          className="mt-2 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-800 disabled:opacity-50"
                                          disabled={savingBoundaryFor === saveKey}
                                          onClick={() => void saveBoundaryExample(row.techId, disagreement)}
                                          type="button"
                                        >
                                          {savingBoundaryFor === saveKey
                                            ? "Saving example..."
                                            : "Add to codebook as boundary example"}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>

                                {row.note && (
                                  <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                                    {row.note}
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Round history</h2>
            {roundHistory.length === 0 && (
              <p className="mt-2 text-xs text-gray-600">No completed rounds yet.</p>
            )}

            {roundHistory.length > 0 && (
              <>
                <ol className="mt-2 space-y-2">
                  {roundHistory.map((round) => (
                    <li key={round.id} className="rounded border border-gray-200 px-3 py-2">
                      <p className="text-xs font-semibold text-gray-800">
                        Round {round.roundNumber} ({round.status})
                      </p>
                      <p className="text-xs text-gray-600">
                        Overall k: {round.overall === null ? "n/a" : round.overall.toFixed(3)}
                      </p>
                      <p className="text-[11px] text-gray-500">{new Date(round.createdAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ol>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-700">Technique trend sparklines</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {TAXONOMY.map((technique) => {
                      const values = roundHistory.map((round) => {
                        const match = round.byTechnique.find((entry) => entry.techId === technique.id);
                        return match?.kappa ?? null;
                      });

                      const line = sparklinePath(values);

                      return (
                        <div key={`sparkline-${technique.id}`} className="rounded border border-gray-200 px-2 py-1">
                          <p className="text-[11px] font-medium text-gray-700">
                            {technique.id} - {technique.name}
                          </p>
                          <svg height="30" width="120" viewBox="0 0 120 30" aria-label={`Sparkline for ${technique.id}`}>
                            <polyline
                              fill="none"
                              points={line}
                              stroke="currentColor"
                              strokeWidth="1.5"
                              className="text-gray-900"
                            />
                          </svg>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </section>

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
