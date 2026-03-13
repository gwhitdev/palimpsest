import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
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

  const shouldRestrictToOwnAnnotations =
    role === "coder" && !otherAnnotationsVisibleToCoders;
  const shouldHideOtherCoderIdentity =
    role === "coder" && !otherCodersVisibleToCoders && !shouldRestrictToOwnAnnotations;

  const anonymizeOtherCoderIdentity =
    <T extends { coder_id: string; coder_name: string }>(rows: T[]) =>
      rows.map((row) =>
        row.coder_id === userId
          ? row
          : {
              ...row,
              coder_id: "hidden-coder",
              coder_name: "Another coder",
            },
      );

  if (docId && docId !== "all") {
    const access = await requireDocumentAccess(auth.context, docId);
    if (!access.ok) return access.response;

    let query = supabase
      .from("annotations")
      .select("*")
      .eq("project_id", projectId)
      .eq("document_id", docId)
      .order("created_at", { ascending: true });

    if (shouldRestrictToOwnAnnotations) {
      query = query.eq("coder_id", userId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const annotations = shouldHideOtherCoderIdentity
      ? anonymizeOtherCoderIdentity(data ?? [])
      : data ?? [];

    return NextResponse.json({ annotations, projectId });
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

    let query = supabase
      .from("annotations")
      .select("*")
      .eq("project_id", projectId)
      .in("document_id", documentIds)
      .order("created_at", { ascending: true });

    if (shouldRestrictToOwnAnnotations) {
      query = query.eq("coder_id", userId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const annotations = shouldHideOtherCoderIdentity
      ? anonymizeOtherCoderIdentity(data ?? [])
      : data ?? [];

    return NextResponse.json({ annotations, projectId });
  }

  let query = supabase
    .from("annotations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (shouldRestrictToOwnAnnotations) {
    query = query.eq("coder_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const annotations = shouldHideOtherCoderIdentity
    ? anonymizeOtherCoderIdentity(data ?? [])
    : data ?? [];

  return NextResponse.json({ annotations, projectId });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, userId, projectId } = auth.context;
  const documentId = typeof body.document_id === "string" ? body.document_id : null;
  const startOffset = typeof body.start_offset === "number" ? body.start_offset : null;
  const endOffset = typeof body.end_offset === "number" ? body.end_offset : null;

  const requestedTechIds = Array.isArray(body.tech_ids)
    ? body.tech_ids
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : typeof body.tech_id === "string"
      ? [body.tech_id.trim()]
      : [];

  const techIds = [...new Set(requestedTechIds)];

  if (!documentId) {
    return NextResponse.json({ error: "document_id is required." }, { status: 400 });
  }

  if (techIds.length === 0) {
    return NextResponse.json({ error: "At least one technique ID is required." }, { status: 400 });
  }

  if (
    startOffset === null ||
    endOffset === null ||
    startOffset < 0 ||
    endOffset <= startOffset
  ) {
    return NextResponse.json(
      { error: "Valid start_offset and end_offset are required." },
      { status: 400 },
    );
  }

  const access = await requireDocumentAccess(auth.context, documentId);
  if (!access.ok) return access.response;

  const overlappingResult = await supabase
    .from("annotations")
    .select("id")
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .eq("coder_id", userId)
    .lt("start_offset", endOffset)
    .gt("end_offset", startOffset);

  if (overlappingResult.error) {
    return NextResponse.json({ error: overlappingResult.error.message }, { status: 500 });
  }

  const overlappingIds = (overlappingResult.data ?? []).map((row) => row.id);
  if (overlappingIds.length > 0) {
    const deleteOverlapResult = await supabase
      .from("annotations")
      .delete()
      .eq("project_id", projectId)
      .eq("document_id", documentId)
      .eq("coder_id", userId)
      .in("id", overlappingIds);

    if (deleteOverlapResult.error) {
      return NextResponse.json({ error: deleteOverlapResult.error.message }, { status: 500 });
    }
  }

  const annotationInput = { ...body };
  delete annotationInput.projectId;
  delete annotationInput.tech_ids;
  delete annotationInput.tech_id;

  const insertRows = techIds.map((techId) => ({
    ...annotationInput,
    project_id: projectId,
    coder_id: userId,
    document_id: documentId,
    tech_id: techId,
    start_offset: startOffset,
    end_offset: endOffset,
  }));

  const { data, error } = await supabase.from("annotations").insert(insertRows).select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    annotations: data ?? [],
    annotation: data?.[0] ?? null,
    replacedAnnotationCount: overlappingIds.length,
    projectId,
  });
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

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as {
    id?: string;
    projectId?: string;
    tech_id?: string;
  };

  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId } = auth.context;
  const { id } = body;
  const nextTechId = typeof body.tech_id === "string" ? body.tech_id.trim() : "";

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  if (!nextTechId) {
    return NextResponse.json({ error: "tech_id is required." }, { status: 400 });
  }

  const annotationResult = await supabase
    .from("annotations")
    .select(
      "id, project_id, document_id, coder_id, coder_name, tech_id, quoted_text, start_offset, end_offset, is_ai, accepted, created_at",
    )
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
    return forbiddenResponse("You can only edit your own annotations.");
  }

  const previousTechId = annotationResult.data.tech_id;
  if (previousTechId === nextTechId) {
    return NextResponse.json({
      annotation: annotationResult.data,
      previousTechId,
      updatedTechId: nextTechId,
      changed: false,
      projectId,
    });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const privilegedClient =
    serviceRoleKey && supabaseUrl
      ? createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        })
      : null;

  const updateClient = privilegedClient ?? supabase;

  const updateResult = await updateClient
    .from("annotations")
    .update({ tech_id: nextTechId })
    .eq("id", id)
    .eq("project_id", projectId)
    .select(
      "id, project_id, document_id, coder_id, coder_name, tech_id, quoted_text, start_offset, end_offset, is_ai, accepted, created_at",
    );

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  const updatedAnnotation = (updateResult.data ?? [])[0] ?? null;
  if (!updatedAnnotation || updatedAnnotation.tech_id !== nextTechId) {
    return NextResponse.json(
      {
        error:
          "Annotation update did not persist. Apply the annotations update policy migration or configure SUPABASE_SERVICE_ROLE_KEY for server-side updates.",
      },
      { status: 409 },
    );
  }

  const coderResult = await supabase
    .from("coders")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  if (coderResult.error) {
    return NextResponse.json({ error: coderResult.error.message }, { status: 500 });
  }

  const changedByName = coderResult.data?.display_name ?? annotationResult.data.coder_name ?? "Unknown";

  const historyInsertResult = await supabase.from("annotation_change_history").insert({
    annotation_id: id,
    project_id: projectId,
    document_id: annotationResult.data.document_id,
    changed_by: userId,
    changed_by_name: changedByName,
    previous_tech_id: previousTechId,
    next_tech_id: updatedAnnotation.tech_id,
  });

  if (historyInsertResult.error && !isMissingRelationError(historyInsertResult.error)) {
    return NextResponse.json({ error: historyInsertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    annotation: updatedAnnotation,
    previousTechId,
    updatedTechId: updatedAnnotation.tech_id,
    changed: true,
    historyTracked: !isMissingRelationError(historyInsertResult.error),
    projectId,
  });
}
