import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  requireDocumentAccess,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type Params = {
  params: Promise<{ docId: string }>;
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

  return NextResponse.json({ document, projectId });
}
