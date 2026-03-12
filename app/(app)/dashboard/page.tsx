"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { parseResponseJson } from "@/lib/http";
import { getActiveProjectId, setActiveProjectId } from "@/lib/projectClient";

type ProjectRole = "owner" | "coder";

type ProjectSummary = {
  id: string;
  name: string;
  role: ProjectRole;
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

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUserDashboard = useCallback(async (preferredProjectId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const resolvedPreferredProjectId =
        preferredProjectId ??
        (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId")) ??
        getActiveProjectId();

      const projectPath = resolvedPreferredProjectId
        ? `/api/projects?projectId=${encodeURIComponent(resolvedPreferredProjectId)}`
        : "/api/projects";

      const projectResponse = await fetch(projectPath, { cache: "no-store" });
      const projectJson = await parseResponseJson<ProjectApiResponse>(projectResponse, {});

      if (!projectResponse.ok) {
        throw new Error(projectJson.error ?? "Unable to load projects.");
      }

      setProjects(projectJson.projects ?? []);
      const nextCurrentProjectId = projectJson.currentProjectId ?? null;
      setCurrentProjectId(nextCurrentProjectId);
      if (nextCurrentProjectId) {
        setActiveProjectId(nextCurrentProjectId);
      }

      const pendingResponse = await fetch("/api/projects/invites/pending", { cache: "no-store" });
      const pendingJson = await parseResponseJson<{ invites?: PendingInvite[]; error?: string }>(
        pendingResponse,
        {},
      );

      if (pendingResponse.ok) {
        setPendingInvites(pendingJson.invites ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUserDashboard();
  }, [loadUserDashboard]);

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
      setActiveProjectId(payload.project.id);
      await loadUserDashboard(payload.project.id);
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
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to accept invite.");
      }

      const nextProjectId = payload.projectId ?? undefined;
      if (nextProjectId) {
        setActiveProjectId(nextProjectId);
      }
      await loadUserDashboard(nextProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">User Dashboard</h1>
      <p className="mt-1 text-sm text-gray-600">
        Create projects and open a project dashboard to manage documents, coders, and invitations.
      </p>

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Projects</h2>

        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={handleCreateProject}>
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New project name"
            required
            value={newProjectName}
          />
          <button
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busyAction === "create"}
            type="submit"
          >
            {busyAction === "create" ? "Creating..." : "Create Project"}
          </button>
        </form>

        {pendingInvites.length > 0 && (
          <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3">
            <p className="text-xs font-semibold text-sky-900">Pending Invitations</p>
            <ul className="mt-2 space-y-2">
              {pendingInvites.map((invite) => (
                <li key={invite.id} className="rounded-md border border-sky-100 bg-white p-2">
                  <p className="text-xs font-medium text-sky-900">
                    {invite.projects?.name ?? "Project"} ({invite.role})
                  </p>
                  <p className="text-xs text-sky-700">Expires: {new Date(invite.expires_at).toLocaleString()}</p>
                  <button
                    className="mt-2 rounded-md bg-sky-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                    disabled={busyAction === invite.token}
                    onClick={() => void handleAcceptInvite(invite.token)}
                    type="button"
                  >
                    {busyAction === invite.token ? "Accepting..." : "Accept Invite"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading && <p className="mt-3 text-sm text-gray-600">Loading projects...</p>}
        {!loading && projects.length === 0 && (
          <p className="mt-3 text-sm text-gray-600">No projects yet. Create your first project above.</p>
        )}

        <ul className="mt-4 space-y-2">
          {projects.map((project) => (
            <li key={project.id} className="flex items-center justify-between rounded-md border border-gray-100 p-3">
              <div>
                <p className="text-sm font-medium">{project.name}</p>
                <p className="text-xs text-gray-600">Role: {project.role}</p>
              </div>
              <Link
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900"
                href={`/projects/${project.id}`}
                onClick={() => setActiveProjectId(project.id)}
              >
                {project.id === currentProjectId ? "Open Current Project" : "Open Project"}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
