import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AcceptInviteBody = {
  token?: string;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = (await request.json()) as AcceptInviteBody;
  if (!body.token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  const acceptResult = await supabase.rpc("accept_project_invite", {
    invite_token: body.token,
  });

  if (acceptResult.error) {
    return NextResponse.json({ error: acceptResult.error.message }, { status: 400 });
  }

  const inviteSummary = Array.isArray(acceptResult.data) ? acceptResult.data[0] : null;
  return NextResponse.json({
    success: true,
    projectId: inviteSummary?.project_id ?? null,
    role: inviteSummary?.role ?? null,
  });
}
