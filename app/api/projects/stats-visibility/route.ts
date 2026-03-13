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
  otherCodersVisibleToCoders?: boolean;
  otherAnnotationsVisibleToCoders?: boolean;
  otherCommentsVisibleToCoders?: boolean;
};

const setupHint = "Run supabase/project_stats_visibility.sql.";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, role } = auth.context;

  const visibilityResult = await supabase
    .from("project_settings")
    .select(
      "stats_visible_to_coders, other_coders_visible_to_coders, other_annotations_visible_to_coders, other_comments_visible_to_coders",
    )
    .eq("project_id", projectId)
    .maybeSingle();

  if (isMissingRelationError(visibilityResult.error)) {
    return NextResponse.json({
      projectId,
      statsVisibleToCoders: true,
      otherCodersVisibleToCoders: true,
      otherAnnotationsVisibleToCoders: true,
      otherCommentsVisibleToCoders: true,
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
  const otherCodersVisibleToCoders =
    visibilityResult.data?.other_coders_visible_to_coders !== false;
  const otherAnnotationsVisibleToCoders =
    visibilityResult.data?.other_annotations_visible_to_coders !== false;
  const otherCommentsVisibleToCoders =
    visibilityResult.data?.other_comments_visible_to_coders !== false;
  const canViewStats = role === "owner" || statsVisibleToCoders;

  return NextResponse.json({
    projectId,
    statsVisibleToCoders,
    otherCodersVisibleToCoders,
    otherAnnotationsVisibleToCoders,
    otherCommentsVisibleToCoders,
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

  const hasAnyVisibilityField =
    typeof body.statsVisibleToCoders === "boolean" ||
    typeof body.otherCodersVisibleToCoders === "boolean" ||
    typeof body.otherAnnotationsVisibleToCoders === "boolean" ||
    typeof body.otherCommentsVisibleToCoders === "boolean";

  if (!hasAnyVisibilityField) {
    return NextResponse.json(
      {
        error:
          "Provide at least one boolean visibility field to update (statsVisibleToCoders, otherCodersVisibleToCoders, otherAnnotationsVisibleToCoders, otherCommentsVisibleToCoders).",
      },
      { status: 400 },
    );
  }

  const upsertPayload: Record<string, unknown> = {
    project_id: projectId,
    updated_by: userId,
  };

  if (typeof body.statsVisibleToCoders === "boolean") {
    upsertPayload.stats_visible_to_coders = body.statsVisibleToCoders;
  }

  if (typeof body.otherCodersVisibleToCoders === "boolean") {
    upsertPayload.other_coders_visible_to_coders = body.otherCodersVisibleToCoders;
  }

  if (typeof body.otherAnnotationsVisibleToCoders === "boolean") {
    upsertPayload.other_annotations_visible_to_coders = body.otherAnnotationsVisibleToCoders;
  }

  if (typeof body.otherCommentsVisibleToCoders === "boolean") {
    upsertPayload.other_comments_visible_to_coders = body.otherCommentsVisibleToCoders;
  }

  const upsertResult = await supabase
    .from("project_settings")
    .upsert(upsertPayload, { onConflict: "project_id" })
    .select(
      "stats_visible_to_coders, other_coders_visible_to_coders, other_annotations_visible_to_coders, other_comments_visible_to_coders",
    )
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
    otherCodersVisibleToCoders: upsertResult.data.other_coders_visible_to_coders,
    otherAnnotationsVisibleToCoders: upsertResult.data.other_annotations_visible_to_coders,
    otherCommentsVisibleToCoders: upsertResult.data.other_comments_visible_to_coders,
    canViewStats: true,
    canManageStatsVisibility: true,
  });
}
