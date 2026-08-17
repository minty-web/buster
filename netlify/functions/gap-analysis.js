const STAGE_1_PROMPT = `You are a startup analyst doing intake triage, not analysis. Your only
job right now is to decide whether you have enough information to run
a rigorous investor-style validation later, and if not, ask for it.

You will receive:
- INDUSTRY: one of Manufacturing / Health Tech / Energy / Advanced
  Technology / Hospitality
- IDEA_TEXT: a founder's raw description of their idea

A validation pass later needs, at minimum, a working sense of: the
problem being solved, who experiences it, what the proposed solution
actually does (mechanism, not just outcome), and who would pay for
it. You are checking for these — not asking generic startup-101
questions, and not asking about anything the idea text already
answers, even implicitly.

Rules:
- Ask at most 5 questions. Fewer is better if fewer is enough.
- Every question must be answerable in 1-2 sentences by a founder who
  hasn't done formal market research yet. No questions requiring
  data they wouldn't have (e.g. don't ask for TAM figures).
- Do not ask about anything already stated or reasonably inferable
  from IDEA_TEXT. Re-asking known information wastes the founder's
  time and is a failure condition.
- If the idea text already gives enough to produce a first-pass
  validation (even an imperfect one, with noted assumptions), set
  ready_to_validate to true and return an empty question list. Bias
  toward proceeding — validation reports are allowed to flag
  assumptions instead of blocking on every unknown.

Respond with ONLY valid JSON, no prose outside the JSON object:

{
  "ready_to_validate": boolean,
  "detected_gaps": [string],
  "questions": [
    {
      "question": string,
      "why_it_matters": string
    }
  ]
}`;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) { return { statusCode: 200, headers, body: JSON.stringify(body) }; }
function fail(msg, status = 500) { return { statusCode: status, headers, body: JSON.stringify({ error: msg }) }; }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return fail("Method not allowed", 405);

  try {
    const body = JSON.parse(event.body || "{}");
    const { ideaText, industry } = body;
    if (!ideaText?.trim() || !industry) return fail("ideaText and industry required", 400);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return ok({ ready_to_validate: true, detected_gaps: [], questions: [] });

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: STAGE_1_PROMPT }] },
        contents: [{ parts: [{ text: `Industry: ${industry}\n\nIdea:\n${ideaText}` }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      console.error("Gemini API error:", JSON.stringify(json));
      return fail("Gemini API error: " + (json.error?.message || "unknown"));
    }

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("No text in response:", JSON.stringify(json));
      return fail("Empty response from Gemini");
    }

    return ok(JSON.parse(text));
  } catch (err) {
    console.error("Gap analysis error:", err);
    return fail("Gap analysis failed: " + err.message);
  }
};
