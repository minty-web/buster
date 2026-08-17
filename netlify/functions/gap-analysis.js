const { GoogleGenAI } = require("@google/genai");

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

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { ideaText, industry } = body;

    if (!ideaText?.trim() || !industry) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "ideaText and industry required" }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback: return ready to validate with no questions
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ready_to_validate: true, detected_gaps: [], questions: [] }),
      };
    }

    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `Industry: ${industry}\n\nIdea:\n${ideaText}`,
      config: {
        systemInstruction: STAGE_1_PROMPT,
        responseMimeType: "application/json",
      },
    });

    console.log('Gemini response keys:', Object.keys(response));
    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(JSON.parse(text)),
    };
  } catch (err) {
    console.error("Gap analysis error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Gap analysis failed: " + err.message }),
    };
  }
};
