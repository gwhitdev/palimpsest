import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type PgErrorLike = {
  code?: string;
  message?: string;
};

function isMissingCloseAccountFunction(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;

  return (
    error.code === "PGRST202" ||
    /close_own_account/i.test(error.message ?? "")
  );
}

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const closeResult = await supabase.rpc("close_own_account");

  if (isMissingCloseAccountFunction(closeResult.error)) {
    return NextResponse.json(
      {
        error: "Account closure function is not set up.",
        setupRequired: true,
        setupHint: "Run supabase/account_management.sql in your database.",
      },
      { status: 400 },
    );
  }

  if (closeResult.error) {
    return NextResponse.json({ error: closeResult.error.message }, { status: 500 });
  }

  await supabase.auth.signOut();

  return NextResponse.json({ success: true });
}
