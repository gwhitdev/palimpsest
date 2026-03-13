import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  forbiddenResponse,
  isMissingRelationError,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type AnnotationRow = {
  id: string;
  project_id: string;
  document_id: string;
  coder_id: string;
  coder_name: string;
  tech_id: string;
  quoted_text: string;
  start_offset: number;
  end_offset: number;
  is_ai: boolean;
  accepted: boolean;
  created_at: string;
};

const setupHint = "Run supabase/project_stats_visibility.sql.";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_stats");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role } = auth.context;

  const visibilityResult = await supabase
    .from("project_settings")
    .select("stats_visible_to_coders")
    .eq("project_id", projectId)
    .maybeSingle();

  if (
    visibilityResult.error &&
    !isMissingRelationError(visibilityResult.error)
  ) {
    return NextResponse.json({ error: visibilityResult.error.message }, { status: 500 });
  }

  const statsVisibleToCoders =
    isMissingRelationError(visibilityResult.error) ||
    visibilityResult.data?.stats_visible_to_coders !== false;

  if (role === "coder" && !statsVisibleToCoders) {
    return forbiddenResponse(`Project stats are hidden from coders. ${setupHint}`);
  }

  const annotationsResult = await supabase
    .from("annotations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (annotationsResult.error) {
    return NextResponse.json({ error: annotationsResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    projectId,
    annotations: (annotationsResult.data ?? []) as AnnotationRow[],
    statsVisibleToCoders,
  });
}
