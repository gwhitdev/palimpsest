"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseResponseJson } from "@/lib/http";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";
import { Coder, DocumentWithAssignments } from "@/lib/types";

type ProjectRole = "owner" | "coder";
type ProjectStatus = "active" | "closed" | "archived";
type ProjectLifecycleAction = "close" | "archive" | "reopen" | "delete";

type ManagementPanel = "invite" | "members" | "upload" | "documents";

type ProjectSummary = {
  id: string;
  name: string;
  status: ProjectStatus;
  role: ProjectRole;
  created_at: string;
};

type ProjectApiResponse = {
  currentProjectId?: string;
  currentRole?: ProjectRole;
  projects?: ProjectSummary[];
  error?: string;
};

type UpdateProjectResponse = {
  project?: {
    id: string;
    name: string;
    status: ProjectStatus;
  };
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type DeleteProjectResponse = {
  deletedProjectId?: string;
  nextProjectId?: string | null;
  projects?: ProjectSummary[];
  error?: string;
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

type StatsVisibilityResponse = {
  statsVisibleToCoders?: boolean;
  otherCodersVisibleToCoders?: boolean;
  otherAnnotationsVisibleToCoders?: boolean;
  otherCommentsVisibleToCoders?: boolean;
  canViewStats?: boolean;
  canManageStatsVisibility?: boolean;
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

const defaultRoleByMember = (coders: Coder[]) => {
  return coders.reduce<Record<string, ProjectRole>>((acc, coder) => {
    acc[coder.id] = coder.role;
    return acc;
  }, {});
};

const defaultPermissionsDraft = (coders: Coder[], key: "grantPermissions" | "denyPermissions") => {
  return coders.reduce<Record<string, string[]>>((acc, coder) => {
    acc[coder.id] = [...(coder[key] ?? [])];
    return acc;
  }, {});
};

const PROJECT_PERMISSION_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "manage_project", label: "Manage project lifecycle" },
  { key: "manage_members", label: "Manage members" },
  { key: "manage_permissions", label: "Manage permission overrides" },
  { key: "invite_members", label: "Invite members" },
  { key: "manage_documents", label: "Manage documents" },
  { key: "view_documents", label: "View documents" },
  { key: "annotate", label: "Annotate" },
  { key: "view_stats", label: "View stats" },
  { key: "export_data", label: "Export data" },
];

const parsePermissionInput = (value: string): string[] => {
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
};

export default function ProjectManagementPage() {
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("Project");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("active");
  const [documents, setDocuments] = useState<DocumentWithAssignments[]>([]);
  const [coders, setCoders] = useState<Coder[]>([]);
  const [ownerInvites, setOwnerInvites] = useState<Invite[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDrafts>({});
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, ProjectRole>>({});
  const [memberGrantDrafts, setMemberGrantDrafts] = useState<Record<string, string[]>>({});
  const [memberDenyDrafts, setMemberDenyDrafts] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [savingStatsVisibility, setSavingStatsVisibility] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ManagementPanel>("documents");
  const [statsVisibleToCoders, setStatsVisibleToCoders] = useState(true);
  const [otherCodersVisibleToCoders, setOtherCodersVisibleToCoders] = useState(true);
  const [otherAnnotationsVisibleToCoders, setOtherAnnotationsVisibleToCoders] = useState(true);
  const [otherCommentsVisibleToCoders, setOtherCommentsVisibleToCoders] = useState(true);
  const [canViewStats, setCanViewStats] = useState(false);
  const [canManageStatsVisibility, setCanManageStatsVisibility] = useState(false);

  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [selectedCoderIds, setSelectedCoderIds] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("coder");
  const [inviteGrantInput, setInviteGrantInput] = useState("");
  const [inviteDenyInput, setInviteDenyInput] = useState("");
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

  const togglePermissionDraft = (
    current: Record<string, string[]>,
    memberId: string,
    permission: string,
    checked: boolean,
  ) => {
    const nextValues = new Set(current[memberId] ?? []);
    if (checked) {
      nextValues.add(permission);
    } else {
      nextValues.delete(permission);
    }

    return {
      ...current,
      [memberId]: [...nextValues],
    };
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

        if (currentProjectId && currentRole) {
          setRole(currentRole);
          setProjectId(currentProjectId);
          setActiveProjectId(currentProjectId);

          const currentProject = (projectJson.projects ?? []).find((project) => project.id === currentProjectId);
          setProjectName(currentProject?.name ?? "Project");
          setProjectStatus(currentProject?.status ?? "active");

          const statsVisibilityResponse = await fetch(
            withProjectQuery("/api/projects/stats-visibility", currentProjectId),
            {
              cache: "no-store",
            },
          );
          const statsVisibilityJson = await parseResponseJson<StatsVisibilityResponse>(
            statsVisibilityResponse,
            {},
          );

          if (!statsVisibilityResponse.ok) {
            throw new Error(statsVisibilityJson.error ?? "Failed to load stats visibility.");
          }

          setStatsVisibleToCoders(statsVisibilityJson.statsVisibleToCoders !== false);
          setOtherCodersVisibleToCoders(statsVisibilityJson.otherCodersVisibleToCoders !== false);
          setOtherAnnotationsVisibleToCoders(
            statsVisibilityJson.otherAnnotationsVisibleToCoders !== false,
          );
          setOtherCommentsVisibleToCoders(statsVisibilityJson.otherCommentsVisibleToCoders !== false);
          setCanViewStats(Boolean(statsVisibilityJson.canViewStats));
          setCanManageStatsVisibility(Boolean(statsVisibilityJson.canManageStatsVisibility));

          if (statsVisibilityJson.setupRequired) {
            setNotice(statsVisibilityJson.setupHint ?? "Project settings setup is required.");
          }

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
          setProjectStatus("active");
          setDocuments([]);
          setCoders([]);
          setOwnerInvites([]);
          setAssignmentDrafts({});
          setMemberRoleDrafts({});
          setMemberGrantDrafts({});
          setMemberDenyDrafts({});
          setStatsVisibleToCoders(true);
          setOtherCodersVisibleToCoders(true);
          setOtherAnnotationsVisibleToCoders(true);
          setOtherCommentsVisibleToCoders(true);
          setCanViewStats(false);
          setCanManageStatsVisibility(false);
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
        setProjectStatus("active");
        setDocuments([]);
        setCoders([]);
        setOwnerInvites([]);
        setAssignmentDrafts({});
        setMemberRoleDrafts({});
        setMemberGrantDrafts({});
        setMemberDenyDrafts({});
        setStatsVisibleToCoders(true);
        setOtherCodersVisibleToCoders(true);
        setOtherAnnotationsVisibleToCoders(true);
        setOtherCommentsVisibleToCoders(true);
        setCanViewStats(false);
        setCanManageStatsVisibility(false);
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
          grantPermissions: memberGrantDrafts[memberId] ?? [],
          denyPermissions: memberDenyDrafts[memberId] ?? [],
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

  const handleRevokeInvite = async (inviteId: string) => {
    if (!projectId) return;

    setBusyInviteId(inviteId);
    setError(null);

    try {
      const response = await fetch("/api/projects/invites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          inviteId,
          action: "revoke",
        }),
      });

      const payload = await parseResponseJson<{ error?: string }>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to revoke invite.");
      }

      setOwnerInvites((current) =>
        current.map((invite) =>
          invite.id === inviteId
            ? {
                ...invite,
                status: "revoked",
              }
            : invite,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke invite.");
    } finally {
      setBusyInviteId(null);
    }
  };

  const handleProjectLifecycleAction = async (action: ProjectLifecycleAction) => {
    if (!projectId || role !== "owner") return;

    const actionKey = `project-${action}`;
    const lifecyclePrompts: Record<ProjectLifecycleAction, string> = {
      close: "Close this project? Coders will still be listed as members, but the project will be marked closed.",
      archive: "Archive this project? You can reopen it later.",
      reopen: "Reopen this project and set it back to active?",
      delete: `Delete project \"${projectName}\" permanently? This also removes its documents, annotations, and invites.`,
    };

    if (!window.confirm(lifecyclePrompts[action])) {
      return;
    }

    if (action === "delete") {
      const typedName = window.prompt(
        `Type the project name exactly to confirm deletion:\n${projectName}`,
        "",
      );

      if (typedName !== projectName) {
        setError("Project deletion cancelled because the confirmation name did not match.");
        return;
      }
    }

    setBusyAction(actionKey);
    setError(null);

    try {
      if (action === "delete") {
        const response = await fetch("/api/projects", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });

        const payload = await parseResponseJson<DeleteProjectResponse>(response, {});
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to delete project.");
        }

        const nextProjectId = payload.nextProjectId ?? undefined;
        setActiveProjectId(nextProjectId ?? "");
        await loadProjectManagement(nextProjectId);
        setNotice("Project deleted.");
        return;
      }

      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action }),
      });

      const payload = await parseResponseJson<UpdateProjectResponse>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update project status.");
      }

      await loadProjectManagement(projectId);
      const actionLabels: Record<Exclude<ProjectLifecycleAction, "delete">, string> = {
        close: "closed",
        archive: "archived",
        reopen: "reopened",
      };
      setNotice(`Project ${actionLabels[action]} successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project lifecycle state.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateVisibilitySettings = async (
    patch: Pick<
      StatsVisibilityResponse,
      | "statsVisibleToCoders"
      | "otherCodersVisibleToCoders"
      | "otherAnnotationsVisibleToCoders"
      | "otherCommentsVisibleToCoders"
    >,
  ) => {
    if (!projectId || !canManageStatsVisibility) return;

    setSavingStatsVisibility(true);
    setError(null);

    try {
      const response = await fetch("/api/projects/stats-visibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          ...patch,
        }),
      });

      const payload = await parseResponseJson<StatsVisibilityResponse>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update stats visibility.");
      }

      setStatsVisibleToCoders(payload.statsVisibleToCoders !== false);
      setOtherCodersVisibleToCoders(payload.otherCodersVisibleToCoders !== false);
      setOtherAnnotationsVisibleToCoders(payload.otherAnnotationsVisibleToCoders !== false);
      setOtherCommentsVisibleToCoders(payload.otherCommentsVisibleToCoders !== false);
      setCanViewStats(Boolean(payload.canViewStats));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update stats visibility.");
    } finally {
      setSavingStatsVisibility(false);
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

  const statusBadgeClassByStatus: Record<ProjectStatus, string> = {
    active: "border-emerald-200 bg-emerald-50 text-emerald-800",
    closed: "border-amber-200 bg-amber-50 text-amber-800",
    archived: "border-slate-200 bg-slate-100 text-slate-700",
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Project Management</h1>
          <p className="mt-1 text-sm text-gray-600">Manage all project actions from one place.</p>
          <p className="mt-1 text-xs text-gray-500">Current project: {projectName}</p>
        </div>
      </div>

      {projectId && role === "owner" && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Project Lifecycle</h2>
          <p className="mt-1 text-xs text-gray-600">
            Close, archive, or permanently delete this project.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${statusBadgeClassByStatus[projectStatus]}`}
            >
              Status: {projectStatus}
            </span>

            {projectStatus !== "closed" && (
              <button
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 disabled:opacity-50"
                disabled={busyAction === "project-close"}
                onClick={() => void handleProjectLifecycleAction("close")}
                type="button"
              >
                {busyAction === "project-close" ? "Closing..." : "Close Project"}
              </button>
            )}

            {projectStatus !== "archived" && (
              <button
                className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-800 disabled:opacity-50"
                disabled={busyAction === "project-archive"}
                onClick={() => void handleProjectLifecycleAction("archive")}
                type="button"
              >
                {busyAction === "project-archive" ? "Archiving..." : "Archive Project"}
              </button>
            )}

            {projectStatus !== "active" && (
              <button
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 disabled:opacity-50"
                disabled={busyAction === "project-reopen"}
                onClick={() => void handleProjectLifecycleAction("reopen")}
                type="button"
              >
                {busyAction === "project-reopen" ? "Reopening..." : "Reopen Project"}
              </button>
            )}

            <button
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 disabled:opacity-50"
              disabled={busyAction === "project-delete"}
              onClick={() => void handleProjectLifecycleAction("delete")}
              type="button"
            >
              {busyAction === "project-delete" ? "Deleting..." : "Delete Project"}
            </button>
          </div>
        </section>
      )}

      {projectId && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Project Visibility Controls</h2>
          <p className="mt-1 text-xs text-gray-600">
              Configure what coders can see in this project. Owners always see everything.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {canViewStats ? (
              <Link
                className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white"
                href={withProjectQuery("/stats", projectId)}
              >
                Open Project Stats
              </Link>
            ) : (
              <p className="text-xs text-gray-700">Stats are currently hidden from coders.</p>
            )}

            {canManageStatsVisibility && (
              <label className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-800">
                <input
                  checked={statsVisibleToCoders}
                  disabled={savingStatsVisibility}
                  onChange={(event) =>
                    void handleUpdateVisibilitySettings({
                      statsVisibleToCoders: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Visible to coders
              </label>
            )}
          </div>

          {canManageStatsVisibility && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-800">
                <input
                  checked={otherCodersVisibleToCoders}
                  disabled={savingStatsVisibility}
                  onChange={(event) =>
                    void handleUpdateVisibilitySettings({
                      otherCodersVisibleToCoders: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Show other coder identities
              </label>

              <label className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-800">
                <input
                  checked={otherAnnotationsVisibleToCoders}
                  disabled={savingStatsVisibility}
                  onChange={(event) =>
                    void handleUpdateVisibilitySettings({
                      otherAnnotationsVisibleToCoders: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Show other coders' annotations
              </label>

              <label className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-800 sm:col-span-2">
                <input
                  checked={otherCommentsVisibleToCoders}
                  disabled={savingStatsVisibility}
                  onChange={(event) =>
                    void handleUpdateVisibilitySettings({
                      otherCommentsVisibleToCoders: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Show other coders' comments
              </label>
            </div>
          )}
        </section>
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
                  {invite.status === "pending" && (
                    <button
                      className="mt-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 disabled:opacity-50"
                      disabled={busyInviteId === invite.id}
                      onClick={() => void handleRevokeInvite(invite.id)}
                      type="button"
                    >
                      {busyInviteId === invite.id ? "Revoking..." : "Revoke Invite"}
                    </button>
                  )}
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
            Update role and discretionary permission overrides with explicit allow/deny toggles.
          </p>
          <ul className="mt-3 space-y-2">
            {coders.map((coder) => (
              <li key={coder.id} className="rounded-md border border-gray-100 p-3">
                <p className="text-sm font-medium">{coder.display_name}</p>
                <p className="text-xs text-gray-600">{coder.id}</p>

                <div className="mt-2 grid gap-2 md:grid-cols-1">
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

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                      <p className="mb-1 text-xs font-semibold text-emerald-800">Allow</p>
                      <div className="grid gap-1">
                        {PROJECT_PERMISSION_OPTIONS.map((permission) => (
                          <label key={`${coder.id}-allow-${permission.key}`} className="flex items-center gap-2 text-xs text-emerald-900">
                            <input
                              checked={(memberGrantDrafts[coder.id] ?? []).includes(permission.key)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setMemberGrantDrafts((current) =>
                                  togglePermissionDraft(current, coder.id, permission.key, checked),
                                );

                                if (checked) {
                                  setMemberDenyDrafts((current) =>
                                    togglePermissionDraft(current, coder.id, permission.key, false),
                                  );
                                }
                              }}
                              type="checkbox"
                            />
                            {permission.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border border-rose-200 bg-rose-50 p-2">
                      <p className="mb-1 text-xs font-semibold text-rose-800">Deny</p>
                      <div className="grid gap-1">
                        {PROJECT_PERMISSION_OPTIONS.map((permission) => (
                          <label key={`${coder.id}-deny-${permission.key}`} className="flex items-center gap-2 text-xs text-rose-900">
                            <input
                              checked={(memberDenyDrafts[coder.id] ?? []).includes(permission.key)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setMemberDenyDrafts((current) =>
                                  togglePermissionDraft(current, coder.id, permission.key, checked),
                                );

                                if (checked) {
                                  setMemberGrantDrafts((current) =>
                                    togglePermissionDraft(current, coder.id, permission.key, false),
                                  );
                                }
                              }}
                              type="checkbox"
                            />
                            {permission.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
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
