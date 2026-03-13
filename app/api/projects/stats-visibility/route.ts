import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type StatsVisibilityBody = {
  projectId?: string;
  statsVisibleToCoders?: boolean;
};

const setupHint = "Run supabase/project_stats_visibility.sql.";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role } = auth.context;

  const visibilityResult = await supabase
    .from("project_settings")
    .select("stats_visible_to_coders")
    .eq("project_id", projectId)
    .maybeSingle();

  if (isMissingRelationError(visibilityResult.error)) {
    return NextResponse.json({
      projectId,
      statsVisibleToCoders: true,
      canViewStats: true,
      canManageStatsVisibility: role === "owner",
      setupRequired: true,
      setupHint,
    });
  }

  if (visibilityResult.error) {
    return NextResponse.json({ error: visibilityResult.error.message }, { status: 500 });
  }

  const statsVisibleToCoders = visibilityResult.data?.stats_visible_to_coders !== false;
  const canViewStats = role === "owner" || statsVisibleToCoders;

  return NextResponse.json({
    projectId,
    statsVisibleToCoders,
    canViewStats,
    canManageStatsVisibility: role === "owner",
  });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as StatsVisibilityBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "manage_project");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId, role } = auth.context;
  if (role !== "owner") {
    return NextResponse.json(
      { error: "Only project owners can update stats visibility." },
      { status: 403 },
    );
  }

  if (typeof body.statsVisibleToCoders !== "boolean") {
    return NextResponse.json(
      { error: "statsVisibleToCoders must be a boolean." },
      { status: 400 },
    );
  }

  const upsertResult = await supabase
    .from("project_settings")
    .upsert(
      {
        project_id: projectId,
        stats_visible_to_coders: body.statsVisibleToCoders,
        updated_by: userId,
      },
      { onConflict: "project_id" },
    )
    .select("stats_visible_to_coders")
    .single();

  if (isMissingRelationError(upsertResult.error)) {
    return NextResponse.json(
      {
        error: "Project settings table is not set up.",
        setupRequired: true,
        setupHint,
      },
      { status: 400 },
    );
  }

  if (upsertResult.error) {
    return NextResponse.json({ error: upsertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    projectId,
    statsVisibleToCoders: upsertResult.data.stats_visible_to_coders,
    canViewStats: true,
    canManageStatsVisibility: true,
  });
}
