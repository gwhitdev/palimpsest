import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  forbiddenResponse,
  isMissingRelationError,
  requireDocumentAccess,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type VoteValue = "agree" | "disagree";

type ActionBody = {
  projectId?: string;
  annotationId?: string;
  kind?: "vote" | "merged";
  vote?: VoteValue | null;
  keep?: boolean;
};

const setupHint = "Run supabase/annotation_insights.sql.";

type AnnotationRow = {
  id: string;
  document_id: string;
};

type VoteRow = {
  annotation_id: string;
  voter_id: string;
  vote: VoteValue;
};

type MergedRow = {
  annotation_id: string;
};

async function loadDocInsights(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  projectId: string,
  documentId: string,
  userId: string,
) {
  const [votesResult, mergedResult] = await Promise.all([
    supabase
      .from("annotation_votes")
      .select("annotation_id, voter_id, vote")
      .eq("project_id", projectId)
      .eq("document_id", documentId),
    supabase
      .from("merged_annotations")
      .select("annotation_id")
      .eq("project_id", projectId)
      .eq("document_id", documentId),
  ]);

  if (isMissingRelationError(votesResult.error) || isMissingRelationError(mergedResult.error)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "Annotation insight tables are not set up.",
          setupRequired: true,
          setupHint,
        },
        { status: 400 },
      ),
    };
  }

  if (votesResult.error) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: votesResult.error.message }, { status: 500 }),
    };
  }

  if (mergedResult.error) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: mergedResult.error.message }, { status: 500 }),
    };
  }

  const summary: Record<string, { agree: number; disagree: number; userVote: VoteValue | null }> = {};
  ((votesResult.data ?? []) as VoteRow[]).forEach((row) => {
    const current = summary[row.annotation_id] ?? { agree: 0, disagree: 0, userVote: null };
    if (row.vote === "agree") current.agree += 1;
    else current.disagree += 1;

    if (row.voter_id === userId) {
      current.userVote = row.vote;
    }

    summary[row.annotation_id] = current;
  });

  return {
    ok: true as const,
    payload: {
      voteSummaryByAnnotationId: summary,
      mergedAnnotationIds: ((mergedResult.data ?? []) as MergedRow[]).map((row) => row.annotation_id),
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId } = auth.context;
  const documentId = request.nextUrl.searchParams.get("docId");

  if (!documentId) {
    return NextResponse.json({ error: "docId is required." }, { status: 400 });
  }

  const access = await requireDocumentAccess(auth.context, documentId);
  if (!access.ok) return access.response;

  const insights = await loadDocInsights(supabase, projectId, documentId, userId);
  if (!insights.ok) return insights.response;

  return NextResponse.json({
    projectId,
    documentId,
    ...insights.payload,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ActionBody;
  const requiredPermission = body.kind === "merged" ? "manage_documents" : "annotate";
  const auth = await resolveProjectContext(extractProjectId(request, body), requiredPermission);
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId, role } = auth.context;

  if (!body.annotationId || !body.kind) {
    return NextResponse.json({ error: "annotationId and kind are required." }, { status: 400 });
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

  if (body.kind === "vote") {
    const vote = body.vote ?? null;

    if (vote !== null && vote !== "agree" && vote !== "disagree") {
      return NextResponse.json({ error: "vote must be agree, disagree, or null." }, { status: 400 });
    }

    if (vote === null) {
      const deleteResult = await supabase
        .from("annotation_votes")
        .delete()
        .eq("annotation_id", annotation.id)
        .eq("voter_id", userId);

      if (isMissingRelationError(deleteResult.error)) {
        return NextResponse.json(
          {
            error: "Annotation insight tables are not set up.",
            setupRequired: true,
            setupHint,
          },
          { status: 400 },
        );
      }

      if (deleteResult.error) {
        return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
      }
    } else {
      const upsertResult = await supabase.from("annotation_votes").upsert(
        {
          project_id: projectId,
          document_id: annotation.document_id,
          annotation_id: annotation.id,
          voter_id: userId,
          vote,
        },
        { onConflict: "annotation_id,voter_id" },
      );

      if (isMissingRelationError(upsertResult.error)) {
        return NextResponse.json(
          {
            error: "Annotation insight tables are not set up.",
            setupRequired: true,
            setupHint,
          },
          { status: 400 },
        );
      }

      if (upsertResult.error) {
        return NextResponse.json({ error: upsertResult.error.message }, { status: 500 });
      }
    }
  } else {
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
            error: "Annotation insight tables are not set up.",
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
            error: "Annotation insight tables are not set up.",
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
  }

  const insights = await loadDocInsights(supabase, projectId, annotation.document_id, userId);
  if (!insights.ok) return insights.response;

  return NextResponse.json({
    projectId,
    documentId: annotation.document_id,
    ...insights.payload,
  });
}
