import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

const setupHint =
  "Run supabase/base_schema.sql, then supabase/project_multitenancy_migration.sql, then supabase/document_assignments.sql.";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    documentId?: string;
    coderIds?: string[];
    projectId?: string;
  };

  const auth = await resolveProjectContext(extractProjectId(request, body), "manage_members");
  if (!auth.ok) return auth.response;

  const { projectId, supabase } = auth.context;
  const { documentId, coderIds } = body;

  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  const uniqueCoderIds = [...new Set((coderIds ?? []).filter(Boolean))];

  if (uniqueCoderIds.length > 0) {
    const validMembersResult = await supabase
      .from("project_memberships")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("status", "active")
      .eq("role", "coder")
      .in("user_id", uniqueCoderIds);

    if (validMembersResult.error) {
      return NextResponse.json({ error: validMembersResult.error.message }, { status: 500 });
    }

    const validCoderIds = new Set((validMembersResult.data ?? []).map((row) => row.user_id));
    const invalidCoderIds = uniqueCoderIds.filter((coderId) => !validCoderIds.has(coderId));

    if (invalidCoderIds.length > 0) {
      return NextResponse.json(
        { error: `Invalid coder assignments: ${invalidCoderIds.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const deleteResult = await supabase
    .from("document_assignments")
    .delete()
    .eq("project_id", projectId)
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
      project_id: projectId,
      document_id: documentId,
      coder_id: coderId,
    }));

    const insertResult = await supabase.from("document_assignments").insert(rows);

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

  return NextResponse.json({ success: true, projectId, documentId, coderIds: uniqueCoderIds });
}
