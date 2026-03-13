import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  requireDocumentAccess,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";
import { AnnotationCodeChange } from "@/lib/types";

const setupHint = "Run supabase/annotation_change_history.sql and notify PostgREST schema reload.";

type AnnotationChangeRow = AnnotationCodeChange;

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role, userId } = auth.context;
  const docId = request.nextUrl.searchParams.get("docId");

  if (!docId) {
    return NextResponse.json({ error: "docId is required." }, { status: 400 });
  }

  const access = await requireDocumentAccess(auth.context, docId);
  if (!access.ok) return access.response;

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

  const restrictToOwnChanges = role === "coder" && !otherAnnotationsVisibleToCoders;
  const hideOtherCoderIdentity = role === "coder" && !otherCodersVisibleToCoders;

  let query = supabase
    .from("annotation_change_history")
    .select(
      "id, annotation_id, project_id, document_id, changed_by, changed_by_name, previous_tech_id, next_tech_id, changed_at",
    )
    .eq("project_id", projectId)
    .eq("document_id", docId)
    .order("changed_at", { ascending: false });

  if (restrictToOwnChanges) {
    query = query.eq("changed_by", userId);
  }

  const historyResult = await query;

  if (isMissingRelationError(historyResult.error)) {
    return NextResponse.json(
      {
        changes: [],
        projectId,
        documentId: docId,
        setupRequired: true,
        setupHint,
      },
      { status: 200 },
    );
  }

  if (historyResult.error) {
    return NextResponse.json({ error: historyResult.error.message }, { status: 500 });
  }

  const rows = ((historyResult.data ?? []) as AnnotationChangeRow[]).map((row) => {
    if (!hideOtherCoderIdentity || row.changed_by === userId) {
      return row;
    }

    return {
      ...row,
      changed_by_name: "Another coder",
    };
  });

  return NextResponse.json({ changes: rows, projectId, documentId: docId });
}
