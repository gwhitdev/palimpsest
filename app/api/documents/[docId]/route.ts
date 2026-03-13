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
  content?: string;
  amendmentNote?: string | null;
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

  const { supabase, projectId, role, userId } = auth.context;

  const visibilityResult = await supabase
    .from("project_settings")
    .select("other_annotations_visible_to_coders, other_coders_visible_to_coders")
    .eq("project_id", projectId)
    .maybeSingle();

  if (visibilityResult.error && !isMissingRelationError(visibilityResult.error)) {
    return NextResponse.json({ error: visibilityResult.error.message }, { status: 500 });
  }

  const otherAnnotationsVisibleToCoders =
    isMissingRelationError(visibilityResult.error) ||
    visibilityResult.data?.other_annotations_visible_to_coders !== false;
  const otherCodersVisibleToCoders =
    isMissingRelationError(visibilityResult.error) ||
    visibilityResult.data?.other_coders_visible_to_coders !== false;

  const { data: document, error } = await supabase
    .from("documents")
    .select("id, project_id, title, source, content, amended_at, amended_by, amendment_note, created_at")
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

  const canEditSource = auth.context.role === "owner";
  const canAmendDocument = auth.context.role === "owner";

  let amendedByName: string | null = null;
  if (document.amended_by) {
    const amendedByResult = await supabase
      .from("coders")
      .select("display_name")
      .eq("id", document.amended_by)
      .maybeSingle();

    if (amendedByResult.error) {
      return NextResponse.json({ error: amendedByResult.error.message }, { status: 500 });
    }

    amendedByName = amendedByResult.data?.display_name ?? null;
  }

  const enrichedDocument = {
    ...document,
    amended_by_name: amendedByName,
  };

  const annotatedUsers = [...annotatedByMap.values()];

  const filteredAnnotatedUsers =
    role === "coder" && !otherCodersVisibleToCoders
      ? annotatedUsers.filter((user) => user.id === userId)
      : annotatedUsers;

  const filteredAccessUsers =
    role === "coder" && !otherCodersVisibleToCoders
      ? accessUsers.filter((user) => user.id === userId)
      : accessUsers;

  return NextResponse.json({
    document: enrichedDocument,
    projectId,
    viewerRole: role,
    otherAnnotationsVisibleToCoders,
    otherCodersVisibleToCoders,
    annotatedUsers: filteredAnnotatedUsers,
    accessUsers: filteredAccessUsers,
    canEditSource,
    canAmendDocument,
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { docId } = await params;
  const body = (await request.json()) as UpdateDocumentBody;

  const auth = await resolveProjectContext(extractProjectId(request, body), "view_documents");
  if (!auth.ok) return auth.response;

  const access = await requireDocumentAccess(auth.context, docId);
  if (!access.ok) return access.response;

  const hasSourceUpdate = Object.prototype.hasOwnProperty.call(body, "source");
  const hasContentUpdate = Object.prototype.hasOwnProperty.call(body, "content");

  if (!hasSourceUpdate && !hasContentUpdate) {
    return NextResponse.json(
      { error: "Provide at least one field to update: source or content." },
      { status: 400 },
    );
  }

  if (hasSourceUpdate && typeof body.source !== "string" && body.source !== null) {
    return NextResponse.json({ error: "source must be a string or null." }, { status: 400 });
  }

  if (hasContentUpdate && typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string." }, { status: 400 });
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "amendmentNote") &&
    typeof body.amendmentNote !== "string" &&
    body.amendmentNote !== null
  ) {
    return NextResponse.json({ error: "amendmentNote must be a string or null." }, { status: 400 });
  }

  const { supabase, projectId, userId, role } = auth.context;

  const currentDocumentResult = await supabase
    .from("documents")
    .select("id, project_id, title, source, content, amended_at, amended_by, amendment_note, created_at")
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

  if (role !== "owner") {
    return forbiddenResponse("Only project owners can add/update source or amend document content.");
  }

  const updatePayload: Record<string, unknown> = {};
  if (hasSourceUpdate) {
    const normalizedSource = typeof body.source === "string" ? body.source.trim() || null : null;
    updatePayload.source = normalizedSource;
  }

  if (hasContentUpdate) {
    const nextContent = body.content as string;
    const currentContent = currentDocumentResult.data.content;
    if (nextContent !== currentContent) {
      updatePayload.content = nextContent;
      updatePayload.amended_at = new Date().toISOString();
      updatePayload.amended_by = userId;

      const normalizedNote =
        typeof body.amendmentNote === "string"
          ? body.amendmentNote.trim() || null
          : body.amendmentNote === null
            ? null
            : null;

      updatePayload.amendment_note = normalizedNote;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    let amendedByName: string | null = null;
    if (currentDocumentResult.data.amended_by) {
      const amendedByResult = await supabase
        .from("coders")
        .select("display_name")
        .eq("id", currentDocumentResult.data.amended_by)
        .maybeSingle();

      if (amendedByResult.error) {
        return NextResponse.json({ error: amendedByResult.error.message }, { status: 500 });
      }

      amendedByName = amendedByResult.data?.display_name ?? null;
    }

    return NextResponse.json({
      document: {
        ...currentDocumentResult.data,
        amended_by_name: amendedByName,
      },
      projectId,
      amended: Boolean(currentDocumentResult.data.amended_at),
      contentChanged: false,
    });
  }

  const updateResult = await supabase
    .from("documents")
    .update(updatePayload)
    .eq("id", docId)
    .eq("project_id", projectId)
    .select("id, project_id, title, source, content, amended_at, amended_by, amendment_note, created_at")
    .single();

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  let amendedByName: string | null = null;
  if (updateResult.data.amended_by) {
    const amendedByResult = await supabase
      .from("coders")
      .select("display_name")
      .eq("id", updateResult.data.amended_by)
      .maybeSingle();

    if (amendedByResult.error) {
      return NextResponse.json({ error: amendedByResult.error.message }, { status: 500 });
    }

    amendedByName = amendedByResult.data?.display_name ?? null;
  }

  return NextResponse.json({
    document: {
      ...updateResult.data,
      amended_by_name: amendedByName,
    },
    projectId,
    amended: Boolean(updateResult.data.amended_at),
    contentChanged: Boolean(updatePayload.content),
  });
}
