import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const baseSchemaSetupHint = "Run supabase/base_schema.sql in Supabase SQL Editor first.";

type AdminAuthSuccess = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

type AdminAuthFailure = {
  ok: false;
  response: NextResponse;
};

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure;

type PgErrorLike = {
  code?: string;
  message?: string;
};

export function isMissingRelationError(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation\s+\"?.+\"?\s+does not exist/i.test(error.message ?? "");
}

export function missingBaseSchemaResponse() {
  return NextResponse.json(
    {
      error: "Core schema is not set up.",
      setupRequired: true,
      setupHint: baseSchemaSetupHint,
    },
    { status: 400 },
  );
}

export async function requireAdmin(): Promise<AdminAuthResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorised" }, { status: 401 }),
    };
  }

  const { data: coder, error: roleError } = await supabase
    .from("coders")
    .select("role")
    .eq("id", user.id)
    .single();

  if (isMissingRelationError(roleError)) {
    return {
      ok: false,
      response: missingBaseSchemaResponse(),
    };
  }

  if (roleError || !coder || coder.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
  };
}
