"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { parseResponseJson } from "@/lib/http";
import { getActiveProjectId, setActiveProjectId } from "@/lib/projectClient";

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
  currentRole?: ProjectRole;
  projects?: ProjectSummary[];
  error?: string;
};

type CreateProjectResponse = {
  project?: {
    id: string;
    name: string;
    status?: ProjectStatus;
  };
  error?: string;
};

type PendingInvite = {
  id: string;
  token: string;
  role: ProjectRole;
  expires_at: string;
  projects?: { name: string | null } | null;
};

function withProjectQuery(path: string, projectId: string | null | undefined): string {
  if (!projectId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}projectId=${encodeURIComponent(projectId)}`;
}

export default function ProjectsMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const currentProjectLabel = useMemo(() => {
    if (!currentProjectId) return "No active project";
    const current = projects.find((project) => project.id === currentProjectId);
    if (!current) return "Active project";
    return `${current.name} (${current.role})`;
  }, [currentProjectId, projects]);

  const navigateWithProject = (projectId: string) => {
    setActiveProjectId(projectId);
    const url = new URL(window.location.href);
    url.searchParams.set("projectId", projectId);
    window.location.assign(`${url.pathname}?${url.searchParams.toString()}`);
  };

  const loadProjectsData = async () => {
    setLoading(true);
    setError(null);

    try {
      const queryProjectId =
        typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId");
      const targetProjectId = queryProjectId ?? getActiveProjectId();

      let projectResponse = await fetch(withProjectQuery("/api/projects", targetProjectId), {
        cache: "no-store",
      });
      let projectJson = await parseResponseJson<ProjectApiResponse>(projectResponse, {});

      if (!projectResponse.ok && targetProjectId) {
        const fallbackResponse = await fetch("/api/projects", { cache: "no-store" });
        const fallbackJson = await parseResponseJson<ProjectApiResponse>(fallbackResponse, {});
        if (fallbackResponse.ok) {
          projectResponse = fallbackResponse;
          projectJson = fallbackJson;
        }
      }

      if (projectResponse.ok) {
        setProjects(projectJson.projects ?? []);
        setCurrentProjectId(projectJson.currentProjectId ?? null);
        if (projectJson.currentProjectId) {
          setActiveProjectId(projectJson.currentProjectId);
        }
      } else if (projectResponse.status === 403) {
        setProjects([]);
        setCurrentProjectId(null);
      } else {
        throw new Error(projectJson.error ?? "Unable to load projects.");
      }

      const pendingResponse = await fetch("/api/projects/invites/pending", { cache: "no-store" });
      const pendingJson = await parseResponseJson<{ invites?: PendingInvite[]; error?: string }>(pendingResponse, {});
      if (!pendingResponse.ok) {
        throw new Error(pendingJson.error ?? "Unable to load pending invites.");
      }

      setPendingInvites(pendingJson.invites ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadProjectsData();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setBusyAction("create");
    setError(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName }),
      });

      const payload = await parseResponseJson<CreateProjectResponse>(response, {});
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? "Failed to create project.");
      }

      setNewProjectName("");
      setNotice("Project created.");
      navigateWithProject(payload.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleAcceptInvite = async (token: string) => {
    setBusyAction(token);
    setError(null);

    try {
      const response = await fetch("/api/projects/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const payload = await parseResponseJson<{ error?: string; projectId?: string }>(response, {});
      if (!response.ok || !payload.projectId) {
        throw new Error(payload.error ?? "Failed to accept invite.");
      }

      setNotice("Invite accepted.");
      navigateWithProject(payload.projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="text-gray-700 hover:text-black"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        Projects
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-[360px] rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Projects</p>
            <div className="flex items-center gap-2">
              <Link
                className="text-xs font-medium text-gray-600 underline"
                href="/research-checklist"
                onClick={() => setIsOpen(false)}
              >
                Open Checklist
              </Link>
              <Link
                className="text-xs font-medium text-gray-600 underline"
                href="/project-management"
                onClick={() => setIsOpen(false)}
              >
                Open Project Management
              </Link>
            </div>
          </div>

          <p className="mt-1 text-xs text-gray-600">{currentProjectLabel}</p>

          <details className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2" open>
            <summary className="cursor-pointer text-xs font-semibold text-gray-800">Project Access</summary>

            <form className="mt-2 flex gap-2" onSubmit={handleCreateProject}>
              <input
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="New project name"
                required
                value={newProjectName}
              />
              <button
                className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                disabled={busyAction === "create"}
                type="submit"
              >
                {busyAction === "create" ? "Creating..." : "Create"}
              </button>
            </form>

            {pendingInvites.length > 0 && (
              <ul className="mt-2 space-y-2">
                {pendingInvites.map((invite) => (
                  <li key={invite.id} className="rounded border border-sky-200 bg-sky-50 p-2">
                    <p className="text-xs font-medium text-sky-900">
                      {invite.projects?.name ?? "Project"} ({invite.role})
                    </p>
                    <p className="text-[11px] text-sky-800">Expires: {new Date(invite.expires_at).toLocaleString()}</p>
                    <button
                      className="mt-1 rounded bg-sky-700 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      disabled={busyAction === invite.token}
                      onClick={() => void handleAcceptInvite(invite.token)}
                      type="button"
                    >
                      {busyAction === invite.token ? "Accepting..." : "Accept Invite"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>

          <div className="mt-3 rounded-md border border-gray-200 p-2">
            <p className="text-xs font-semibold text-gray-800">Switch Project</p>
            <select
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
              disabled={loading || projects.length === 0}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                if (!nextProjectId) return;
                navigateWithProject(nextProjectId);
              }}
              value={currentProjectId ?? ""}
            >
              {projects.length === 0 && <option value="">No active projects</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.role}, {project.status})
                </option>
              ))}
            </select>
          </div>

          {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
          {loading && <p className="mt-2 text-xs text-gray-500">Loading projects...</p>}
        </div>
      )}
    </div>
  );
}
