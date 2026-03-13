import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type BoundaryExampleBody = {
  projectId?: string;
  techId?: string;
  quotedText?: string;
  explanation?: string | null;
};

const KAPPA_SETUP_HINT = "Run supabase/irr_kappa_rounds.sql.";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;
  const techId = request.nextUrl.searchParams.get("techId")?.trim();

  let query = supabase
    .from("boundary_examples")
    .select("id, project_id, tech_id, quoted_text, explanation, added_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (techId) {
    query = query.eq("tech_id", techId);
  }

  const result = await query;

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return NextResponse.json(
        {
          error: "Boundary examples schema is not set up.",
          setupRequired: true,
          setupHint: KAPPA_SETUP_HINT,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ examples: result.data ?? [], projectId });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as BoundaryExampleBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId } = auth.context;
  const techId = body.techId?.trim();
  const quotedText = body.quotedText?.trim();
  const explanation = body.explanation?.trim() || null;

  if (!techId || !quotedText) {
    return NextResponse.json(
      { error: "techId and quotedText are required." },
      { status: 400 },
    );
  }

  const insertResult = await supabase
    .from("boundary_examples")
    .insert({
      project_id: projectId,
      tech_id: techId,
      quoted_text: quotedText,
      explanation,
      added_by: userId,
    })
    .select("id, project_id, tech_id, quoted_text, explanation, added_by, created_at")
    .single();

  if (insertResult.error) {
    if (isMissingRelationError(insertResult.error)) {
      return NextResponse.json(
        {
          error: "Boundary examples schema is not set up.",
          setupRequired: true,
          setupHint: KAPPA_SETUP_HINT,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ example: insertResult.data, projectId });
}
