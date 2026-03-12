import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const email = user.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ invites: [] });
  }

  const inviteResult = await supabase
    .from("project_invites")
    .select("id, token, project_id, email, role, grant_permissions, deny_permissions, status, expires_at, created_at, projects(name)")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .ilike("email", email)
    .order("created_at", { ascending: false });

  if (inviteResult.error) {
    return NextResponse.json({ error: inviteResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ invites: inviteResult.data ?? [] });
}
