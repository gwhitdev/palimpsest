import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { extractProjectId, resolveProjectContext } from "@/lib/server/projectAuth";
import { TAXONOMY } from "@/lib/taxonomy";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const body = (await request.json()) as {
    text?: string;
    documentId?: string;
    projectId?: string;
  };

  const auth = await resolveProjectContext(extractProjectId(request, body), "annotate");
  if (!auth.ok) return auth.response;

  const { text, documentId } = body;

  if (!text || !documentId) {
    return NextResponse.json(
      { error: "Both text and documentId are required." },
      { status: 400 },
    );
  }

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

  const raw = message.content[0]?.type === "text" ? message.content[0].text : "[]";

  try {
    const suggestions = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return NextResponse.json({ suggestions, documentId });
  } catch {
    return NextResponse.json({ suggestions: [], documentId, raw });
  }
}
