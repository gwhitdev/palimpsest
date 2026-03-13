import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  extractProjectId,
  forbiddenResponse,
  isMissingFunctionError,
  isMissingRelationError,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type ProjectStatus = "active" | "closed" | "archived";
type ProjectLifecycleAction = "close" | "archive" | "reopen";

type MembershipRow = {
  project_id: string;
  role: "owner" | "coder";
  created_at: string;
  projects:
    | { name: string | null; status?: ProjectStatus | null }[]
    | { name: string | null; status?: ProjectStatus | null }
    | null;
};

type CreateProjectBody = {
  name?: string;
};

type UpdateProjectBody = {
  projectId?: string;
  action?: ProjectLifecycleAction;
};

type DeleteProjectBody = {
  projectId?: string;
};

type PgErrorLike = {
  code?: string;
  message?: string;
};

const lifecycleStatusByAction: Record<ProjectLifecycleAction, ProjectStatus> = {
  close: "closed",
  archive: "archived",
  reopen: "active",
};

function isProjectLifecycleAction(value: string | undefined): value is ProjectLifecycleAction {
  return value === "close" || value === "archive" || value === "reopen";
}

function isMissingProjectStatusColumnError(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column\s+projects\.status\s+does not exist/i.test(error.message ?? "") ||
    /Could not find the 'status' column of 'projects'/i.test(error.message ?? "")
  );
}

async function readOptionalJsonBody<T>(request: NextRequest): Promise<T | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function fetchMemberships(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const membershipsWithStatus = await supabase
    .from("project_memberships")
    .select("project_id, role, created_at, projects(name, status)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (isMissingProjectStatusColumnError(membershipsWithStatus.error)) {
    return await supabase
      .from("project_memberships")
      .select("project_id, role, created_at, projects(name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
  }

  return membershipsWithStatus;
}

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request));
  if (!auth.ok) return auth.response;

  const { supabase, userId, projectId, role } = auth.context;

  const membershipsResult = await fetchMemberships(supabase, userId);

  if (isMissingRelationError(membershipsResult.error)) {
    return schemaNotReadyResponse();
  }

  if (membershipsResult.error) {
    return NextResponse.json({ error: membershipsResult.error.message }, { status: 500 });
  }

  const projects = ((membershipsResult.data ?? []) as MembershipRow[]).map((membership) => {
    const projectMeta = Array.isArray(membership.projects) ? membership.projects[0] : membership.projects;

    return {
      id: membership.project_id,
      name: projectMeta?.name ?? "Untitled Project",
      status: projectMeta?.status ?? "active",
      role: membership.role,
      created_at: membership.created_at,
    };
  });

  return NextResponse.json({
    currentProjectId: projectId,
    currentRole: role,
    projects,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = (await request.json()) as CreateProjectBody;
  const projectName = body.name?.trim();

  if (!projectName) {
    return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  }

  const createViaRpc = await supabase.rpc("create_project_for_current_user", {
    project_name: projectName,
  });

  if (isMissingRelationError(createViaRpc.error)) {
    return schemaNotReadyResponse();
  }

  if (createViaRpc.error && !isMissingFunctionError(createViaRpc.error)) {
    return NextResponse.json({ error: createViaRpc.error.message }, { status: 500 });
  }

  if (!createViaRpc.error) {
    const createdRow = Array.isArray(createViaRpc.data) ? createViaRpc.data[0] : createViaRpc.data;
    if (createdRow) {
      return NextResponse.json({
        project: {
          ...createdRow,
          status: "active",
        },
      });
    }
  }

  const projectInsert = await supabase
    .from("projects")
    .insert({
      name: projectName,
      created_by: user.id,
    })
    .select("id, name, status, created_by, created_at")
    .single();

  if (isMissingRelationError(projectInsert.error)) {
    return schemaNotReadyResponse();
  }

  if (projectInsert.error) {
    return NextResponse.json({ error: projectInsert.error.message }, { status: 500 });
  }

  return NextResponse.json({ project: projectInsert.data });
}

export async function PATCH(request: NextRequest) {
  const body = (await readOptionalJsonBody<UpdateProjectBody>(request)) ?? {};

  if (!isProjectLifecycleAction(body.action)) {
    return NextResponse.json(
      { error: "action is required and must be one of: close, archive, reopen." },
      { status: 400 },
    );
  }

  const auth = await resolveProjectContext(extractProjectId(request, body), "manage_project");
  if (!auth.ok) return auth.response;

  if (auth.context.role !== "owner") {
    return forbiddenResponse("Only project owners can change project lifecycle status.");
  }

  const nextStatus = lifecycleStatusByAction[body.action];
  const updateResult = await auth.context.supabase
    .from("projects")
    .update({ status: nextStatus })
    .eq("id", auth.context.projectId)
    .select("id, name, status, created_at")
    .single();

  if (isMissingRelationError(updateResult.error)) {
    return schemaNotReadyResponse();
  }

  if (isMissingProjectStatusColumnError(updateResult.error)) {
    return NextResponse.json(
      {
        error: "Project lifecycle schema is not set up.",
        setupRequired: true,
        setupHint: "Run supabase/project_lifecycle.sql.",
      },
      { status: 400 },
    );
  }

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ project: updateResult.data });
}

export async function DELETE(request: NextRequest) {
  const body = (await readOptionalJsonBody<DeleteProjectBody>(request)) ?? {};
  const auth = await resolveProjectContext(extractProjectId(request, body), "manage_project");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role, userId } = auth.context;

  if (role !== "owner") {
    return forbiddenResponse("Only project owners can delete projects.");
  }

  const deleteResult = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .select("id")
    .maybeSingle();

  if (isMissingRelationError(deleteResult.error)) {
    return schemaNotReadyResponse();
  }

  if (deleteResult.error) {
    return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
  }

  const membershipsResult = await fetchMemberships(supabase, userId);

  if (isMissingRelationError(membershipsResult.error)) {
    return schemaNotReadyResponse();
  }

  if (membershipsResult.error) {
    return NextResponse.json({ error: membershipsResult.error.message }, { status: 500 });
  }

  const projects = ((membershipsResult.data ?? []) as MembershipRow[]).map((membership) => {
    const projectMeta = Array.isArray(membership.projects) ? membership.projects[0] : membership.projects;

    return {
      id: membership.project_id,
      name: projectMeta?.name ?? "Untitled Project",
      status: projectMeta?.status ?? "active",
      role: membership.role,
      created_at: membership.created_at,
    };
  });

  return NextResponse.json({
    deletedProjectId: projectId,
    nextProjectId: projects[0]?.id ?? null,
    projects,
  });
}
