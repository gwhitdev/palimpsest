import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  forbiddenResponse,
  isMissingRelationError,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type AnnotationRow = {
  coder_id: string;
  coder_name: string;
  document_id: string;
  tech_id: string;
  quoted_text: string;
  start_offset: number | null;
  end_offset: number | null;
};

type DocumentRow = {
  id: string;
  title: string;
};

const STATS_SETUP_HINT = "Run supabase/project_stats_visibility.sql.";
const KAPPA_SETUP_HINT = "Run supabase/irr_kappa_rounds.sql.";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_stats");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role } = auth.context;
  const techId = request.nextUrl.searchParams.get("techId")?.trim();
  const roundId = request.nextUrl.searchParams.get("roundId")?.trim() ?? "";

  if (!techId) {
    return NextResponse.json({ error: "techId is required." }, { status: 400 });
  }

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
    return forbiddenResponse(`Project stats are hidden from coders. ${STATS_SETUP_HINT}`);
  }

  let allQuery = supabase
    .from("annotations")
    .select("coder_id, coder_name, document_id, tech_id, quoted_text, start_offset, end_offset")
    .eq("project_id", projectId)
    .eq("accepted", true);

  if (roundId) {
    allQuery = allQuery.eq("round_id", roundId);
  }

  const allResult = await allQuery;

  if (allResult.error) {
    if (isMissingRelationError(allResult.error)) {
      return NextResponse.json(
        {
          error: "Kappa schema is not set up.",
          setupRequired: true,
          setupHint: KAPPA_SETUP_HINT,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: allResult.error.message }, { status: 500 });
  }

  const allAnnotations = (allResult.data ?? []) as AnnotationRow[];
  const coderIds = [...new Set(allAnnotations.map((row) => row.coder_id))];
  const coderNameById = new Map<string, string>();

  allAnnotations.forEach((row) => {
    if (!coderNameById.has(row.coder_id)) {
      coderNameById.set(row.coder_id, row.coder_name);
    }
  });

  const byTech = allAnnotations.filter((row) => row.tech_id === techId);
  const documentIds = [...new Set(byTech.map((row) => row.document_id))];

  const documentsResult = documentIds.length
    ? await supabase
        .from("documents")
        .select("id, title")
        .eq("project_id", projectId)
        .in("id", documentIds)
    : { data: [], error: null };

  if (documentsResult.error) {
    return NextResponse.json({ error: documentsResult.error.message }, { status: 500 });
  }

  const titleByDocId = new Map<string, string>(
    ((documentsResult.data ?? []) as DocumentRow[]).map((row) => [row.id, row.title]),
  );

  const groupedByDocument = new Map<string, AnnotationRow[]>();
  byTech.forEach((row) => {
    const current = groupedByDocument.get(row.document_id) ?? [];
    current.push(row);
    groupedByDocument.set(row.document_id, current);
  });

  const disagreements = [...groupedByDocument.entries()]
    .map(([documentId, rows]) => {
      const appliedByCoder = new Map<string, AnnotationRow[]>();
      rows.forEach((row) => {
        const current = appliedByCoder.get(row.coder_id) ?? [];
        current.push(row);
        appliedByCoder.set(row.coder_id, current);
      });

      const appliedCoderIds = [...appliedByCoder.keys()];
      if (appliedCoderIds.length === 0 || appliedCoderIds.length === coderIds.length) {
        return null;
      }

      const missingCoderIds = coderIds.filter((coderId) => !appliedByCoder.has(coderId));
      const primaryExample = rows[0];

      return {
        documentId,
        documentTitle: titleByDocId.get(documentId) ?? "Untitled document",
        quotedText: primaryExample?.quoted_text ?? "",
        startOffset: primaryExample?.start_offset ?? null,
        endOffset: primaryExample?.end_offset ?? null,
        coderViews: coderIds.map((coderId) => ({
          coderId,
          coderName: coderNameById.get(coderId) ?? "Coder",
          applied: appliedByCoder.has(coderId),
          quotes: (appliedByCoder.get(coderId) ?? []).map((row) => ({
            quotedText: row.quoted_text,
            startOffset: row.start_offset,
            endOffset: row.end_offset,
          })),
        })),
        appliedCoderIds,
        missingCoderIds,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.documentTitle.localeCompare(b.documentTitle));

  return NextResponse.json({
    projectId,
    techId,
    roundId: roundId || null,
    disagreements,
  });
}
