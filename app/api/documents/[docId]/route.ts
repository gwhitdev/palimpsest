import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  forbiddenResponse,
  isAmbiguousFunctionError,
  isMissingFunctionError,
  isMissingRelationError,
  requireDocumentAccess,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type Params = {
  params: Promise<{ docId: string }>;
};

type UpdateDocumentBody = {
  projectId?: string;
  source?: string | null;
};

type UserRole = "owner" | "coder";

type UserSummary = {
  id: string;
  display_name: string;
  role?: UserRole;
};

export async function GET(request: NextRequest, { params }: Params) {
  const { docId } = await params;

  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const access = await requireDocumentAccess(auth.context, docId);
  if (!access.ok) return access.response;

  const { supabase, projectId } = auth.context;

  const { data: document, error } = await supabase
    .from("documents")
    .select("id, project_id, title, source, content, created_at")
    .eq("id", docId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (isMissingRelationError(error)) {
    return schemaNotReadyResponse();
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const annotationsResult = await supabase
    .from("annotations")
    .select("coder_id, coder_name, created_at")
    .eq("project_id", projectId)
    .eq("document_id", docId)
    .order("created_at", { ascending: false });

  if (annotationsResult.error) {
    return NextResponse.json({ error: annotationsResult.error.message }, { status: 500 });
  }

  const annotatedByMap = new Map<string, UserSummary>();
  (annotationsResult.data ?? []).forEach((row) => {
    if (!annotatedByMap.has(row.coder_id)) {
      annotatedByMap.set(row.coder_id, {
        id: row.coder_id,
        display_name: row.coder_name,
      });
    }
  });

  const ownerMembershipsResult = await supabase
    .from("project_memberships")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("status", "active")
    .eq("role", "owner");

  if (ownerMembershipsResult.error) {
    return NextResponse.json({ error: ownerMembershipsResult.error.message }, { status: 500 });
  }

  const assignmentResult = await supabase
    .from("document_assignments")
    .select("coder_id")
    .eq("project_id", projectId)
    .eq("document_id", docId);

  if (assignmentResult.error && !isMissingRelationError(assignmentResult.error)) {
    return NextResponse.json({ error: assignmentResult.error.message }, { status: 500 });
  }

  const accessUserIds = new Set<string>(
    (ownerMembershipsResult.data ?? []).map((row) => row.user_id),
  );
  (assignmentResult.data ?? []).forEach((row) => accessUserIds.add(row.coder_id));

  let accessUsers: UserSummary[] = [];
  if (accessUserIds.size > 0) {
    const ids = [...accessUserIds];
    const [profileResult, membershipResult] = await Promise.all([
      supabase.from("coders").select("id, display_name").in("id", ids),
      supabase
        .from("project_memberships")
        .select("user_id, role")
        .eq("project_id", projectId)
        .eq("status", "active")
        .in("user_id", ids),
    ]);

    if (profileResult.error) {
      return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
    }

    if (membershipResult.error) {
      return NextResponse.json({ error: membershipResult.error.message }, { status: 500 });
    }

    const roleById = new Map<string, UserRole>(
      (membershipResult.data ?? []).map((row) => [row.user_id, row.role as UserRole]),
    );

    accessUsers = (profileResult.data ?? []).map((profile) => ({
      id: profile.id,
      display_name: profile.display_name,
      role: roleById.get(profile.id),
    }));

    accessUsers.sort((a, b) => {
      if ((a.role === "owner") !== (b.role === "owner")) {
        return a.role === "owner" ? -1 : 1;
      }
      return a.display_name.localeCompare(b.display_name);
    });
  }

  const manageDocsPermissionResult = await supabase.rpc("project_has_permission", {
    target_project: projectId,
    target_user: auth.context.userId,
    requested_permission: "manage_documents",
  });

  if (manageDocsPermissionResult.error) {
    if (
      isMissingRelationError(manageDocsPermissionResult.error) ||
      isMissingFunctionError(manageDocsPermissionResult.error) ||
      isAmbiguousFunctionError(manageDocsPermissionResult.error)
    ) {
      return schemaNotReadyResponse();
    }

    return NextResponse.json({ error: manageDocsPermissionResult.error.message }, { status: 500 });
  }

  const canEditSource =
    auth.context.role === "owner" ||
    Boolean(manageDocsPermissionResult.data) ||
    !document.source;

  return NextResponse.json({
    document,
    projectId,
    annotatedUsers: [...annotatedByMap.values()],
    accessUsers,
    canEditSource,
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { docId } = await params;
  const body = (await request.json()) as UpdateDocumentBody;

  const auth = await resolveProjectContext(extractProjectId(request, body), "view_documents");
  if (!auth.ok) return auth.response;

  const access = await requireDocumentAccess(auth.context, docId);
  if (!access.ok) return access.response;

  if (typeof body.source !== "string" && body.source !== null) {
    return NextResponse.json({ error: "source must be a string or null." }, { status: 400 });
  }

  const { supabase, projectId, userId, role } = auth.context;
  const normalizedSource = typeof body.source === "string" ? body.source.trim() || null : null;

  const currentDocumentResult = await supabase
    .from("documents")
    .select("id, source")
    .eq("id", docId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (isMissingRelationError(currentDocumentResult.error)) {
    return schemaNotReadyResponse();
  }

  if (currentDocumentResult.error) {
    return NextResponse.json({ error: currentDocumentResult.error.message }, { status: 500 });
  }

  if (!currentDocumentResult.data) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const manageDocsPermissionResult = await supabase.rpc("project_has_permission", {
    target_project: projectId,
    target_user: userId,
    requested_permission: "manage_documents",
  });

  if (manageDocsPermissionResult.error) {
    if (
      isMissingRelationError(manageDocsPermissionResult.error) ||
      isMissingFunctionError(manageDocsPermissionResult.error) ||
      isAmbiguousFunctionError(manageDocsPermissionResult.error)
    ) {
      return schemaNotReadyResponse();
    }

    return NextResponse.json({ error: manageDocsPermissionResult.error.message }, { status: 500 });
  }

  const canManageDocuments = role === "owner" || Boolean(manageDocsPermissionResult.data);
  if (!canManageDocuments && currentDocumentResult.data.source) {
    return forbiddenResponse("Only document managers can update an existing source.");
  }

  const updateResult = await supabase
    .from("documents")
    .update({ source: normalizedSource })
    .eq("id", docId)
    .eq("project_id", projectId)
    .select("id, project_id, title, source, content, created_at")
    .single();

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ document: updateResult.data, projectId });
}
