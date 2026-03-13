import { NextRequest, NextResponse } from "next/server";
import { extractProjectId } from "@/lib/server/projectAuth";
import { createClient } from "@/lib/supabase/server";
import { TAXONOMY } from "@/lib/taxonomy";

const setupHint = "Run supabase/taxonomy_practice_notes.sql and notify PostgREST schema reload.";

type TaxonomyPracticeBody = {
  projectId?: string;
  techId?: string;
  practiceNote?: string;
};

async function getAuthContext(projectId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) };
  }

  if (!projectId) {
    return { ok: false as const, response: NextResponse.json({ error: "projectId is required." }, { status: 400 }) };
  }

  const [coderResult, membershipResult] = await Promise.all([
    supabase.from("coders").select("role").eq("id", user.id).maybeSingle(),
    supabase
      .from("project_memberships")
      .select("role, status")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (coderResult.error) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: coderResult.error.message }, { status: 500 }),
    };
  }

  if (membershipResult.error) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: membershipResult.error.message }, { status: 500 }),
    };
  }

  const isAppAdmin = coderResult.data?.role === "admin";
  const isProjectOwner = membershipResult.data?.role === "owner";
  const isProjectMember = Boolean(membershipResult.data);

  if (!isProjectMember && !isAppAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "You are not allowed to access this project taxonomy." }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    context: {
      supabase,
      userId: user.id,
      projectId,
      canEdit: isProjectOwner || isAppAdmin,
      isAppAdmin,
      isProjectOwner,
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(extractProjectId(request));
  if (!auth.ok) return auth.response;

  const { supabase, projectId, canEdit, isAppAdmin, isProjectOwner } = auth.context;

  const result = await supabase
    .from("taxonomy_practice_notes")
    .select("tech_id, practice_note, updated_at")
    .eq("project_id", projectId);

  if (result.error) {
    if (result.error.code === "42P01") {
      return NextResponse.json(
        {
          notes: {},
          canEdit,
          isAppAdmin,
          isProjectOwner,
          setupRequired: true,
          setupHint,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const notes: Record<string, { practiceNote: string; updatedAt: string | null }> = {};
  (result.data ?? []).forEach((row) => {
    notes[row.tech_id] = {
      practiceNote: row.practice_note,
      updatedAt: row.updated_at,
    };
  });

  return NextResponse.json({ notes, canEdit, isAppAdmin, isProjectOwner, projectId });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as TaxonomyPracticeBody;
  const auth = await getAuthContext(body.projectId ?? extractProjectId(request, body));
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId, canEdit } = auth.context;
  if (!canEdit) {
    return NextResponse.json(
      { error: "Only project owners and app super admins can update taxonomy practice guidance." },
      { status: 403 },
    );
  }

  const techId = typeof body.techId === "string" ? body.techId.trim() : "";
  const practiceNote = typeof body.practiceNote === "string" ? body.practiceNote : "";

  if (!techId) {
    return NextResponse.json({ error: "techId is required." }, { status: 400 });
  }

  const validTech = TAXONOMY.some((technique) => technique.id === techId);
  if (!validTech) {
    return NextResponse.json({ error: `Unknown taxonomy code '${techId}'.` }, { status: 400 });
  }

  const upsertResult = await supabase
    .from("taxonomy_practice_notes")
    .upsert(
      {
        project_id: projectId,
        tech_id: techId,
        practice_note: practiceNote,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,tech_id" },
    )
    .select("tech_id, practice_note, updated_at")
    .single();

  if (upsertResult.error) {
    if (upsertResult.error.code === "42P01") {
      return NextResponse.json(
        { error: `Taxonomy practice notes are not set up. ${setupHint}` },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: upsertResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    note: {
      techId: upsertResult.data.tech_id,
      practiceNote: upsertResult.data.practice_note,
      updatedAt: upsertResult.data.updated_at,
    },
    projectId,
  });
}
