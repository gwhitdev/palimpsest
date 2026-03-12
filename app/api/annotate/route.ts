import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const docId = request.nextUrl.searchParams.get("docId");
  const query = supabase.from("annotations").select("*").order("created_at", { ascending: true });
  const { data, error } = docId && docId !== "all" ? await query.eq("document_id", docId) : await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ annotations: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const body = await request.json();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("annotations")
    .insert({ ...body, coder_id: user.id })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ annotation: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { id } = (await request.json()) as { id?: string };

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const { error } = await supabase.from("annotations").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
