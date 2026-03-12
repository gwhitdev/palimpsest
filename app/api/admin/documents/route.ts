import { NextRequest, NextResponse } from "next/server";
import { isMissingRelationError, missingBaseSchemaResponse, requireAdmin } from "@/lib/server/adminAuth";

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

const setupHint = "Run supabase/base_schema.sql first, then supabase/document_assignments.sql in Supabase SQL Editor.";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data: docs, error: docsError } = await auth.supabase
    .from("documents")
    .select("id, title, source, content, created_at")
    .order("created_at", { ascending: false });

  if (docsError) {
    if (isMissingRelationError(docsError)) {
      return missingBaseSchemaResponse();
    }
    return NextResponse.json({ error: docsError.message }, { status: 500 });
  }

  const { data: assignments, error: assignmentError } = await auth.supabase
    .from("document_assignments")
    .select("document_id, coder_id");

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
    assignmentTableReady: !assignmentError,
    setupRequired: Boolean(assignmentError && isMissingRelationError(assignmentError)),
    setupHint: assignmentError ? setupHint : undefined,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as DocumentInsertBody;
  const title = body.title?.trim();
  const source = body.source?.trim() || null;
  const content = body.content?.trim();
  const assignedCoderIds = [...new Set((body.assignedCoderIds ?? []).filter(Boolean))];

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required." }, { status: 400 });
  }

  const { data: document, error: documentError } = await auth.supabase
    .from("documents")
    .insert({
      title,
      source,
      content,
      created_by: auth.userId,
    })
    .select("id, title, source, content, created_at")
    .single();

  if (documentError || !document) {
    if (isMissingRelationError(documentError)) {
      return missingBaseSchemaResponse();
    }
    return NextResponse.json({ error: documentError?.message ?? "Insert failed." }, { status: 500 });
  }

  let setupRequired = false;

  if (assignedCoderIds.length > 0) {
    const rows = assignedCoderIds.map((coderId) => ({
      document_id: document.id,
      coder_id: coderId,
    }));

    const assignmentInsert = await auth.supabase.from("document_assignments").insert(rows);

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
