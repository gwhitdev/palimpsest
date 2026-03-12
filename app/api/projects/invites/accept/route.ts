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
    const message = acceptResult.error.message ?? "Failed to accept invite.";
    if (/column reference\s+"project_id"\s+is ambiguous/i.test(message)) {
      return NextResponse.json(
        {
          error: message,
          code: acceptResult.error.code ?? null,
          details: acceptResult.error.details ?? null,
          hint: acceptResult.error.hint ?? null,
          setupRequired: true,
          setupHint: "Run supabase/fix_accept_project_invite_ambiguous_project_id.sql in your database.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: message,
        code: acceptResult.error.code ?? null,
        details: acceptResult.error.details ?? null,
        hint: acceptResult.error.hint ?? null,
      },
      { status: 400 },
    );
  }

  const inviteSummary = Array.isArray(acceptResult.data) ? acceptResult.data[0] : null;
  const resolvedProjectId =
    inviteSummary?.project_id ?? inviteSummary?.invited_project_id ?? null;
  const resolvedRole =
    inviteSummary?.role ?? inviteSummary?.invited_role ?? null;

  return NextResponse.json({
    success: true,
    projectId: resolvedProjectId,
    role: resolvedRole,
  });
}
