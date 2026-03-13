"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { parseResponseJson } from "@/lib/http";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";

type ProjectRole = "owner" | "coder";
type ProjectStatus = "active" | "closed" | "archived";

type ProjectSummary = {
  id: string;
  name: string;
  role: ProjectRole;
  status: ProjectStatus;
  created_at: string;
};

type ProjectApiResponse = {
  currentProjectId?: string;
  projects?: ProjectSummary[];
  error?: string;
};

type ChecklistApiResponse = {
  projectId?: string;
  checked?: Record<string, boolean>;
  details?: Partial<ChecklistDetails>;
  updatedAt?: string | null;
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type ChecklistDetails = {
  roundNumber: string;
  roundId: string;
  projectLead: string;
  coderRoster: string;
  calibrationSet: string;
  notes: string;
};

type ChecklistSection = {
  id: string;
  title: string;
  items: Array<{
    id: string;
    title: string;
    instruction: string;
    path?: string;
  }>;
};

const DEFAULT_DETAILS: ChecklistDetails = {
  roundNumber: "",
  roundId: "",
  projectLead: "",
  coderRoster: "",
  calibrationSet: "",
  notes: "",
};

const CHECKLIST_SECTIONS: ChecklistSection[] = [
  {
    id: "kickoff",
    title: "1. Project kickoff",
    items: [
      {
        id: "kickoff-scope",
        title: "Confirm project scope and coding question",
        instruction:
          "Document the research question, unit of analysis, and what counts as in-scope text for this project.",
      },
      {
        id: "kickoff-team",
        title: "Confirm coder roster and roles",
        instruction:
          "Record who is coding this round and who signs off revisions. Keep this list updated when membership changes.",
        path: "/project-management",
      },
      {
        id: "kickoff-sample",
        title: "Choose shared calibration subset",
        instruction:
          "Select the common documents/spans every coder must annotate so IRR is computed on overlapping material.",
      },
    ],
  },
  {
    id: "annotation",
    title: "2. Annotation round",
    items: [
      {
        id: "annotation-pass",
        title: "Complete independent coding pass",
        instruction:
          "Each coder annotates the shared subset independently using the agreed codebook definitions.",
      },
      {
        id: "annotation-accepted",
        title: "Confirm accepted annotations are finalized",
        instruction:
          "Only accepted annotations are used for reliability calculations. Verify acceptance decisions before review.",
      },
      {
        id: "annotation-roundid",
        title: "Verify round tracking metadata",
        instruction:
          "Ensure this round is clearly identified in your project notes so results and revisions map to the same round.",
      },
    ],
  },
  {
    id: "review",
    title: "3. Reliability review and revision loop",
    items: [
      {
        id: "review-stats",
        title: "Review per-technique kappa table",
        instruction:
          "Open stats, sort by kappa ascending, and prioritize techniques below 0.70 for immediate revision.",
        path: "/stats",
      },
      {
        id: "review-disagreements",
        title: "Inspect disagreement drill-down examples",
        instruction:
          "For low-kappa techniques, inspect coder disagreement examples and identify specific boundary-rule confusion.",
        path: "/stats",
      },
      {
        id: "review-boundaries",
        title: "Add boundary examples to codebook guidance",
        instruction:
          "Save disagreement excerpts as boundary examples so future coding decisions are grounded in concrete cases.",
        path: "/stats",
      },
      {
        id: "review-status",
        title: "Update technique status decisions",
        instruction:
          "Use DRAFT, UNDER REVISION, and LOCKED consistently so coders can see which definitions are stable.",
        path: "/annotate/all",
      },
    ],
  },
  {
    id: "closeout",
    title: "4. Round closeout",
    items: [
      {
        id: "closeout-export",
        title: "Export project data for audit trail",
        instruction:
          "Export the project dataset for this round and retain it with meeting notes and revision decisions.",
        path: "/stats",
      },
      {
        id: "closeout-analysis",
        title: "Run external reliability analysis",
        instruction:
          "Run your R/Python reliability script and compare outputs with in-app kappa summaries.",
      },
      {
        id: "closeout-next",
        title: "Decide next action for each weak technique",
        instruction:
          "For every technique below target threshold, record rewrite, rule clarification, or boundary-example action.",
      },
      {
        id: "closeout-signoff",
        title: "Record round sign-off",
        instruction:
          "Capture who approved the round and whether another calibration round is required.",
      },
    ],
  },
];

const ALL_ITEMS = CHECKLIST_SECTIONS.flatMap((section) => section.items);

function toInitialChecked(): Record<string, boolean> {
  return Object.fromEntries(ALL_ITEMS.map((item) => [item.id, false]));
}

export default function ResearchChecklistPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>(toInitialChecked());
  const [details, setDetails] = useState<ChecklistDetails>(DEFAULT_DETAILS);
  const [hasLoadedChecklist, setHasLoadedChecklist] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isChecklistLoading, setIsChecklistLoading] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  const completedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  );

  const completionPercent = useMemo(() => {
    if (ALL_ITEMS.length === 0) return 0;
    return Math.round((completedCount / ALL_ITEMS.length) * 100);
  }, [completedCount]);

  const setProjectContext = (nextProjectId: string | null) => {
    setProjectIdState(nextProjectId);

    if (nextProjectId) {
      setActiveProjectId(nextProjectId);
    }

    const url = new URL(window.location.href);
    if (nextProjectId) {
      url.searchParams.set("projectId", nextProjectId);
    } else {
      url.searchParams.delete("projectId");
    }

    const search = url.searchParams.toString();
    const nextPath = search ? `${url.pathname}?${search}` : url.pathname;
    window.history.replaceState({}, "", nextPath);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const queryProjectId =
          typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId");
        const targetProjectId = queryProjectId ?? getActiveProjectId();

        const response = await fetch(withProjectQuery("/api/projects", targetProjectId), {
          cache: "no-store",
        });
        const payload = await parseResponseJson<ProjectApiResponse>(response, {});

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load projects.");
        }

        const loadedProjects = payload.projects ?? [];
        const resolvedProjectId =
          payload.currentProjectId ?? targetProjectId ?? loadedProjects[0]?.id ?? null;

        setProjects(loadedProjects);
        setProjectContext(resolvedProjectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load projects.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!projectId) {
      setChecked(toInitialChecked());
      setDetails(DEFAULT_DETAILS);
      setLastSavedAt(null);
      setIsDirty(false);
      setHasLoadedChecklist(false);
      return;
    }

    (async () => {
      setIsChecklistLoading(true);
      setError(null);
      setNotice(null);
      setHasLoadedChecklist(false);

      try {
        const response = await fetch(withProjectQuery("/api/research-checklist", projectId), {
          cache: "no-store",
        });
        const payload = await parseResponseJson<ChecklistApiResponse>(response, {});

        if (!response.ok) {
          throw new Error(payload.error ?? payload.setupHint ?? "Unable to load checklist state.");
        }

        setChecked({ ...toInitialChecked(), ...(payload.checked ?? {}) });
        setDetails({ ...DEFAULT_DETAILS, ...(payload.details ?? {}) });
        setLastSavedAt(payload.updatedAt ?? null);
        setSetupHint(payload.setupRequired ? payload.setupHint ?? null : null);
        setIsDirty(false);
      } catch (err) {
        setChecked(toInitialChecked());
        setDetails(DEFAULT_DETAILS);
        setLastSavedAt(null);
        setError(err instanceof Error ? err.message : "Unable to load checklist state.");
      } finally {
        setHasLoadedChecklist(true);
        setIsChecklistLoading(false);
      }
    })();
  }, [projectId]);

  useEffect(() => {
    if (!hasLoadedChecklist || !projectId || !isDirty) return;

    const saveTimeout = window.setTimeout(() => {
      void (async () => {
        setIsSaving(true);

        try {
          const response = await fetch("/api/research-checklist", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              checked,
              details,
            }),
          });

          const payload = await parseResponseJson<ChecklistApiResponse>(response, {});
          if (!response.ok) {
            throw new Error(payload.error ?? payload.setupHint ?? "Unable to save checklist state.");
          }

          setLastSavedAt(payload.updatedAt ?? new Date().toISOString());
          setSetupHint(payload.setupRequired ? payload.setupHint ?? null : null);
          setIsDirty(false);
          setNotice("Checklist changes saved.");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Unable to save checklist state.");
        } finally {
          setIsSaving(false);
        }
      })();
    }, 450);

    return () => {
      window.clearTimeout(saveTimeout);
    };
  }, [hasLoadedChecklist, projectId, isDirty, checked, details]);

  const toggleItem = (itemId: string) => {
    setChecked((current) => ({
      ...current,
      [itemId]: !current[itemId],
    }));
    setIsDirty(true);
    setNotice(null);
  };

  const markAllComplete = () => {
    setChecked(Object.fromEntries(ALL_ITEMS.map((item) => [item.id, true])));
    setIsDirty(true);
    setNotice(null);
  };

  const resetChecklist = () => {
    if (!window.confirm("Reset this checklist for the active project?")) return;

    setChecked(toInitialChecked());
    setIsDirty(true);
    setNotice("Checklist reset for this project.");
  };

  const copySummary = async () => {
    if (!activeProject) return;

    const pending = ALL_ITEMS.filter((item) => !checked[item.id]).map((item) => `- [ ] ${item.title}`);

    const lines = [
      `Project: ${activeProject.name}`,
      `Project ID: ${activeProject.id}`,
      `Round Number: ${details.roundNumber || "-"}`,
      `Round ID: ${details.roundId || "-"}`,
      `Project Lead: ${details.projectLead || "-"}`,
      `Coders: ${details.coderRoster || "-"}`,
      `Calibration Set: ${details.calibrationSet || "-"}`,
      `Completion: ${completedCount}/${ALL_ITEMS.length} (${completionPercent}%)`,
      "",
      "Remaining actions:",
      ...(pending.length > 0 ? pending : ["- None"]),
      "",
      `Notes: ${details.notes || "-"}`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice("Project checklist summary copied.");
    } catch {
      setError("Unable to copy summary.");
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Research Project Checklist</h1>
        <p className="text-sm text-gray-700">
          This checklist is saved per project and focuses on research workflow only: coding rounds,
          reliability review, and revision decisions.
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-700">
            Active project
            <select
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              disabled={loading || projects.length === 0}
              onChange={(event) => {
                const next = event.target.value || null;
                setProjectContext(next);
                setNotice(null);
              }}
              value={projectId ?? ""}
            >
              {projects.length === 0 && <option value="">No projects available</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.role}, {project.status})
                </option>
              ))}
            </select>
          </label>

          <div className="text-xs text-gray-700">
            <p className="font-medium">Progress</p>
            <p className="mt-1">
              {completedCount} of {ALL_ITEMS.length} complete ({completionPercent}%)
            </p>
            <p className="mt-1 text-[11px] text-gray-500">
              {isChecklistLoading
                ? "Loading checklist..."
                : isSaving
                  ? "Saving changes..."
                  : lastSavedAt
                    ? `Last saved ${new Date(lastSavedAt).toLocaleString()}`
                    : "Not saved yet"}
            </p>
            <div className="mt-2 h-2 rounded-full bg-gray-200">
              <div
                className="h-2 rounded-full bg-gray-900"
                style={{ width: `${completionPercent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button
            className="rounded border border-gray-300 px-2 py-1 font-medium text-gray-800"
            onClick={markAllComplete}
            type="button"
          >
            Mark all complete
          </button>
          <button
            className="rounded border border-gray-300 px-2 py-1 font-medium text-gray-800"
            onClick={resetChecklist}
            type="button"
          >
            Reset checklist
          </button>
          <button
            className="rounded border border-gray-300 px-2 py-1 font-medium text-gray-800"
            onClick={() => void copySummary()}
            type="button"
          >
            Copy project summary
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Project round details</h2>
        <p className="mt-1 text-xs text-gray-600">These notes are saved per project to keep rounds organized.</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-700">
            Round number
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              onChange={(event) => {
                setDetails((current) => ({ ...current, roundNumber: event.target.value }));
                setIsDirty(true);
              }}
              value={details.roundNumber}
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Round ID
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              onChange={(event) => {
                setDetails((current) => ({ ...current, roundId: event.target.value }));
                setIsDirty(true);
              }}
              value={details.roundId}
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Project lead
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              onChange={(event) => {
                setDetails((current) => ({ ...current, projectLead: event.target.value }));
                setIsDirty(true);
              }}
              value={details.projectLead}
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Coder roster
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              onChange={(event) => {
                setDetails((current) => ({ ...current, coderRoster: event.target.value }));
                setIsDirty(true);
              }}
              placeholder="Name 1, Name 2"
              value={details.coderRoster}
            />
          </label>

          <label className="text-xs font-medium text-gray-700 sm:col-span-2">
            Calibration subset
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              onChange={(event) => {
                setDetails((current) => ({ ...current, calibrationSet: event.target.value }));
                setIsDirty(true);
              }}
              placeholder="Document IDs or title list"
              value={details.calibrationSet}
            />
          </label>

          <label className="text-xs font-medium text-gray-700 sm:col-span-2">
            Round notes
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              onChange={(event) => {
                setDetails((current) => ({ ...current, notes: event.target.value }));
                setIsDirty(true);
              }}
              value={details.notes}
            />
          </label>
        </div>
      </section>

      {CHECKLIST_SECTIONS.map((section) => (
        <section key={section.id} className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">{section.title}</h2>
          <div className="mt-2 space-y-3">
            {section.items.map((item) => (
              <div key={item.id} className="rounded-md border border-gray-200 p-3">
                <label className="flex items-start gap-2 text-sm font-medium text-gray-900">
                  <input
                    checked={Boolean(checked[item.id])}
                    className="mt-0.5"
                    onChange={() => toggleItem(item.id)}
                    type="checkbox"
                  />
                  <span>{item.title}</span>
                </label>
                <p className="mt-1 text-xs text-gray-700">Instruction: {item.instruction}</p>
                {item.path && projectId && (
                  <Link
                    className="mt-1 inline-block text-xs font-medium text-gray-900 underline"
                    href={withProjectQuery(item.path, projectId)}
                  >
                    Open related page
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {loading && <p className="text-sm text-gray-600">Loading project context...</p>}
      {setupHint && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {setupHint}
        </p>
      )}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </main>
  );
}
