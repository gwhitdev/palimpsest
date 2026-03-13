import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { extractProjectId, forbiddenResponse, resolveProjectContext } from "@/lib/server/projectAuth";
import { TAXONOMY } from "@/lib/taxonomy";

type AnthropicErrorLike = {
  status?: number;
  message?: string;
  requestID?: string;
  error?: {
    type?: string;
    message?: string;
  };
};

function getErrorDetails(error: unknown) {
  const apiError = error as AnthropicErrorLike;
  const status = apiError.status ?? 500;
  const providerType = apiError.error?.type;
  const providerMessage = apiError.error?.message ?? apiError.message ?? "Unknown Anthropic error.";
  const providerRequestId = apiError.requestID;

  const normalized = providerMessage.toLowerCase();
  const isBillingError =
    normalized.includes("credit balance is too low") ||
    normalized.includes("purchase credits") ||
    normalized.includes("plans & billing") ||
    normalized.includes("insufficient credits");

  return { status, providerType, providerMessage, providerRequestId, isBillingError };
}

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
    if (auth.context.role !== "owner") {
      return forbiddenResponse("Only project owners can generate AI suggestions.");
    }

    const { text, documentId } = body;

    if (!text || !documentId) {
      return NextResponse.json(
        { error: "Both text and documentId are required." },
        { status: 400 },
      );
    }

    const anthropic = new Anthropic({ apiKey });
    const preferredModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
    const fallbackModel = process.env.ANTHROPIC_FALLBACK_MODEL || "claude-3-5-haiku-20241022";
    const techList = TAXONOMY.map((tech) => `${tech.id}: ${tech.name} - ${tech.plainName}`).join("\n");

    const createSuggestions = async (model: string) => {
      return anthropic.messages.create({
        model,
        max_tokens: 1000,
        system: `You are a rhetorical analysis assistant.
Identify manipulation techniques using this taxonomy:
${techList}
Respond ONLY with a JSON array. Each item must be:
{"techId": "S1", "text": "exact quote max 100 chars"}
Identify 3-6 instances. No markdown. No preamble.`,
        messages: [{ role: "user", content: `Analyse:\n\n${text}` }],
      });
    };

    let message;
    let usedModel = preferredModel;

    try {
      message = await createSuggestions(preferredModel);
    } catch (error) {
      const details = getErrorDetails(error);
      const shouldRetryWithFallback =
        fallbackModel !== preferredModel &&
        (details.status === 403 || details.status === 404);

      if (!shouldRetryWithFallback) {
        throw error;
      }

      message = await createSuggestions(fallbackModel);
      usedModel = fallbackModel;
    }

    const rawTextPart = message.content.find((part) => part.type === "text");
    const raw = rawTextPart?.type === "text" ? rawTextPart.text : "[]";
    const cleaned = raw.replace(/```json|```/g, "").trim();

    try {
      const parsed = cleaned.length > 0 ? JSON.parse(cleaned) : [];
      const suggestions = Array.isArray(parsed) ? parsed : [];
      return NextResponse.json({ suggestions, documentId, model: usedModel });
    } catch {
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");

      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, end + 1));
          const suggestions = Array.isArray(parsed) ? parsed : [];
          return NextResponse.json({ suggestions, documentId, model: usedModel });
        } catch {
          return NextResponse.json({ suggestions: [], documentId, model: usedModel });
        }
      }

      return NextResponse.json({ suggestions: [], documentId, model: usedModel });
    }
  } catch (error) {
    const details = getErrorDetails(error);
    const status = details.status;

    if (status === 402) {
      return NextResponse.json(
        {
          error:
            "Anthropic API billing issue: this key has no available API credits. Add credits in the Anthropic Console Billing page.",
          providerType: details.providerType,
          providerMessage: details.providerMessage,
          providerRequestId: details.providerRequestId,
        },
        { status: 402 },
      );
    }

    if (status === 400 && details.isBillingError) {
      return NextResponse.json(
        {
          error:
            "Anthropic API billing issue: this key has no available API credits. Add credits in the Anthropic Console Billing page.",
          providerType: details.providerType,
          providerMessage: details.providerMessage,
          providerRequestId: details.providerRequestId,
        },
        { status: 402 },
      );
    }

    if (status === 429) {
      return NextResponse.json(
        {
          error:
            "Anthropic API rate/usage limit reached. Wait a moment or increase your API limits in Anthropic Console.",
          providerType: details.providerType,
          providerMessage: details.providerMessage,
          providerRequestId: details.providerRequestId,
        },
        { status: 429 },
      );
    }

    if (status === 401 || status === 403) {
      return NextResponse.json(
        {
          error:
            "Anthropic API authentication failed. Verify ANTHROPIC_API_KEY is correct and active for API access.",
          providerType: details.providerType,
          providerMessage: details.providerMessage,
          providerRequestId: details.providerRequestId,
        },
        { status },
      );
    }

    const message = error instanceof Error ? error.message : "AI suggestion request failed.";
    return NextResponse.json(
      {
        error: message,
        providerType: details.providerType,
        providerMessage: details.providerMessage,
        providerRequestId: details.providerRequestId,
      },
      { status: 500 },
    );
  }
}
