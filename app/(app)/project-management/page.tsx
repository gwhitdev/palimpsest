"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseResponseJson } from "@/lib/http";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";
import { Coder, DocumentWithAssignments } from "@/lib/types";

type ProjectRole = "owner" | "coder";

type ManagementPanel = "invite" | "members" | "upload" | "documents";

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

type DocumentApiResponse = {
  documents?: DocumentWithAssignments[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type CoderApiResponse = {
  coders?: Coder[];
  error?: string;
};

type Invite = {
  id: string;
  token: string;
  email: string;
  role: ProjectRole;
  grant_permissions: string[];
  deny_permissions: string[];
  status: string;
  expires_at: string;
  created_at: string;
};

type AssignmentDrafts = Record<string, string[]>;

const defaultRoleByMember = (coders: Coder[]) => {
  return coders.reduce<Record<string, ProjectRole>>((acc, coder) => {
    acc[coder.id] = coder.role;
    return acc;
  }, {});
};

const defaultPermissionsDraft = (coders: Coder[], key: "grantPermissions" | "denyPermissions") => {
  return coders.reduce<Record<string, string>>((acc, coder) => {
    acc[coder.id] = (coder[key] ?? []).join(",");
    return acc;
  }, {});
};

const parsePermissionInput = (value: string): string[] => {
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
};

export default function ProjectManagementPage() {
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("Project");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentWithAssignments[]>([]);
  const [coders, setCoders] = useState<Coder[]>([]);
  const [ownerInvites, setOwnerInvites] = useState<Invite[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDrafts>({});
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, ProjectRole>>({});
  const [memberGrantDrafts, setMemberGrantDrafts] = useState<Record<string, string>>({});
  const [memberDenyDrafts, setMemberDenyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ManagementPanel>("documents");

  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [selectedCoderIds, setSelectedCoderIds] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("coder");
  const [inviteGrantInput, setInviteGrantInput] = useState("");
  const [inviteDenyInput, setInviteDenyInput] = useState("");
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const coderNameMap = useMemo(() => {
    return new Map(coders.map((coder) => [coder.id, coder.display_name]));
  }, [coders]);

  const buildDrafts = (docs: DocumentWithAssignments[]): AssignmentDrafts => {
    return docs.reduce<AssignmentDrafts>((acc, document) => {
      acc[document.id] = [...document.assignedCoderIds];
      return acc;
    }, {});
  };

  const toggleCoderSelection = (list: string[], coderId: string, checked: boolean): string[] => {
    if (checked) return [...new Set([...list, coderId])];
    return list.filter((id) => id !== coderId);
  };

  const loadProjectManagement = useCallback(async (preferredProjectId?: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const queryProjectId =
        typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId");
      const targetProjectId = preferredProjectId ?? queryProjectId ?? getActiveProjectId();

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
        const currentProjectId = projectJson.currentProjectId;
        const currentRole = projectJson.currentRole;

        setProjects(projectJson.projects ?? []);

        if (currentProjectId && currentRole) {
          setRole(currentRole);
          setProjectId(currentProjectId);
          setActiveProjectId(currentProjectId);

          const currentProject = (projectJson.projects ?? []).find((project) => project.id === currentProjectId);
          setProjectName(currentProject?.name ?? "Project");

          if (currentRole === "coder") {
            const coderDocumentsResponse = await fetch(withProjectQuery("/api/documents", currentProjectId), {
              cache: "no-store",
            });
            const coderDocumentsJson = await parseResponseJson<DocumentApiResponse>(coderDocumentsResponse, {});

            if (!coderDocumentsResponse.ok) {
              throw new Error(coderDocumentsJson.error ?? "Failed to load available documents.");
            }

            const coderDocuments = coderDocumentsJson.documents ?? [];

            setDocuments(coderDocuments);
            setCoders([]);
            setOwnerInvites([]);
            setAssignmentDrafts(buildDrafts(coderDocuments));
            setActivePanel("documents");
          } else {
            const [documentsResponse, codersResponse, invitesResponse] = await Promise.all([
              fetch(withProjectQuery("/api/admin/documents", currentProjectId), { cache: "no-store" }),
              fetch(withProjectQuery("/api/admin/coders", currentProjectId), { cache: "no-store" }),
              fetch(withProjectQuery("/api/projects/invites", currentProjectId), { cache: "no-store" }),
            ]);

            const docsJson = await parseResponseJson<DocumentApiResponse>(documentsResponse, {});
            const codersJson = await parseResponseJson<CoderApiResponse>(codersResponse, {});
            const invitesJson = await parseResponseJson<{ invites?: Invite[]; error?: string }>(invitesResponse, {});

            if (!documentsResponse.ok) {
              throw new Error(docsJson.error ?? "Failed to load documents.");
            }

            if (!codersResponse.ok) {
              throw new Error(codersJson.error ?? "Failed to load members.");
            }

            if (!invitesResponse.ok) {
              throw new Error(invitesJson.error ?? "Failed to load invites.");
            }

            const nextDocs = docsJson.documents ?? [];
            const nextCoders = codersJson.coders ?? [];

            setDocuments(nextDocs);
            setCoders(nextCoders);
            setOwnerInvites(invitesJson.invites ?? []);
            setAssignmentDrafts(buildDrafts(nextDocs));
            setMemberRoleDrafts(defaultRoleByMember(nextCoders));
            setMemberGrantDrafts(defaultPermissionsDraft(nextCoders, "grantPermissions"));
            setMemberDenyDrafts(defaultPermissionsDraft(nextCoders, "denyPermissions"));

            if (docsJson.setupRequired) {
              setNotice(docsJson.setupHint ?? "Assignment table setup is required.");
            }
          }
        } else {
          setRole(null);
          setProjectId(null);
          setProjectName("No active project");
          setDocuments([]);
          setCoders([]);
          setOwnerInvites([]);
          setAssignmentDrafts({});
          setMemberRoleDrafts({});
          setMemberGrantDrafts({});
          setMemberDenyDrafts({});
        }
      } else {
        const noProjectMembership =
          projectResponse.status === 403 &&
          (projectJson.error?.toLowerCase().includes("not a member") ?? false);

        if (!noProjectMembership) {
          throw new Error(projectJson.error ?? "Unable to load project context.");
        }

        setRole(null);
        setProjectId(null);
        setProjectName("No active project");
        setProjects([]);
        setDocuments([]);
        setCoders([]);
        setOwnerInvites([]);
        setAssignmentDrafts({});
        setMemberRoleDrafts({});
        setMemberGrantDrafts({});
        setMemberDenyDrafts({});
      }

      const pendingResponse = await fetch("/api/projects/invites/pending", { cache: "no-store" });
      const pendingJson = await parseResponseJson<{ invites?: PendingInvite[] }>(pendingResponse, {});
      if (pendingResponse.ok) {
        setPendingInvites(pendingJson.invites ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project management.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjectManagement();
  }, [loadProjectManagement]);

  const handleCreateDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return;

    setBusyDocId("new");
    setError(null);

    try {
      const response = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title,
          source,
          content,
          assignedCoderIds: selectedCoderIds,
        }),
      });

      const payload = await parseResponseJson<{
        setupRequired?: boolean;
        setupHint?: string;
        error?: string;
      }>(response, {});

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create document.");
      }

      if (payload.setupRequired) {
        setNotice(payload.setupHint ?? "Assignment table setup is required.");
      }

      setTitle("");
      setSource("");
      setContent("");
      setSelectedCoderIds([]);
      await loadProjectManagement(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create document.");
    } finally {
      setBusyDocId(null);
    }
  };

  const handleSaveAssignments = async (documentId: string) => {
    if (!projectId) return;

    setBusyDocId(documentId);
    setError(null);

    try {
      const response = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          documentId,
          coderIds: assignmentDrafts[documentId] ?? [],
        }),
      });

      const payload = await parseResponseJson<{
        setupRequired?: boolean;
        setupHint?: string;
        error?: string;
      }>(response, {});

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save assignments.");
      }

      if (payload.setupRequired) {
        setNotice(payload.setupHint ?? "Assignment table setup is required.");
      }

      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId
            ? {
                ...document,
                assignedCoderIds: [...(assignmentDrafts[documentId] ?? [])],
              }
            : document,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save assignments.");
    } finally {
      setBusyDocId(null);
    }
  };

  const handleCreateInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return;

    setBusyInviteId("new");
    setError(null);

    try {
      const response = await fetch("/api/projects/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          email: inviteEmail,
          role: inviteRole,
          grantPermissions: parsePermissionInput(inviteGrantInput),
          denyPermissions: parsePermissionInput(inviteDenyInput),
        }),
      });

      const payload = await parseResponseJson<{ error?: string }>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create invite.");
      }

      setInviteEmail("");
      setInviteRole("coder");
      setInviteGrantInput("");
      setInviteDenyInput("");
      await loadProjectManagement(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite.");
    } finally {
      setBusyInviteId(null);
    }
  };

  const handleSaveMember = async (memberId: string) => {
    if (!projectId) return;

    setBusyMemberId(memberId);
    setError(null);

    try {
      const response = await fetch("/api/admin/coders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          userId: memberId,
          role: memberRoleDrafts[memberId],
          grantPermissions: parsePermissionInput(memberGrantDrafts[memberId] ?? ""),
          denyPermissions: parsePermissionInput(memberDenyDrafts[memberId] ?? ""),
        }),
      });

      const payload = await parseResponseJson<{ error?: string }>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save member settings.");
      }

      await loadProjectManagement(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save member settings.");
    } finally {
      setBusyMemberId(null);
    }
  };

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
      await loadProjectManagement(payload.project.id);
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

      await loadProjectManagement(nextProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite.");
    } finally {
      setBusyAction(null);
    }
  };

  const renderTile = (panel: ManagementPanel, title: string, description: string, metric?: string) => (
    <button
      className={`rounded-xl border p-4 text-left transition ${
        activePanel === panel ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white hover:border-gray-400"
      }`}
      onClick={() => setActivePanel(panel)}
      type="button"
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className={`mt-1 text-xs ${activePanel === panel ? "text-gray-200" : "text-gray-600"}`}>{description}</p>
      {metric && <p className={`mt-3 text-xs font-medium ${activePanel === panel ? "text-white" : "text-gray-900"}`}>{metric}</p>}
    </button>
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Project Management</h1>
          <p className="mt-1 text-sm text-gray-600">Manage all project actions from one place.</p>
          <p className="mt-1 text-xs text-gray-500">Current project: {projectName}</p>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Project Access</h2>
        <p className="mt-1 text-xs text-gray-600">Create a project or accept an invite to start managing work.</p>

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
      </section>

      {projects.length > 0 && (
        <div className="mt-4 max-w-md">
          <label className="text-xs font-medium text-gray-700" htmlFor="project-management-select">
            Switch project
          </label>
          <select
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            id="project-management-select"
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              setActiveProjectId(nextProjectId);
              void loadProjectManagement(nextProjectId);
            }}
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

      {notice && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {projectId && role && (
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {role === "owner" &&
            renderTile(
              "invite",
              "Invite Members",
              "Invite coders/owners with optional permission overrides.",
              `${ownerInvites.length} total invites`,
            )}
          {role === "owner" &&
            renderTile(
              "members",
              "Manage Members",
              "Update roles and discretionary allow/deny permissions.",
              `${coders.length} active members`,
            )}
          {role === "owner" &&
            renderTile(
              "upload",
              "Upload Documents",
              "Create documents and assign coders during upload.",
              `${documents.length} docs in project`,
            )}
          {renderTile(
            "documents",
            "Documents & Coding",
            "Open annotator sessions and maintain coder assignments.",
            `${documents.length} documents`,
          )}
        </section>
      )}

      {loading && <p className="mt-6 text-sm text-gray-600">Loading project data...</p>}

      {!loading && !projectId && (
        <p className="mt-6 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          No active project selected yet. Create one above or accept an invite to continue.
        </p>
      )}

      {!loading && projectId && activePanel === "invite" && role === "owner" && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Invite Member</h2>
          <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={handleCreateInvite}>
            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="member@example.com"
              required
              type="email"
              value={inviteEmail}
            />

            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setInviteRole(event.target.value as ProjectRole)}
              value={inviteRole}
            >
              <option value="coder">Coder</option>
              <option value="owner">Owner</option>
            </select>

            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setInviteGrantInput(event.target.value)}
              placeholder="Allow permissions (comma-separated)"
              value={inviteGrantInput}
            />

            <input
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setInviteDenyInput(event.target.value)}
              placeholder="Deny permissions (comma-separated)"
              value={inviteDenyInput}
            />

            <button
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 md:col-span-2"
              disabled={busyInviteId === "new"}
              type="submit"
            >
              {busyInviteId === "new" ? "Inviting..." : "Create Invite"}
            </button>
          </form>

          {ownerInvites.length > 0 && (
            <ul className="mt-4 space-y-2">
              {ownerInvites.map((invite) => (
                <li key={invite.id} className="rounded-md border border-gray-100 p-3">
                  <p className="text-xs font-medium">
                    {invite.email} - {invite.role} ({invite.status})
                  </p>
                  <p className="mt-1 break-all text-xs text-gray-600">Token: {invite.token}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!loading && projectId && activePanel === "members" && role === "owner" && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Members</h2>
          <p className="mt-1 text-xs text-gray-600">
            Update role and discretionary permission overrides (comma-separated permission keys).
          </p>
          <ul className="mt-3 space-y-2">
            {coders.map((coder) => (
              <li key={coder.id} className="rounded-md border border-gray-100 p-3">
                <p className="text-sm font-medium">{coder.display_name}</p>
                <p className="text-xs text-gray-600">{coder.id}</p>

                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <select
                    className="rounded-md border border-gray-300 px-2 py-2 text-xs"
                    onChange={(event) =>
                      setMemberRoleDrafts((current) => ({
                        ...current,
                        [coder.id]: event.target.value as ProjectRole,
                      }))
                    }
                    value={memberRoleDrafts[coder.id] ?? coder.role}
                  >
                    <option value="owner">Owner</option>
                    <option value="coder">Coder</option>
                  </select>

                  <input
                    className="rounded-md border border-gray-300 px-2 py-2 text-xs"
                    onChange={(event) =>
                      setMemberGrantDrafts((current) => ({ ...current, [coder.id]: event.target.value }))
                    }
                    placeholder="Allow permissions"
                    value={memberGrantDrafts[coder.id] ?? ""}
                  />

                  <input
                    className="rounded-md border border-gray-300 px-2 py-2 text-xs"
                    onChange={(event) =>
                      setMemberDenyDrafts((current) => ({ ...current, [coder.id]: event.target.value }))
                    }
                    placeholder="Deny permissions"
                    value={memberDenyDrafts[coder.id] ?? ""}
                  />
                </div>

                <button
                  className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 disabled:opacity-50"
                  disabled={busyMemberId === coder.id}
                  onClick={() => void handleSaveMember(coder.id)}
                  type="button"
                >
                  {busyMemberId === coder.id ? "Saving..." : "Save Member"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && projectId && activePanel === "upload" && role === "owner" && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Upload Document</h2>
          <form className="mt-3 space-y-3" onSubmit={handleCreateDocument}>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              required
              value={title}
            />

            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setSource(event.target.value)}
              placeholder="Source (optional)"
              value={source}
            />

            <textarea
              className="min-h-40 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste full document text"
              required
              value={content}
            />

            <div>
              <p className="text-xs font-medium text-gray-700">Assign coders on upload</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {coders
                  .filter((coder) => coder.role === "coder")
                  .map((coder) => (
                    <label key={coder.id} className="flex items-center gap-2 text-sm">
                      <input
                        checked={selectedCoderIds.includes(coder.id)}
                        onChange={(event) =>
                          setSelectedCoderIds((current) =>
                            toggleCoderSelection(current, coder.id, event.target.checked),
                          )
                        }
                        type="checkbox"
                      />
                      {coder.display_name}
                    </label>
                  ))}
              </div>
            </div>

            <button
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={busyDocId === "new"}
              type="submit"
            >
              {busyDocId === "new" ? "Saving..." : "Create Document"}
            </button>
          </form>
        </section>
      )}

      {!loading && projectId && activePanel === "documents" && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Documents</h2>
          {documents.length === 0 && (
            <p className="mt-2 text-sm text-gray-600">
              {role === "coder"
                ? "No documents are available to you yet. Ask an owner to assign one."
                : "No documents found yet."}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {documents.map((document) => (
              <li key={document.id} className="rounded-md border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{document.title}</p>
                    <p className="text-xs text-gray-600">{document.source || "No source"}</p>
                    {role === "owner" && (
                      <p className="mt-1 text-xs text-gray-500">
                        Assigned:{" "}
                        {document.assignedCoderIds.length > 0
                          ? document.assignedCoderIds
                              .map((coderId) => coderNameMap.get(coderId) ?? coderId)
                              .join(", ")
                          : "None"}
                      </p>
                    )}
                  </div>
                  <Link
                    className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white"
                    href={withProjectQuery(`/annotate/${document.id}`, projectId)}
                  >
                    Open Annotator
                  </Link>
                </div>

                {role === "owner" && (
                  <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-medium text-gray-700">Edit coder assignments</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {coders
                        .filter((coder) => coder.role === "coder")
                        .map((coder) => (
                          <label key={`${document.id}-${coder.id}`} className="flex items-center gap-2 text-sm">
                            <input
                              checked={(assignmentDrafts[document.id] ?? []).includes(coder.id)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setAssignmentDrafts((current) => ({
                                  ...current,
                                  [document.id]: toggleCoderSelection(
                                    current[document.id] ?? [],
                                    coder.id,
                                    checked,
                                  ),
                                }));
                              }}
                              type="checkbox"
                            />
                            {coder.display_name}
                          </label>
                        ))}
                    </div>

                    <button
                      className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 disabled:opacity-50"
                      disabled={busyDocId === document.id}
                      onClick={() => void handleSaveAssignments(document.id)}
                      type="button"
                    >
                      {busyDocId === document.id ? "Saving..." : "Save Assignments"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
