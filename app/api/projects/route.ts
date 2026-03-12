import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  extractProjectId,
  isMissingFunctionError,
  isMissingRelationError,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type MembershipRow = {
  project_id: string;
  role: "owner" | "coder";
  created_at: string;
  projects: { name: string | null }[] | { name: string | null } | null;
};

type CreateProjectBody = {
  name?: string;
};

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request));
  if (!auth.ok) return auth.response;

  const { supabase, userId, projectId, role } = auth.context;

  const membershipsResult = await supabase
    .from("project_memberships")
    .select("project_id, role, created_at, projects(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

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
      return NextResponse.json({ project: createdRow });
    }
  }

  const projectInsert = await supabase
    .from("projects")
    .insert({
      name: projectName,
      created_by: user.id,
    })
    .select("id, name, created_by, created_at")
    .single();

  if (isMissingRelationError(projectInsert.error)) {
    return schemaNotReadyResponse();
  }

  if (projectInsert.error) {
    return NextResponse.json({ error: projectInsert.error.message }, { status: 500 });
  }

  return NextResponse.json({ project: projectInsert.data });
}
