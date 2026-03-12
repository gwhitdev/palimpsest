import { NextRequest, NextResponse } from "next/server";
import { isMissingRelationError, requireAdmin } from "@/lib/server/adminAuth";

const setupHint = "Run supabase/base_schema.sql first, then supabase/document_assignments.sql in Supabase SQL Editor.";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { documentId, coderIds } = (await request.json()) as {
    documentId?: string;
    coderIds?: string[];
  };

  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  const uniqueCoderIds = [...new Set((coderIds ?? []).filter(Boolean))];

  const deleteResult = await auth.supabase
    .from("document_assignments")
    .delete()
    .eq("document_id", documentId);

  if (deleteResult.error) {
    if (isMissingRelationError(deleteResult.error)) {
      return NextResponse.json(
        {
          error: "Assignment table is not set up.",
          setupRequired: true,
          setupHint,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
  }

  if (uniqueCoderIds.length > 0) {
    const rows = uniqueCoderIds.map((coderId) => ({
      document_id: documentId,
      coder_id: coderId,
    }));

    const insertResult = await auth.supabase.from("document_assignments").insert(rows);

    if (insertResult.error) {
      if (isMissingRelationError(insertResult.error)) {
        return NextResponse.json(
          {
            error: "Assignment table is not set up.",
            setupRequired: true,
            setupHint,
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, documentId, coderIds: uniqueCoderIds });
}
