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
  accepted: boolean;
  round_id: string | null;
  created_at: string;
  documents?: {
    title?: string;
    source?: string;
  } | null;
  round?: {
    round_number?: number | null;
  } | null;
};

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

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
    .select("tech_id, quoted_text, coder_name, is_ai, accepted, round_id, created_at, documents(title, source), round:coding_rounds(round_number)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const header =
    "Document,Source,TechniqueID,QuotedText,CoderName,IsAI,Accepted,CreatedAt,round_id,round_number,is_ai,accepted";
  const rows = ((data ?? []) as ExportRow[]).map((annotation) =>
    [
      escapeCsv(annotation.documents?.title ?? ""),
      escapeCsv(annotation.documents?.source ?? ""),
      escapeCsv(annotation.tech_id),
      escapeCsv(annotation.quoted_text ?? ""),
      escapeCsv(annotation.coder_name ?? ""),
      annotation.is_ai ? "TRUE" : "FALSE",
      annotation.accepted ? "TRUE" : "FALSE",
      escapeCsv(annotation.created_at ?? ""),
      escapeCsv(annotation.round_id ?? ""),
      annotation.round?.round_number?.toString() ?? "",
      annotation.is_ai ? "TRUE" : "FALSE",
      annotation.accepted ? "TRUE" : "FALSE",
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
