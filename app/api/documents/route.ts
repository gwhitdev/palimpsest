import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isAmbiguousFunctionError,
  isMissingFunctionError,
  isMissingRelationError,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type DocumentRow = {
  id: string;
  project_id: string;
  title: string;
  source: string | null;
  content: string;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role, userId } = auth.context;

  const manageDocsPermission = await supabase.rpc("project_has_permission", {
    target_project: projectId,
    target_user: userId,
    requested_permission: "manage_documents",
  });

  if (manageDocsPermission.error) {
    if (
      isMissingRelationError(manageDocsPermission.error) ||
      isMissingFunctionError(manageDocsPermission.error) ||
      isAmbiguousFunctionError(manageDocsPermission.error)
    ) {
      return schemaNotReadyResponse();
    }

    return NextResponse.json({ error: manageDocsPermission.error.message }, { status: 500 });
  }

  const canSeeAllDocs = role === "owner" || Boolean(manageDocsPermission.data);

  if (canSeeAllDocs) {
    const { data: docs, error: docsError } = await supabase
      .from("documents")
      .select("id, project_id, title, source, content, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (isMissingRelationError(docsError)) {
      return schemaNotReadyResponse();
    }

    if (docsError) {
      return NextResponse.json({ error: docsError.message }, { status: 500 });
    }

    const documents = ((docs ?? []) as DocumentRow[]).map((doc) => ({ ...doc, assignedCoderIds: [] }));
    return NextResponse.json({ documents, projectId });
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from("document_assignments")
    .select("document_id")
    .eq("project_id", projectId)
    .eq("coder_id", userId);

  if (isMissingRelationError(assignmentError)) {
    return schemaNotReadyResponse();
  }

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError.message }, { status: 500 });
  }

  const docIds = [...new Set((assignments ?? []).map((row) => row.document_id))];
  if (docIds.length === 0) {
    return NextResponse.json({ documents: [], projectId });
  }

  const { data: docs, error: docsError } = await supabase
    .from("documents")
    .select("id, project_id, title, source, content, created_at")
    .eq("project_id", projectId)
    .in("id", docIds)
    .order("created_at", { ascending: false });

  if (isMissingRelationError(docsError)) {
    return schemaNotReadyResponse();
  }

  if (docsError) {
    return NextResponse.json({ error: docsError.message }, { status: 500 });
  }

  const documents = ((docs ?? []) as DocumentRow[]).map((doc) => ({ ...doc, assignedCoderIds: [] }));
  return NextResponse.json({ documents, projectId });
}
