import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import {
  extractProjectId,
  forbiddenResponse,
  isMissingRelationError,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type ExportRow = {
  tech_id: string;
  quoted_text: string;
  coder_name: string;
  is_ai: boolean;
  created_at: string;
  documents?: {
    title?: string;
    source?: string;
  } | null;
};

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "export_data");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role } = auth.context;

  const visibilityResult = await supabase
    .from("project_settings")
    .select("stats_visible_to_coders")
    .eq("project_id", projectId)
    .maybeSingle();

  if (visibilityResult.error && !isMissingRelationError(visibilityResult.error)) {
    return NextResponse.json({ error: visibilityResult.error.message }, { status: 500 });
  }

  const statsVisibleToCoders =
    isMissingRelationError(visibilityResult.error) ||
    visibilityResult.data?.stats_visible_to_coders !== false;

  if (role === "coder" && !statsVisibleToCoders) {
    return forbiddenResponse("Project stats export is hidden from coders.");
  }

  const { data, error } = await supabase
    .from("annotations")
    .select("*, documents(title, source)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const header = "Document,Source,TechniqueID,QuotedText,CoderName,IsAI,CreatedAt";
  const rows = ((data ?? []) as ExportRow[]).map((annotation) =>
    [
      `"${annotation.documents?.title ?? ""}"`,
      `"${annotation.documents?.source ?? ""}"`,
      `"${annotation.tech_id}"`,
      `"${annotation.quoted_text.replace(/"/g, '""')}"`,
      `"${annotation.coder_name}"`,
      annotation.is_ai ? "TRUE" : "FALSE",
      `"${annotation.created_at}"`,
    ].join(","),
  );

  const csv = [header, ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=palimpsest_annotations.csv",
    },
  });
}
