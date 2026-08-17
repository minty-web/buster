import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50kb" }));
app.use(express.static("."));

let genAI = null;
const hasKey = !!process.env.GEMINI_API_KEY;
if (hasKey) {
  const { GoogleGenAI } = await import("@google/genai");
  genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
  console.warn("GEMINI_API_KEY not set — using mock responses. Get free key at https://aistudio.google.com/app/apikey");
}

/* ─ Prompts ── */

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

const STAGE_2_PROMPT = `You are a startup analyst conducting a first-pass evaluation of a new
venture idea. You think rigorously, avoid generic filler, and flag
weak assumptions rather than validating them by default. You are
honest about what you don't know rather than inventing specifics to
sound thorough.

You will receive INDUSTRY, IDEA_TEXT, and (if the founder was asked)
their answers to earlier clarifying questions. Treat the answers as
additional founder input, not verified fact.

Produce the report below in exactly these seven numbered sections, in
this order, using these headers verbatim. Use bullets, not prose,
wherever a bullet works. Do not add an overall verdict, a "next steps"
section, or a summary beyond what's specified — the sections below
are the entire output.

Whenever you state something the idea text didn't actually establish,
mark it inline as "(inferred)". Do not silently upgrade an assumption
into a stated fact.

1. VALUE PROPOSITION
- Core problem, target industry, and expected user, in one sentence.
- Whether the idea has a distinct selling point in specific
  geographies or industry niches, or if it's generic.
- Why this is meaningfully better than the status quo — name the
  actual mechanism of advantage, not "faster/cheaper."
- Which part of the value prop is unproven or assumed rather than
  demonstrated by anything in the idea text.

2. TARGET MARKET
- The market in concrete terms: industry, geography, size signal if
  one can be reasonably inferred.
- Which sub-segment would adopt first, and why that segment specifically.
- Whether the market as described is too broad, too narrow, or
  ambiguously defined.

3. IDEAL CLIENT PROFILE (ICP)
- The specific buyer/user: role, org size or demographic, budget
  authority, how intense their pain is.
- 3-5 concrete firmographic or behavioral signals that would identify
  this ICP in the wild.
- Where the "ideal" buyer and the "easiest to reach" buyer diverge, if
  they do.

4. RELEVANT COMPETITORS
- Up to 5 direct competitors (same solution, same problem) and up to
  5 indirect competitors (different solution or workaround for the
  same problem, including manual processes or "do nothing").
- One-line differentiation per competitor: what this idea does that
  they don't, or vice versa.
- If you are not confident specific named competitors exist for this
  space, say so explicitly instead of inventing company names.

5. RISKS AND WEAKNESSES
- The 3-4 biggest risks (market, execution, technical, regulatory,
  timing — whichever apply), ranked by severity.
- For each: what would have to be true for that risk to sink the idea.
- Any internal contradiction or unstated assumption in the idea text
  itself.

6. HOW TO ATTRACT ANGEL INVESTORS
- The single strongest unique selling point to lead with, given
  everything above.
- How to pitch this to an investor — concrete guidance in under 500
  characters.
- What a business plan for this idea needs to cover: roadmap and
  timeline, investment ask, and path to ROI.

7. EXPECTED ACTIONS
- The next 2 concrete actions a startup analyst would have this
  founder do next, in priority order.

Formatting: exactly these seven numbered headers, verbatim, in order.
4-5 bullets per section. No content outside the seven sections.`;

/* ── Routes ── */

app.post("/api/gap-analysis", async (req, res) => {
  const { ideaText, industry } = req.body;
  if (!ideaText?.trim() || !industry) return res.status(400).json({ error: "ideaText and industry required" });

  if (!genAI) {
    return res.json({ ready_to_validate: true, detected_gaps: [], questions: [] });
  }

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Industry: ${industry}\n\nIdea:\n${ideaText}`,
      config: {
        systemInstruction: STAGE_1_PROMPT,
        responseMimeType: "application/json",
      },
    });
    res.json(JSON.parse(response.text));
  } catch (err) {
    console.error("Stage 1 error:", err.message);
    res.status(500).json({ error: "Gap analysis failed" });
  }
});

app.post("/api/validate", async (req, res) => {
  const { ideaText, industry, answers } = req.body;
  if (!ideaText?.trim() || !industry) return res.status(400).json({ error: "ideaText and industry required" });

  const answersText = answers
    ? Object.entries(answers).map(([k, v]) => `Q${parseInt(k) + 1}: ${v}`).join("\n")
    : "(No additional context)";

  if (!genAI) {
    return res.json({ report: mockReport(industry, ideaText) });
  }

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Industry: ${industry}\n\nIdea:\n${ideaText}\n\nAdditional context from founder:\n${answersText}`,
      config: { systemInstruction: STAGE_2_PROMPT },
    });
    res.json({ report: response.text });
  } catch (err) {
    console.error("Stage 2 error:", err.message);
    res.status(500).json({ error: "Validation failed" });
  }
});

/* ── Mock fallback ── */

function mockReport(industry, idea) {
  return `1. VALUE PROPOSITION
- This idea targets the **${industry}** sector by solving a workflow pain point for early-stage operators.
- The differentiation hinges on a streamlined mechanism (inferred) rather than incremental feature gains.
- Status quo: most teams cobble together spreadsheets + generic AI tools — this bundles the workflow into one pass.
- Unproven: whether target users perceive the problem as acute enough to switch tools.

2. TARGET MARKET
- Primary: small teams (1–10 people) in **${industry}** validating new product concepts.
- Geography: English-speaking markets first (US, UK, AU), then EU.
- Sub-segment to adopt first: solo founders and indie hackers — they have the shortest decision loops.
- Market is moderately broad; narrowing by revenue stage ($0–$500K) would sharpen focus.

3. IDEAL CLIENT PROFILE (ICP)
- Role: founder or product lead at a pre-seed / seed-stage company.
- Org size: 1–5 people, < $1M ARR, actively exploring a new vertical.
- Pain intensity: high — they've already spent 2+ weeks researching manually.
- Signals: active on YC forum, Indie Hackers, Twitter/X startup threads.
- Ideal vs easiest: ideal is a funded founder with budget; easiest is a solopreneur on a free tier.

4. RELEVANT COMPETITORS
- Direct: ChatGPT + custom prompts (generic, not structured for validation).
- Direct: MomTest-inspired tools (focus on interviews, not analysis).
- Indirect: Manual customer discovery (spreadsheets, Typeform, Notion templates).
- Indirect: "Do nothing" — founders skip validation and build anyway (the biggest competitor).
- Differentiation: structured, report-grade output in one shot vs fragmented DIY workflows.

5. RISKS AND WEAKNESSES
- **Market risk (highest):** Founders may not value validation enough to pay. Would need proven willingness-to-pay data.
- **Execution risk:** Competing against free, generic AI — moat must be workflow + brand, not just prompts.
- **Technical risk:** Low — this is an LLM wrapper; the risk is output quality, not infrastructure.
- **Assumption in idea:** That founders want AI to validate rather than validate manually — not proven.

6. HOW TO ATTRACT ANGEL INVESTORS
- Strongest USP: turns a 4-week validation process into a 10-minute report with structured, investor-grade output.
- Pitch: "Buster replaces the first month of a founder's validation work with a 10-minute AI analysis. We give founders an investor-grade report on market, ICP, competitors, and risks — so they decide to build or kill an idea before writing code. $19/mo, targeting the 2M+ new founders each year."
- Business plan must cover: 12-month roadmap, $150K ask for 18 months runway, path to 5K paid users.

7. EXPECTED ACTIONS
- Interview 10 founders who validated in the last 6 months — ask what they actually did, what they'd pay for.
- Launch a landing page with the report preview; measure sign-up conversion before building the full product.`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Buster running on http://localhost:${PORT}`));
