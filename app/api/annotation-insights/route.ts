import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  forbiddenResponse,
  isMissingRelationError,
  requireDocumentAccess,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type ActionBody = {
  projectId?: string;
  annotationId?: string;
  keep?: boolean;
};

const setupHint = "Run supabase/annotation_insights.sql.";

type AnnotationRow = {
  id: string;
  document_id: string;
};

type MergedRow = {
  annotation_id: string;
};

async function loadMergedAnnotationIds(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  projectId: string,
  documentId: string,
) {
  const mergedResult = await supabase
    .from("merged_annotations")
    .select("annotation_id")
    .eq("project_id", projectId)
    .eq("document_id", documentId);

  if (isMissingRelationError(mergedResult.error)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "Merged annotation table is not set up.",
          setupRequired: true,
          setupHint,
        },
        { status: 400 },
      ),
    };
  }

  if (mergedResult.error) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: mergedResult.error.message }, { status: 500 }),
    };
  }

  return {
    ok: true as const,
    payload: {
      mergedAnnotationIds: ((mergedResult.data ?? []) as MergedRow[]).map((row) => row.annotation_id),
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;
  const documentId = request.nextUrl.searchParams.get("docId");

  if (!documentId) {
    return NextResponse.json({ error: "docId is required." }, { status: 400 });
  }

  const access = await requireDocumentAccess(auth.context, documentId);
  if (!access.ok) return access.response;

  const insights = await loadMergedAnnotationIds(supabase, projectId, documentId);
  if (!insights.ok) return insights.response;

  return NextResponse.json({
    projectId,
    documentId,
    ...insights.payload,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ActionBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "manage_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId, role } = auth.context;

  if (!body.annotationId) {
    return NextResponse.json({ error: "annotationId is required." }, { status: 400 });
  }

  const annotationResult = await supabase
    .from("annotations")
    .select("id, document_id")
    .eq("project_id", projectId)
    .eq("id", body.annotationId)
    .maybeSingle();

  if (annotationResult.error) {
    return NextResponse.json({ error: annotationResult.error.message }, { status: 500 });
  }

  const annotation = annotationResult.data as AnnotationRow | null;
  if (!annotation) {
    return NextResponse.json({ error: "Annotation not found." }, { status: 404 });
  }

  const access = await requireDocumentAccess(auth.context, annotation.document_id);
  if (!access.ok) return access.response;

  if (role !== "owner") {
    return forbiddenResponse("Only project owners can select merged annotations.");
  }

  const keep = Boolean(body.keep);
  if (keep) {
    const upsertResult = await supabase.from("merged_annotations").upsert(
      {
        project_id: projectId,
        document_id: annotation.document_id,
        annotation_id: annotation.id,
        selected_by: userId,
      },
      { onConflict: "annotation_id" },
    );

    if (isMissingRelationError(upsertResult.error)) {
      return NextResponse.json(
        {
          error: "Merged annotation table is not set up.",
          setupRequired: true,
          setupHint,
        },
        { status: 400 },
      );
    }

    if (upsertResult.error) {
      return NextResponse.json({ error: upsertResult.error.message }, { status: 500 });
    }
  } else {
    const deleteResult = await supabase
      .from("merged_annotations")
      .delete()
      .eq("annotation_id", annotation.id)
      .eq("project_id", projectId);

    if (isMissingRelationError(deleteResult.error)) {
      return NextResponse.json(
        {
          error: "Merged annotation table is not set up.",
          setupRequired: true,
          setupHint,
        },
        { status: 400 },
      );
    }

    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
    }
  }

  const insights = await loadMergedAnnotationIds(supabase, projectId, annotation.document_id);
  if (!insights.ok) return insights.response;

  return NextResponse.json({
    projectId,
    documentId: annotation.document_id,
    ...insights.payload,
  });
}
