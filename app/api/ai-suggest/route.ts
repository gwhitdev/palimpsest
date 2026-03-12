import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { extractProjectId, resolveProjectContext } from "@/lib/server/projectAuth";
import { TAXONOMY } from "@/lib/taxonomy";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured." },
        { status: 500 },
      );
    }

    let body: { text?: string; documentId?: string; projectId?: string };
    try {
      body = (await request.json()) as { text?: string; documentId?: string; projectId?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
    if (!auth.ok) return auth.response;

    const { text, documentId } = body;

    if (!text || !documentId) {
      return NextResponse.json(
        { error: "Both text and documentId are required." },
        { status: 400 },
      );
    }

    const anthropic = new Anthropic({ apiKey });
    const techList = TAXONOMY.map((tech) => `${tech.id}: ${tech.name} - ${tech.plainName}`).join("\n");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `You are a rhetorical analysis assistant.
Identify manipulation techniques using this taxonomy:
${techList}
Respond ONLY with a JSON array. Each item must be:
{"techId": "S1", "text": "exact quote max 100 chars"}
Identify 3-6 instances. No markdown. No preamble.`,
      messages: [{ role: "user", content: `Analyse:\n\n${text}` }],
    });

    const rawTextPart = message.content.find((part) => part.type === "text");
    const raw = rawTextPart?.type === "text" ? rawTextPart.text : "[]";
    const cleaned = raw.replace(/```json|```/g, "").trim();

    try {
      const parsed = cleaned.length > 0 ? JSON.parse(cleaned) : [];
      const suggestions = Array.isArray(parsed) ? parsed : [];
      return NextResponse.json({ suggestions, documentId });
    } catch {
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");

      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, end + 1));
          const suggestions = Array.isArray(parsed) ? parsed : [];
          return NextResponse.json({ suggestions, documentId });
        } catch {
          return NextResponse.json({ suggestions: [], documentId });
        }
      }

      return NextResponse.json({ suggestions: [], documentId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI suggestion request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
