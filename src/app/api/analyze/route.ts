import { analyzeBuyerRequest } from "@/lib/agents/analyze";
import { GeminiAgentError } from "@/lib/agents/gemini";
import type { AgentApiError } from "@/lib/agents/types";

const MAX_QUERY_LENGTH = 800;

function errorResponse(message: string, status: number, code: string) {
  return Response.json({ error: message, code } satisfies AgentApiError, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Send a valid JSON request.", 400, "INVALID_JSON");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse("Request body must be an object.", 400, "INVALID_BODY");
  }

  const rawQuery = (body as Record<string, unknown>).query;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) return errorResponse("Tell VETO what you want to buy.", 400, "QUERY_REQUIRED");
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResponse(
      `Keep your request under ${MAX_QUERY_LENGTH} characters.`,
      400,
      "QUERY_TOO_LONG",
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "Buyer interpretation is not configured. Add GEMINI_API_KEY to the server environment.",
      503,
      "MISSING_GEMINI_API_KEY",
    );
  }

  try {
    const analysis = await analyzeBuyerRequest(query, apiKey);
    return Response.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GeminiAgentError) {
      return errorResponse(error.message, error.status, error.code);
    }
    return errorResponse(
      "VETO could not validate the buyer analysis. Please try again.",
      502,
      "ANALYSIS_FAILED",
    );
  }
}
