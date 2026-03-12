import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isProjectPermission,
  isMissingRelationError,
  ProjectPermission,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

type MembershipRow = {
  user_id: string;
  role: "owner" | "coder";
  created_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string;
  created_at?: string;
};

type PermissionRow = {
  user_id: string;
  permission: string;
  effect: "allow" | "deny";
};

type UpdateMemberBody = {
  projectId?: string;
  userId?: string;
  role?: "owner" | "coder";
  grantPermissions?: string[];
  denyPermissions?: string[];
};

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "manage_members");
  if (!auth.ok) return auth.response;

  const { projectId, supabase } = auth.context;

  const { data: memberships, error: membershipsError } = await supabase
    .from("project_memberships")
    .select("user_id, role, created_at")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (isMissingRelationError(membershipsError)) {
    return schemaNotReadyResponse();
  }

  if (membershipsError) {
    return NextResponse.json({ error: membershipsError.message }, { status: 500 });
  }

  const userIds = ((memberships ?? []) as MembershipRow[]).map((membership) => membership.user_id);

  const { data: profiles, error: profilesError } = await supabase
    .from("coders")
    .select("id, display_name, created_at")
    .in("id", userIds);

  if (isMissingRelationError(profilesError)) {
    return schemaNotReadyResponse();
  }

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const profileMap = new Map<string, ProfileRow>(
    ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );

  const permissionsResult = await supabase
    .from("project_member_permissions")
    .select("user_id, permission, effect")
    .eq("project_id", projectId);

  if (permissionsResult.error) {
    return NextResponse.json({ error: permissionsResult.error.message }, { status: 500 });
  }

  const permissionMap = new Map<string, { grantPermissions: string[]; denyPermissions: string[] }>();
  ((permissionsResult.data ?? []) as PermissionRow[]).forEach((row) => {
    const current = permissionMap.get(row.user_id) ?? { grantPermissions: [], denyPermissions: [] };
    if (row.effect === "allow") {
      current.grantPermissions.push(row.permission);
    } else {
      current.denyPermissions.push(row.permission);
    }
    permissionMap.set(row.user_id, current);
  });

  const coders = ((memberships ?? []) as MembershipRow[]).map((membership) => ({
    id: membership.user_id,
    display_name: profileMap.get(membership.user_id)?.display_name ?? "Unknown User",
    role: membership.role,
    created_at: membership.created_at,
    grantPermissions: permissionMap.get(membership.user_id)?.grantPermissions ?? [],
    denyPermissions: permissionMap.get(membership.user_id)?.denyPermissions ?? [],
  }));

  return NextResponse.json({ coders, projectId });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as UpdateMemberBody;

  const isPermissionUpdate = Array.isArray(body.grantPermissions) || Array.isArray(body.denyPermissions);
  const requiredPermission: ProjectPermission = isPermissionUpdate ? "manage_permissions" : "manage_members";
  const auth = await resolveProjectContext(extractProjectId(request, body), requiredPermission);
  if (!auth.ok) return auth.response;

  const { projectId, supabase, userId: actorUserId } = auth.context;
  const targetUserId = body.userId;

  if (!targetUserId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  if (!body.role && !isPermissionUpdate) {
    return NextResponse.json(
      { error: "Provide role and/or grantPermissions/denyPermissions to update a member." },
      { status: 400 },
    );
  }

  if (body.role) {
    if (body.role !== "owner" && body.role !== "coder") {
      return NextResponse.json({ error: "role must be either owner or coder." }, { status: 400 });
    }

    if (actorUserId === targetUserId && body.role === "coder") {
      const ownerCountResult = await supabase
        .from("project_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "active")
        .eq("role", "owner");

      if (ownerCountResult.error) {
        return NextResponse.json({ error: ownerCountResult.error.message }, { status: 500 });
      }

      if ((ownerCountResult.count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the final owner from the project." },
          { status: 400 },
        );
      }
    }

    const roleUpdateResult = await supabase
      .from("project_memberships")
      .update({ role: body.role })
      .eq("project_id", projectId)
      .eq("user_id", targetUserId)
      .eq("status", "active");

    if (roleUpdateResult.error) {
      return NextResponse.json({ error: roleUpdateResult.error.message }, { status: 500 });
    }
  }

  if (isPermissionUpdate) {
    const collectInvalidPermissions = (values: string[] | undefined): string[] => {
      return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].filter(
        (value) => !isProjectPermission(value),
      );
    };

    const invalidPermissions = [
      ...collectInvalidPermissions(body.grantPermissions),
      ...collectInvalidPermissions(body.denyPermissions),
    ];

    if (invalidPermissions.length > 0) {
      return NextResponse.json(
        { error: `Invalid permission keys: ${invalidPermissions.join(", ")}` },
        { status: 400 },
      );
    }

    const normalizePermissions = (values: string[] | undefined): ProjectPermission[] => {
      return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].filter(isProjectPermission);
    };

    const grantPermissions = normalizePermissions(body.grantPermissions);
    const denyPermissions = normalizePermissions(body.denyPermissions);

    const deleteResult = await supabase
      .from("project_member_permissions")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", targetUserId);

    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
    }

    const rows = [
      ...grantPermissions.map((permission) => ({
        project_id: projectId,
        user_id: targetUserId,
        permission,
        effect: "allow" as const,
        created_by: actorUserId,
      })),
      ...denyPermissions.map((permission) => ({
        project_id: projectId,
        user_id: targetUserId,
        permission,
        effect: "deny" as const,
        created_by: actorUserId,
      })),
    ];

    if (rows.length > 0) {
      const insertResult = await supabase.from("project_member_permissions").insert(rows);
      if (insertResult.error) {
        return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ success: true, projectId, userId: targetUserId });
}
