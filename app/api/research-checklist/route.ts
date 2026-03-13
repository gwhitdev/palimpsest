import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type ChecklistDetails = {
  roundNumber: string;
  roundId: string;
  projectLead: string;
  coderRoster: string;
  calibrationSet: string;
  notes: string;
};

type ChecklistBody = {
  projectId?: string;
  checked?: Record<string, unknown>;
  details?: Partial<Record<keyof ChecklistDetails, unknown>>;
};

const SETUP_HINT = "Run supabase/research_project_checklist.sql.";

const DEFAULT_DETAILS: ChecklistDetails = {
  roundNumber: "",
  roundId: "",
  projectLead: "",
  coderRoster: "",
  calibrationSet: "",
  notes: "",
};

function sanitizeChecked(input: Record<string, unknown> | undefined): Record<string, boolean> {
  const checked: Record<string, boolean> = {};
  if (!input || typeof input !== "object") return checked;

  Object.entries(input).forEach(([key, value]) => {
    if (typeof key === "string" && key.trim().length > 0 && key.length <= 120 && typeof value === "boolean") {
      checked[key] = value;
    }
  });

  return checked;
}

function sanitizeDetails(
  input: Partial<Record<keyof ChecklistDetails, unknown>> | undefined,
): ChecklistDetails {
  const details = { ...DEFAULT_DETAILS };
  if (!input || typeof input !== "object") return details;

  (Object.keys(DEFAULT_DETAILS) as Array<keyof ChecklistDetails>).forEach((key) => {
    const value = input[key];
    if (typeof value === "string") {
      details[key] = value.trim();
    }
  });

  return details;
}

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;

  const result = await supabase
    .from("project_research_checklists")
    .select("checked, details, updated_at, updated_by")
    .eq("project_id", projectId)
    .maybeSingle();

  if (isMissingRelationError(result.error)) {
    return NextResponse.json({
      projectId,
      checked: {},
      details: DEFAULT_DETAILS,
      setupRequired: true,
      setupHint: SETUP_HINT,
    });
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({
    projectId,
    checked: sanitizeChecked((result.data?.checked ?? {}) as Record<string, unknown>),
    details: sanitizeDetails(
      (result.data?.details ?? DEFAULT_DETAILS) as Partial<Record<keyof ChecklistDetails, unknown>>,
    ),
    updatedAt: result.data?.updated_at ?? null,
    updatedBy: result.data?.updated_by ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as ChecklistBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId } = auth.context;
  const checked = sanitizeChecked(body.checked);
  const details = sanitizeDetails(body.details);

  const updateResult = await supabase
    .from("project_research_checklists")
    .upsert(
      {
        project_id: projectId,
        checked,
        details,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    )
    .select("checked, details, updated_at, updated_by")
    .single();

  if (isMissingRelationError(updateResult.error)) {
    return NextResponse.json(
      {
        error: "Research checklist table is not set up.",
        setupRequired: true,
        setupHint: SETUP_HINT,
      },
      { status: 400 },
    );
  }

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    projectId,
    checked: sanitizeChecked((updateResult.data.checked ?? {}) as Record<string, unknown>),
    details: sanitizeDetails(
      (updateResult.data.details ?? DEFAULT_DETAILS) as Partial<Record<keyof ChecklistDetails, unknown>>,
    ),
    updatedAt: updateResult.data.updated_at,
    updatedBy: updateResult.data.updated_by,
  });
}
