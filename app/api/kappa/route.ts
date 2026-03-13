import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateFullKappa,
  KappaSummary,
  statusFromKappa,
} from "@/lib/kappa";
import { TAXONOMY } from "@/lib/taxonomy";
import {
  extractProjectId,
  forbiddenResponse,
  isMissingRelationError,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type KappaRequestBody = {
  projectId?: string;
  roundId?: string;
  results?: KappaSummary;
};

type PersistedKappaRow = {
  tech_id: string;
  status: "DRAFT" | "UNDER REVISION" | "LOCKED";
  kappa_value: number | null;
  round_id: string | null;
  calculated_at: string;
};

type RoundHistoryRow = {
  id: string;
  round_number: number;
  status: "active" | "complete" | "archived";
  created_at: string;
  notes: string | null;
  kappa_results:
    | Array<{
        tech_id: string;
        kappa_value: number | null;
        status: "DRAFT" | "UNDER REVISION" | "LOCKED";
        calculated_at: string;
      }>
    | null;
};

const STATS_SETUP_HINT = "Run supabase/project_stats_visibility.sql.";
const KAPPA_SETUP_HINT = "Run supabase/irr_kappa_rounds.sql.";

async function ensureStatsVisibility(
  projectId: string,
  role: "owner" | "coder",
  supabase: SupabaseClient,
) {
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

  return null;
}

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_stats");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role } = auth.context;
  const roundId = request.nextUrl.searchParams.get("roundId")?.trim() ?? "";

  const visibilityResponse = await ensureStatsVisibility(projectId, role, supabase);
  if (visibilityResponse) return visibilityResponse;

  let annotationsQuery = supabase
    .from("annotations")
    .select("coder_id, document_id, tech_id")
    .eq("project_id", projectId)
    .eq("accepted", true);

  if (roundId) {
    annotationsQuery = annotationsQuery.eq("round_id", roundId);
  }

  const annotationsResult = await annotationsQuery;
  if (annotationsResult.error) {
    if (isMissingRelationError(annotationsResult.error)) {
      return NextResponse.json(
        {
          error: "Kappa schema is not set up.",
          setupRequired: true,
          setupHint: KAPPA_SETUP_HINT,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: annotationsResult.error.message }, { status: 500 });
  }

  const allTechIds = TAXONOMY.map((technique) => technique.id);
  const summary = calculateFullKappa(annotationsResult.data ?? [], allTechIds, roundId);

  const persistedResult = await supabase
    .from("kappa_results")
    .select("tech_id, status, kappa_value, round_id, calculated_at")
    .eq("project_id", projectId)
    .order("calculated_at", { ascending: false });

  if (persistedResult.error && !isMissingRelationError(persistedResult.error)) {
    return NextResponse.json({ error: persistedResult.error.message }, { status: 500 });
  }

  const latestByTech = new Map<string, PersistedKappaRow>();
  ((persistedResult.data ?? []) as PersistedKappaRow[]).forEach((row) => {
    if (!latestByTech.has(row.tech_id)) {
      latestByTech.set(row.tech_id, row);
    }
  });

  const byTechnique = summary.byTechnique.map((result) => {
    const persisted = latestByTech.get(result.techId);
    return {
      ...result,
      status: persisted?.status ?? statusFromKappa(result.kappa),
      persistedKappa: persisted?.kappa_value ?? null,
      persistedRoundId: persisted?.round_id ?? null,
    };
  });

  const roundsResult = await supabase
    .from("coding_rounds")
    .select("id, round_number, status, notes, created_at, kappa_results(tech_id, kappa_value, status, calculated_at)")
    .eq("project_id", projectId)
    .order("round_number", { ascending: true });

  if (roundsResult.error && !isMissingRelationError(roundsResult.error)) {
    return NextResponse.json({ error: roundsResult.error.message }, { status: 500 });
  }

  const roundHistory = ((roundsResult.data ?? []) as RoundHistoryRow[]).map((round) => {
    const values = (round.kappa_results ?? [])
      .map((entry) => entry.kappa_value)
      .filter((value): value is number => typeof value === "number");

    const overall =
      values.length > 0 ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000 : null;

    return {
      id: round.id,
      roundNumber: round.round_number,
      status: round.status,
      notes: round.notes,
      createdAt: round.created_at,
      overall,
      byTechnique: (round.kappa_results ?? []).map((entry) => ({
        techId: entry.tech_id,
        kappa: entry.kappa_value,
        status: entry.status,
        calculatedAt: entry.calculated_at,
      })),
    };
  });

  return NextResponse.json({
    ...summary,
    byTechnique,
    roundHistory,
    projectId,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as KappaRequestBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "manage_project");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;
  const roundId = body.roundId?.trim();
  const summary = body.results;

  if (!roundId) {
    return NextResponse.json({ error: "roundId is required." }, { status: 400 });
  }

  if (!summary || !Array.isArray(summary.byTechnique)) {
    return NextResponse.json({ error: "results.byTechnique is required." }, { status: 400 });
  }

  const rows = summary.byTechnique.map((result) => ({
    project_id: projectId,
    round_id: roundId,
    tech_id: result.techId,
    kappa_value: result.kappa,
    coder_count: result.coderCount,
    doc_count: result.docCount,
    status: result.status ?? statusFromKappa(result.kappa),
    notes: result.note ?? null,
    calculated_at: summary.calculatedAt,
  }));

  const upsertResult = await supabase
    .from("kappa_results")
    .upsert(rows, { onConflict: "project_id,round_id,tech_id" });

  if (upsertResult.error) {
    if (isMissingRelationError(upsertResult.error)) {
      return NextResponse.json(
        {
          error: "Kappa schema is not set up.",
          setupRequired: true,
          setupHint: KAPPA_SETUP_HINT,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: upsertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, projectId, roundId });
}
