import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
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
