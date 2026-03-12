import { NextResponse } from "next/server";
import { isMissingRelationError, missingBaseSchemaResponse, requireAdmin } from "@/lib/server/adminAuth";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("coders")
    .select("id, display_name, role, created_at")
    .order("display_name", { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) {
      return missingBaseSchemaResponse();
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ coders: data ?? [] });
}
