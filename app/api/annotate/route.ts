import { NextRequest, NextResponse } from "next/server";
import { extractProjectId, resolveProjectContext } from "@/lib/server/projectAuth";

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;
  const docId = request.nextUrl.searchParams.get("docId");
  const query = supabase
    .from("annotations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const { data, error } = docId && docId !== "all" ? await query.eq("document_id", docId) : await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ annotations: data ?? [], projectId });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, userId, projectId } = auth.context;
  const annotationInput = { ...body };
  delete annotationInput.projectId;

  const { data, error } = await supabase
    .from("annotations")
    .insert({ ...annotationInput, project_id: projectId, coder_id: userId })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ annotation: data, projectId });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { id?: string; projectId?: string };
  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const { error } = await supabase
    .from("annotations")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, projectId });
}
