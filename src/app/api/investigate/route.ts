import { investigateProducts } from "@/lib/investigation/investigate";
import type { InvestigationApiError } from "@/lib/investigation/types";
import {
  InvestigationValidationError,
  validateInvestigationRequest,
} from "@/lib/investigation/validate";

function errorResponse(message: string, status: number, code: string) {
  return Response.json({ error: message, code } satisfies InvestigationApiError, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Send a valid JSON request.", 400, "INVALID_JSON");
  }

  let input;
  try {
    input = validateInvestigationRequest(body);
  } catch (error) {
    if (error instanceof InvestigationValidationError) {
      return errorResponse(error.message, 400, error.code);
    }
    return errorResponse("The investigation request is invalid.", 400, "INVALID_REQUEST");
  }

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) {
    return errorResponse(
      "Evidence retrieval is not configured. Add APIFY_API_TOKEN to the server environment.",
      503,
      "MISSING_APIFY_TOKEN",
    );
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return errorResponse(
      "Evidence analysis is not configured. Add GEMINI_API_KEY to the server environment.",
      503,
      "MISSING_GEMINI_API_KEY",
    );
  }

  try {
    const result = await investigateProducts(input, apifyToken, geminiKey);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("VETO investigation route failure", {
        category: error instanceof Error ? error.name : "unknown-error",
      });
    }
    return errorResponse(
      "VETO could not complete the investigation. No findings were fabricated.",
      502,
      "INVESTIGATION_FAILED",
    );
  }
}
