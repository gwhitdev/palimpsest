import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isProjectPermission,
  ProjectPermission,
  resolveProjectContext,
} from "@/lib/server/projectAuth";

type InviteBody = {
  projectId?: string;
  email?: string;
  role?: "owner" | "coder";
  grantPermissions?: string[];
  denyPermissions?: string[];
  expiresInDays?: number;
};

type UpdateInviteBody = {
  projectId?: string;
  inviteId?: string;
  action?: "revoke";
};

const normalizePermissions = (values: string[] | undefined): ProjectPermission[] => {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].filter(isProjectPermission);
};

const listInvalidPermissions = (values: string[] | undefined): string[] => {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].filter(
    (value) => !isProjectPermission(value),
  );
};

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "invite_members");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;
  const inviteResult = await supabase
    .from("project_invites")
    .select("id, token, email, role, grant_permissions, deny_permissions, status, expires_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (inviteResult.error) {
    return NextResponse.json({ error: inviteResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ invites: inviteResult.data ?? [], projectId });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as InviteBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "invite_members");
  if (!auth.ok) return auth.response;

  const { supabase, projectId, userId } = auth.context;
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const role = body.role === "owner" ? "owner" : "coder";
  const invalidPermissions = [
    ...listInvalidPermissions(body.grantPermissions),
    ...listInvalidPermissions(body.denyPermissions),
  ];

  if (invalidPermissions.length > 0) {
    return NextResponse.json(
      { error: `Invalid permission keys: ${invalidPermissions.join(", ")}` },
      { status: 400 },
    );
  }

  const grantPermissions = normalizePermissions(body.grantPermissions);
  const denyPermissions = normalizePermissions(body.denyPermissions);
  const expiresInDays = Number.isFinite(body.expiresInDays) ? Number(body.expiresInDays) : 14;
  const safeExpiresInDays = Math.min(Math.max(expiresInDays, 1), 60);

  const inviteInsert = await supabase
    .from("project_invites")
    .insert({
      project_id: projectId,
      email,
      role,
      grant_permissions: grantPermissions,
      deny_permissions: denyPermissions,
      invited_by: userId,
      expires_at: new Date(Date.now() + safeExpiresInDays * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id, token, email, role, grant_permissions, deny_permissions, status, expires_at, created_at")
    .single();

  if (inviteInsert.error) {
    return NextResponse.json({ error: inviteInsert.error.message }, { status: 500 });
  }

  return NextResponse.json({ invite: inviteInsert.data, projectId });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as UpdateInviteBody;
  const auth = await resolveProjectContext(extractProjectId(request, body), "invite_members");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;

  if (!body.inviteId) {
    return NextResponse.json({ error: "inviteId is required." }, { status: 400 });
  }

  if (body.action !== "revoke") {
    return NextResponse.json({ error: "action must be revoke." }, { status: 400 });
  }

  const updateResult = await supabase
    .from("project_invites")
    .update({ status: "revoked" })
    .eq("id", body.inviteId)
    .eq("project_id", projectId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Pending invite not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, inviteId: body.inviteId, projectId });
}
