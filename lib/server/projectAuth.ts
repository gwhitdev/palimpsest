import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const PROJECT_PERMISSIONS = [
  "manage_project",
  "manage_members",
  "manage_permissions",
  "invite_members",
  "manage_documents",
  "view_documents",
  "annotate",
  "view_stats",
  "export_data",
] as const;

export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];

const setupHint =
  "Run supabase/base_schema.sql, then supabase/project_multitenancy_migration.sql, then supabase/document_assignments.sql.";

type PgErrorLike = {
  code?: string;
  message?: string;
};

export type ProjectContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  projectId: string;
  role: "owner" | "coder";
};

export type ProjectAuthResult =
  | {
      ok: true;
      context: ProjectContext;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export function isMissingRelationError(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation\s+\"?.+\"?\s+does not exist/i.test(error.message ?? "");
}

export function isMissingFunctionError(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    /Could not find the function public\.project_has_permission\(/i.test(error.message ?? "")
  );
}

export function isAmbiguousFunctionError(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;
  return /Could not choose the best candidate function between:/i.test(error.message ?? "");
}

export function schemaNotReadyResponse() {
  return NextResponse.json(
    {
      error: "Project schema is not set up.",
      setupRequired: true,
      setupHint,
    },
    { status: 400 },
  );
}

export function forbiddenResponse(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function unauthorisedResponse() {
  return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
}

export function isProjectPermission(value: string): value is ProjectPermission {
  return (PROJECT_PERMISSIONS as readonly string[]).includes(value);
}

export function extractProjectId(request: NextRequest, body?: unknown): string | null {
  const fromQuery = request.nextUrl.searchParams.get("projectId");
  if (fromQuery) return fromQuery;

  const fromHeader = request.headers.get("x-project-id");
  if (fromHeader) return fromHeader;

  if (body && typeof body === "object" && "projectId" in body) {
    const value = (body as { projectId?: unknown }).projectId;
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  return null;
}

export async function resolveProjectContext(
  projectIdFromRequest: string | null,
  requiredPermission?: ProjectPermission,
): Promise<ProjectAuthResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, response: unauthorisedResponse() };
  }

  const membershipQuery = supabase
    .from("project_memberships")
    .select("project_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const membershipResult = projectIdFromRequest
    ? await membershipQuery.eq("project_id", projectIdFromRequest).limit(1).maybeSingle()
    : await membershipQuery.limit(1).maybeSingle();

  if (isMissingRelationError(membershipResult.error)) {
    return { ok: false, response: schemaNotReadyResponse() };
  }

  if (membershipResult.error) {
    return {
      ok: false,
      response: NextResponse.json({ error: membershipResult.error.message }, { status: 500 }),
    };
  }

  const membership = membershipResult.data;
  if (!membership) {
    return { ok: false, response: forbiddenResponse("You are not a member of any active project.") };
  }

  const projectId = membership.project_id;
  const role = membership.role as "owner" | "coder";

  if (requiredPermission) {
    const permissionResult = await supabase.rpc("project_has_permission", {
      target_project: projectId,
      target_user: user.id,
      requested_permission: requiredPermission,
    });

    if (permissionResult.error) {
      if (
        isMissingRelationError(permissionResult.error) ||
        isMissingFunctionError(permissionResult.error) ||
        isAmbiguousFunctionError(permissionResult.error)
      ) {
        return { ok: false, response: schemaNotReadyResponse() };
      }

      return {
        ok: false,
        response: NextResponse.json({ error: permissionResult.error.message }, { status: 500 }),
      };
    }

    if (!permissionResult.data) {
      return { ok: false, response: forbiddenResponse() };
    }
  }

  return {
    ok: true,
    context: {
      supabase,
      userId: user.id,
      projectId,
      role,
    },
  };
}
