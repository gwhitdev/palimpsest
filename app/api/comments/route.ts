import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  requireDocumentAccess,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type CreateCommentBody = {
  projectId?: string;
  documentId?: string;
  parentId?: string | null;
  body?: string;
  quotedText?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
};

const setupHint = "Run supabase/document_comments.sql.";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role, userId } = auth.context;
  const documentId = request.nextUrl.searchParams.get("docId");

  if (!documentId) {
    return NextResponse.json({ error: "docId is required." }, { status: 400 });
  }

  const access = await requireDocumentAccess(auth.context, documentId);
  if (!access.ok) return access.response;

  const visibilityResult = await supabase
    .from("project_settings")
    .select("other_comments_visible_to_coders, other_coders_visible_to_coders")
    .eq("project_id", projectId)
    .maybeSingle();

  if (visibilityResult.error && !isMissingRelationError(visibilityResult.error)) {
    return NextResponse.json({ error: visibilityResult.error.message }, { status: 500 });
  }

  const otherCommentsVisibleToCoders =
    isMissingRelationError(visibilityResult.error) ||
    visibilityResult.data?.other_comments_visible_to_coders !== false;
  const otherCodersVisibleToCoders =
    isMissingRelationError(visibilityResult.error) ||
    visibilityResult.data?.other_coders_visible_to_coders !== false;

  const restrictToOwnComments = role === "coder" && !otherCommentsVisibleToCoders;
  const hideOtherCoderIdentity = role === "coder" && !otherCodersVisibleToCoders;

  let commentsQuery = supabase
    .from("document_comments")
    .select("id, project_id, document_id, parent_id, author_id, author_name, body, quoted_text, start_offset, end_offset, created_at")
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });

  if (restrictToOwnComments) {
    commentsQuery = commentsQuery.eq("author_id", userId);
  }

  const commentsResult = await commentsQuery;

  if (isMissingRelationError(commentsResult.error)) {
    return NextResponse.json(
      {
        error: "Comments table is not set up.",
        setupRequired: true,
        setupHint,
      },
      { status: 400 },
    );
  }

  if (commentsResult.error) {
    return NextResponse.json({ error: commentsResult.error.message }, { status: 500 });
  }

  const comments = (commentsResult.data ?? []).map((comment) => {
    if (!hideOtherCoderIdentity || comment.author_id === userId) {
      return comment;
    }

    return {
      ...comment,
      author_name: "Another coder",
    };
  });

  return NextResponse.json({ comments, projectId, documentId });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateCommentBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId } = auth.context;
  const documentId = body.documentId;
  const commentBody = body.body?.trim();

  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  if (!commentBody) {
    return NextResponse.json({ error: "body is required." }, { status: 400 });
  }

  const access = await requireDocumentAccess(auth.context, documentId);
  if (!access.ok) return access.response;

  const profileResult = await supabase.from("coders").select("display_name").eq("id", userId).maybeSingle();
  if (profileResult.error) {
    return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
  }

  const authorName = profileResult.data?.display_name ?? "Coder";

  if (body.parentId) {
    const parentResult = await supabase
      .from("document_comments")
      .select("id")
      .eq("project_id", projectId)
      .eq("document_id", documentId)
      .eq("id", body.parentId)
      .maybeSingle();

    if (isMissingRelationError(parentResult.error)) {
      return NextResponse.json(
        {
          error: "Comments table is not set up.",
          setupRequired: true,
          setupHint,
        },
        { status: 400 },
      );
    }

    if (parentResult.error) {
      return NextResponse.json({ error: parentResult.error.message }, { status: 500 });
    }

    if (!parentResult.data) {
      return NextResponse.json({ error: "Parent comment not found." }, { status: 400 });
    }
  }

  const insertResult = await supabase
    .from("document_comments")
    .insert({
      project_id: projectId,
      document_id: documentId,
      parent_id: body.parentId ?? null,
      author_id: userId,
      author_name: authorName,
      body: commentBody,
      quoted_text: body.quotedText ?? null,
      start_offset: typeof body.startOffset === "number" ? body.startOffset : null,
      end_offset: typeof body.endOffset === "number" ? body.endOffset : null,
    })
    .select("id, project_id, document_id, parent_id, author_id, author_name, body, quoted_text, start_offset, end_offset, created_at")
    .single();

  if (isMissingRelationError(insertResult.error)) {
    return NextResponse.json(
      {
        error: "Comments table is not set up.",
        setupRequired: true,
        setupHint,
      },
      { status: 400 },
    );
  }

  if (insertResult.error) {
    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ comment: insertResult.data, projectId, documentId });
}
