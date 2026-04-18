const TIMEOUT_MS = 120000; // 2 min — Opus full reports can take a while

// Model IDs. Override via env if needed.
const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-5-20250929";
const OPUS_MODEL   = process.env.CLAUDE_OPUS_MODEL   || "claude-opus-4-1-20250805";

/**
 * Smart routing: pick the right Claude model for the job.
 *  - analyze: Opus (heavy-duty — reasoning over a full file, building full report)
 *  - refine:  Sonnet (focused, fast — single section edits)
 *  - chat:    Sonnet (back-and-forth edits)
 *
 * User can override via `provider` param (e.g. "claude-opus" forces Opus for chat).
 */
function pickModel(provider, requestType) {
  if (provider === "claude-opus") return OPUS_MODEL;
  if (provider === "claude-sonnet") return SONNET_MODEL;
  // Auto / default → smart routing based on request type
  if (requestType === "analyze") return OPUS_MODEL;
  return SONNET_MODEL;
}

export function getAvailableProviders() {
  const hasKey = Boolean(process.env.CLAUDE_API_KEY);
  if (!hasKey) return [];
  return [
    { id: "claude-sonnet", name: "Claude Sonnet 4.5 — fast & smart",      model: SONNET_MODEL, available: true },
    { id: "claude-opus",   name: "Claude Opus 4.1 — heavy-duty reasoning", model: OPUS_MODEL,   available: true },
  ];
}

export function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text); } catch (e) {}
  const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (m) { try { return JSON.parse(m[1].trim()); } catch (e) {} }
  const j = text.match(/\{[\s\S]*\}/);
  if (j) { try { return JSON.parse(j[0]); } catch (e) {} }
  return null;
}

/**
 * Low-level Anthropic API call.
 * Uses prompt caching on the system prompt so repeated calls (especially
 * in AI chat) pay 90% off on the cached tokens.
 */
async function callClaude({ model, systemPrompt, userMessage, maxTokens = 8192, timeout = TIMEOUT_MS }) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // System prompt as a cacheable block so Anthropic can reuse it across calls.
    // (Min block size is 1024 tokens — our system prompts are ~2K–8K so they qualify.)
    const system = [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
    ];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error("Claude API error (" + res.status + "): " + err);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    const usage = data?.usage || {};
    return {
      text,
      raw: data,
      model,
      tokensIn:         (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
      tokensOut:         usage.output_tokens || 0,
      cachedReadTokens: usage.cache_read_input_tokens || 0,
      cacheWriteTokens: usage.cache_creation_input_tokens || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Public entry point. `provider` is optional — omit it to let smart
 * routing pick the right model for the `requestType`.
 *
 * Supported providers: "claude-sonnet", "claude-opus", or undefined (auto).
 *
 * Legacy IDs ("gemini", "perplexity", "claude") are accepted and mapped
 * to Sonnet so older clients keep working.
 */
export async function callAI(provider, systemPrompt, userMessage, options = {}) {
  const normalized = normalizeProvider(provider);
  const model = pickModel(normalized, options.requestType);
  return callClaude({
    model,
    systemPrompt,
    userMessage,
    maxTokens: options.maxTokens || 8192,
    timeout: options.timeout,
  });
}

function normalizeProvider(p) {
  if (!p) return undefined;
  if (p === "claude-sonnet" || p === "claude-opus") return p;
  // Legacy aliases → Sonnet (safe default)
  if (p === "claude" || p === "gemini" || p === "perplexity") return "claude-sonnet";
  return undefined;
}

export function buildReportSystemPrompt(dataSummary, templateData) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let prompt = "You are CALO Report AI, an expert data analyst. Analyze the data and produce a professional report.\n\n" +
    "Return ONLY valid JSON (no markdown, no code blocks):\n" +
    "{ \"title\": \"Report Title\", \"subtitle\": \"Subtitle\", \"reportDate\": \"" + today + "\", \"brandColor\": \"#02B376\",\n" +
    "  \"kpis\": [{ \"label\": \"Name\", \"value\": \"123\", \"unit\": \"opt\", \"trend\": \"up|down|stable\" }],\n" +
    "  \"sections\": [{ \"title\": \"Section\", \"icon\": \"emoji\", \"blocks\": [...] }],\n" +
    "  \"summary\": \"Executive summary\", \"insights\": [\"insight1\"] }\n\n" +
    "BLOCK TYPES:\n" +
    "1. badge: {\"type\":\"badge\",\"label\":\"text\",\"style\":\"green|amber|red|blue\"}\n" +
    "2. notes: {\"type\":\"notes\",\"content\":\"paragraph\"}\n" +
    "3. metrics: {\"type\":\"metrics\",\"items\":[{\"label\":\"N\",\"value\":\"V\",\"change\":\"+5%\",\"trend\":\"up\"}]}\n" +
    "4. table: {\"type\":\"table\",\"headers\":[\"C1\"],\"rows\":[[\"v1\"]]}\n" +
    "5. keyvalue: {\"type\":\"keyvalue\",\"items\":[{\"key\":\"K\",\"value\":\"V\"}]}\n" +
    "6. comparison: {\"type\":\"comparison\",\"leftTitle\":\"A\",\"rightTitle\":\"B\",\"leftRows\":[{\"key\":\"k\",\"value\":\"v\"}],\"rightRows\":[{\"key\":\"k\",\"value\":\"v\"}]}\n" +
    "7. callout: {\"type\":\"callout\",\"title\":\"T\",\"value\":\"V\",\"icon\":\"emoji\"}\n" +
    "8. chart: {\"type\":\"chart\",\"chartType\":\"bar|line|pie|doughnut\",\"title\":\"T\",\"labels\":[\"A\"],\"datasets\":[{\"label\":\"S\",\"data\":[10]}]}\n" +
    "9. link: {\"type\":\"link\",\"text\":\"Link text\",\"url\":\"https://...\",\"description\":\"optional desc\"}\n" +
    "10. image: {\"type\":\"image\",\"url\":\"image-url\",\"caption\":\"optional caption\"}\n\n";

  if (templateData) {
    prompt += "TEMPLATE STRUCTURE (USE THIS AS YOUR GUIDE):\n" +
      "You MUST follow this template's structure closely. " +
      "Keep the same section titles, section order, icons, block types, and field layout. " +
      "Replace ALL placeholder values (\"0\", empty strings, placeholder text like \"Add ... here\") with REAL data from the analysis below. " +
      "If the data contains information that fits a template section, populate it fully with actual numbers, names, and insights. " +
      "If the data does not contain information for a section, provide reasonable analysis or mark values as \"N/A\". " +
      "You MAY add 1-2 extra sections if the data contains important information not covered by the template. " +
      "Preserve the template's KPI strip labels and structure, updating only the values and trends based on real data.\n" +
      "ALL values MUST be strings (even numbers: \"1234\" not 1234).\n\n" +
      "TEMPLATE JSON:\n" + JSON.stringify(templateData, null, 2) + "\n\n";
  } else {
    prompt += "GUIDELINES:\n- Identify 4-6 KPIs\n- Create 4-8 sections\n- Use charts for numerical data\n- Use comparisons for paired data\n" +
      "- Write insightful analysis\n- Generate 3-5 actionable insights\n- ALL values as strings\n\n";
  }

  prompt += "DATA:\n" + JSON.stringify(dataSummary, null, 2);
  return prompt;
}

export function buildChatSystemPrompt(reportContext) {
  return `You are CALO Report AI Assistant. You help users edit and improve their reports.

CRITICAL: Always return a JSON object with this EXACT structure:
{
  "message": "A friendly, conversational explanation of what you changed or suggest",
  "updates": null
}

When the user asks you to make changes, include the updates:
{
  "message": "I've updated the delivery metrics with the data you provided...",
  "updates": {
    "generalInfo": { "title": "New Title" },
    "sections": [ null, { "title": "Updated Section", "blocks": [...] }, null ]
  }
}

The "updates" object can contain:
- "generalInfo": { field: value } - update general info (title, reportDate, companyName, prevMonth, brandColor, kpiStrip, variant)
- "sections": sparse array where null = unchanged, object = replace/merge that section at index

BLOCK TYPE SCHEMAS (ALL values MUST be strings):
- badge: { "type":"badge", "title":"T", "subtitle":"S", "period":"P", "label":"L", "style":"green|amber|red|blue" }
- notes: { "type":"notes", "label":"L", "items":["bullet1","bullet2"] }
- metrics: { "type":"metrics", "label":"L", "items":[{"label":"N","value":"V","change":"+5%","trend":"up|down|stable"}] }
- table: { "type":"table", "label":"L", "headers":["H1","H2"], "rows":[["c1","c2"]] }
- keyvalue: { "type":"keyvalue", "label":"L", "items":[{"key":"K","value":"V"}] }
- comparison: { "type":"comparison", "label":"L", "leftTitle":"A", "rightTitle":"B", "leftRows":[{"key":"k","value":"v"}], "rightRows":[{"key":"k","value":"v"}] }
- callout: { "type":"callout", "title":"T", "value":"V", "icon":"emoji", "bgColor":"#hex", "borderColor":"#hex", "textColor":"#hex" }
- link: { "type":"link", "text":"Link text", "url":"https://...", "description":"optional desc" }
- image: { "type":"image", "url":"image-url", "caption":"optional caption" }
- kpiStrip: [{"label":"Name","value":"123","unit":"meals","trend":"up|down|stable"}]

RULES:
- If the user just asks a question or wants advice, set "updates" to null and answer in "message"
- If the user provides data (file content, pasted text, numbers), analyze it and populate "updates" with appropriate report content
- When updating sections, use null in the array for sections you are NOT changing
- When the report has no sections yet and the user asks to generate content, create complete sections with title and blocks in the "sections" array
- Each section must have a "title" string and a "blocks" array with at least one block
- The "message" field should NEVER contain JSON or code — always natural language
- ALL field values must be strings (even numbers: "1234" not 1234)
- Return ONLY the JSON object, no markdown code blocks or extra text

${reportContext ? "\nCurrent report data:\n" + JSON.stringify(reportContext, null, 2).slice(0, 8000) : ""}`;
}

export function buildRefineSystemPrompt(section, instruction) {
  return "Refine this report section per the instruction. Return ONLY updated section JSON.\n\n" +
    "Section:\n" + JSON.stringify(section, null, 2) + "\n\nInstruction: " + instruction;
}
