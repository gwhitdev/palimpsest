import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";
import { sanitizePlainTextInput } from "@/lib/security/sanitizeText";

type DocumentInsertBody = {
  title?: string;
  source?: string;
  content?: string;
  assignedCoderIds?: string[];
};

type AssignmentRow = {
  document_id: string;
  coder_id: string;
};

const setupHint =
  "Run supabase/base_schema.sql, then supabase/project_multitenancy_migration.sql, then supabase/document_assignments.sql.";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "manage_documents");
  if (!auth.ok) return auth.response;

  const { projectId, supabase } = auth.context;

  const { data: docs, error: docsError } = await supabase
    .from("documents")
    .select("id, project_id, title, source, content, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (docsError) {
    if (isMissingRelationError(docsError)) {
      return schemaNotReadyResponse();
    }
    return NextResponse.json({ error: docsError.message }, { status: 500 });
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from("document_assignments")
    .select("project_id, document_id, coder_id")
    .eq("project_id", projectId);

  if (assignmentError && !isMissingRelationError(assignmentError)) {
    return NextResponse.json({ error: assignmentError.message }, { status: 500 });
  }

  const byDoc = new Map<string, string[]>();
  if (assignments) {
    (assignments as AssignmentRow[]).forEach((row) => {
      const current = byDoc.get(row.document_id) ?? [];
      current.push(row.coder_id);
      byDoc.set(row.document_id, current);
    });
  }

  const documents = (docs ?? []).map((doc) => ({
    ...doc,
    assignedCoderIds: byDoc.get(doc.id) ?? [],
  }));

  return NextResponse.json({
    documents,
    projectId,
    assignmentTableReady: !assignmentError,
    setupRequired: Boolean(assignmentError && isMissingRelationError(assignmentError)),
    setupHint: assignmentError ? setupHint : undefined,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as DocumentInsertBody & { projectId?: string };
  const auth = await resolveProjectContext(extractProjectId(request, body), "manage_documents");
  if (!auth.ok) return auth.response;

  const { projectId, supabase, userId } = auth.context;
  const rawTitle = body.title?.trim();
  const rawSource = body.source?.trim() || null;
  const rawContent = body.content?.trim();

  const title = rawTitle ? sanitizePlainTextInput(rawTitle) : undefined;
  const source = rawSource ? sanitizePlainTextInput(rawSource) : null;
  const content = rawContent ? sanitizePlainTextInput(rawContent) : undefined;
  const assignedCoderIds = [...new Set((body.assignedCoderIds ?? []).filter(Boolean))];

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required." }, { status: 400 });
  }

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .insert({
      project_id: projectId,
      title,
      source,
      content,
      created_by: userId,
    })
    .select("id, project_id, title, source, content, created_at")
    .single();

  if (documentError || !document) {
    if (isMissingRelationError(documentError)) {
      return schemaNotReadyResponse();
    }
    return NextResponse.json({ error: documentError?.message ?? "Insert failed." }, { status: 500 });
  }

  let setupRequired = false;

  if (assignedCoderIds.length > 0) {
    const validMembersResult = await supabase
      .from("project_memberships")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("status", "active")
      .eq("role", "coder")
      .in("user_id", assignedCoderIds);

    if (validMembersResult.error) {
      return NextResponse.json({ error: validMembersResult.error.message }, { status: 500 });
    }

    const validCoderIds = new Set((validMembersResult.data ?? []).map((row) => row.user_id));
    const invalidCoderIds = assignedCoderIds.filter((coderId) => !validCoderIds.has(coderId));

    if (invalidCoderIds.length > 0) {
      return NextResponse.json(
        { error: `Invalid coder assignments: ${invalidCoderIds.join(", ")}` },
        { status: 400 },
      );
    }

    const rows = assignedCoderIds.map((coderId) => ({
      project_id: projectId,
      document_id: document.id,
      coder_id: coderId,
    }));

    const assignmentInsert = await supabase.from("document_assignments").insert(rows);

    if (assignmentInsert.error) {
      if (isMissingRelationError(assignmentInsert.error)) {
        setupRequired = true;
      } else {
        return NextResponse.json({ error: assignmentInsert.error.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({
    document: {
      ...document,
      assignedCoderIds: setupRequired ? [] : assignedCoderIds,
    },
    setupRequired,
    setupHint: setupRequired ? setupHint : undefined,
  });
}
