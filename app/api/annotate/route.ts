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

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role, userId } = auth.context;
  const docId = request.nextUrl.searchParams.get("docId");

  if (docId && docId !== "all") {
    const access = await requireDocumentAccess(auth.context, docId);
    if (!access.ok) return access.response;

    const { data, error } = await supabase
      .from("annotations")
      .select("*")
      .eq("project_id", projectId)
      .eq("document_id", docId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ annotations: data ?? [], projectId });
  }

  const managerPermissionResult = await supabase.rpc("project_has_permission", {
    target_project: projectId,
    target_user: userId,
    requested_permission: "manage_documents",
  });

  if (managerPermissionResult.error) {
    if (
      isMissingRelationError(managerPermissionResult.error) ||
      isMissingFunctionError(managerPermissionResult.error) ||
      isAmbiguousFunctionError(managerPermissionResult.error)
    ) {
      return schemaNotReadyResponse();
    }

    return NextResponse.json({ error: managerPermissionResult.error.message }, { status: 500 });
  }

  const canSeeAllDocs = role === "owner" || Boolean(managerPermissionResult.data);

  if (!canSeeAllDocs) {
    const assignmentsResult = await supabase
      .from("document_assignments")
      .select("document_id")
      .eq("project_id", projectId)
      .eq("coder_id", userId);

    if (isMissingRelationError(assignmentsResult.error)) {
      return schemaNotReadyResponse();
    }

    if (assignmentsResult.error) {
      return NextResponse.json({ error: assignmentsResult.error.message }, { status: 500 });
    }

    const documentIds = [...new Set((assignmentsResult.data ?? []).map((row) => row.document_id))];
    if (documentIds.length === 0) {
      return NextResponse.json({ annotations: [], projectId });
    }

    const { data, error } = await supabase
      .from("annotations")
      .select("*")
      .eq("project_id", projectId)
      .in("document_id", documentIds)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ annotations: data ?? [], projectId });
  }

  const query = supabase
    .from("annotations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ annotations: data ?? [], projectId });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, userId, projectId } = auth.context;
  const documentId = typeof body.document_id === "string" ? body.document_id : null;

  if (!documentId) {
    return NextResponse.json({ error: "document_id is required." }, { status: 400 });
  }

  const access = await requireDocumentAccess(auth.context, documentId);
  if (!access.ok) return access.response;

  const annotationInput = { ...body };
  delete annotationInput.projectId;

  const { data, error } = await supabase
    .from("annotations")
    .insert({ ...annotationInput, project_id: projectId, coder_id: userId })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ annotation: data, projectId });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { id?: string; projectId?: string };
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId } = auth.context;
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const annotationResult = await supabase
    .from("annotations")
    .select("id, document_id, coder_id")
    .eq("id", id)
    .eq("project_id", projectId)
    .maybeSingle();

  if (annotationResult.error) {
    return NextResponse.json({ error: annotationResult.error.message }, { status: 500 });
  }

  if (!annotationResult.data) {
    return NextResponse.json({ error: "Annotation not found." }, { status: 404 });
  }

  const access = await requireDocumentAccess(auth.context, annotationResult.data.document_id);
  if (!access.ok) return access.response;

  const managerPermissionResult = await supabase.rpc("project_has_permission", {
    target_project: projectId,
    target_user: userId,
    requested_permission: "manage_documents",
  });

  if (managerPermissionResult.error) {
    if (
      isMissingRelationError(managerPermissionResult.error) ||
      isMissingFunctionError(managerPermissionResult.error) ||
      isAmbiguousFunctionError(managerPermissionResult.error)
    ) {
      return schemaNotReadyResponse();
    }

    return NextResponse.json({ error: managerPermissionResult.error.message }, { status: 500 });
  }

  const canManageDocuments = Boolean(managerPermissionResult.data) || auth.context.role === "owner";
  if (!canManageDocuments && annotationResult.data.coder_id !== userId) {
    return forbiddenResponse("You can only remove your own annotations.");
  }

  const { error } = await supabase
    .from("annotations")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, projectId });
}
