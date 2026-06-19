const TIMEOUT_MS = 120000; // 2 min — chat/refine
const ANALYZE_TIMEOUT_MS = 480000; // 8 min — adaptive thinking on full reports
const CHAT_CONTEXT_CHAR_LIMIT = 8000; // current report state attached to the chat path
const ANALYZE_MAX_TOKENS = 32000;     // output budget for the heavy /analyze path
const DEFAULT_MAX_TOKENS = 16000;     // output budget for /chat and /refine

// Model IDs. Override via env if needed.
// Opus is the strongest reasoning model and the right choice for the /analyze
// path; Sonnet stays as the fast iteration model for /chat and /refine.
const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-6";
const OPUS_MODEL   = process.env.CLAUDE_OPUS_MODEL   || "claude-opus-4-7";

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
    { id: "claude-sonnet", name: "Claude Sonnet 4.6 — fast & smart",      model: SONNET_MODEL, available: true },
    { id: "claude-opus",   name: "Claude Opus 4.7 — heavy-duty reasoning", model: OPUS_MODEL,   available: true },
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
 *
 * Prompt caching: the static system prompt is one cacheable block; an optional
 * `dynamicContext` (e.g. the current report state for the chat path) is a
 * SECOND cacheable block placed AFTER the static one. Splitting them this
 * way means the static-block cache hits every chat turn even though the
 * report state changes — previously the two were concatenated and any
 * change to the report invalidated the whole system prompt.
 *
 * Thinking: pass `thinking: true` to enable adaptive thinking on Opus 4.7
 * (heavy /analyze path). Adaptive thinking automatically interleaves with
 * tool calls and decides depth per request. Sonnet 4.6 chat/refine paths
 * stay non-thinking for fast iteration.
 *
 * Effort: pass `effort: "low" | "medium" | "high" | "xhigh" | "max"` to
 * control thinking depth + overall token spend. Higher = more thorough,
 * more tokens, more latency.
 */
async function callClaude({
  model,
  systemPrompt,
  dynamicContext,
  userMessage,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeout = TIMEOUT_MS,
  thinking = false,
  effort = null,
}) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // System prompt as cacheable blocks. Block 1 is the stable rules/schemas
    // (always cache-hits across turns); Block 2 is the dynamic report context
    // (cache-hits when a user makes a duplicate edit in the same session).
    const system = [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
    ];
    if (dynamicContext) {
      system.push({ type: "text", text: dynamicContext, cache_control: { type: "ephemeral" } });
    }

    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    };
    if (thinking) body.thinking = { type: "adaptive" };
    if (effort) body.output_config = { effort };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error("Claude API error (" + res.status + "): " + err);
    }

    const data = await res.json();
    // Scan content blocks for the first text block. When thinking is enabled,
    // content[0] is a `thinking` block (empty text on Opus 4.7 by default) and
    // the actual response is the next `text` block.
    const textBlock = (data?.content || []).find(b => b?.type === "text");
    const text = textBlock?.text || "";
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

  // Per-request-type tuning. /analyze is the heavy data-reasoning path that
  // benefits from adaptive thinking + high effort + a larger output budget.
  // /chat and /refine stay terse and fast (low effort, no thinking).
  const isAnalyze = options.requestType === "analyze";

  return callClaude({
    model,
    systemPrompt,
    dynamicContext: options.dynamicContext,
    userMessage,
    maxTokens: options.maxTokens || (isAnalyze ? ANALYZE_MAX_TOKENS : DEFAULT_MAX_TOKENS),
    timeout: options.timeout || (isAnalyze ? ANALYZE_TIMEOUT_MS : TIMEOUT_MS),
    thinking: options.thinking ?? isAnalyze,
    effort: options.effort ?? (isAnalyze ? "high" : "low"),
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

/**
 * Returns the STATIC chat system prompt — schemas, rules, output format.
 * No longer interpolates the current report state; that's now passed
 * separately as `dynamicContext` so prompt caching can actually hit on
 * the static block across chat turns. Callers should pass the current
 * report state via `buildChatContextBlock(reportContext)` as the
 * `dynamicContext` option to `callAI`.
 */
export function buildChatSystemPrompt() {
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
- Return ONLY the JSON object, no markdown code blocks or extra text`;
}

/**
 * Builds the dynamic context block (current report state) for the chat path.
 * Returned as a string ready to be passed to callAI as options.dynamicContext.
 * Empty/null reportContext returns an empty string (no extra block sent).
 */
export function buildChatContextBlock(reportContext) {
  if (!reportContext) return "";
  return "Current report data:\n" + JSON.stringify(reportContext, null, 2).slice(0, CHAT_CONTEXT_CHAR_LIMIT);
}

export function buildRefineSystemPrompt(section, instruction) {
  return "Refine this report section per the instruction. Return ONLY updated section JSON.\n\n" +
    "Section:\n" + JSON.stringify(section, null, 2) + "\n\nInstruction: " + instruction;
}

/**
 * Multi-turn "plan" chat used BEFORE the report is generated.
 * Reads the conversation and decides: ask one more clarifying question,
 * or declare ready and produce the full brief that will be passed to /analyze.
 */
export function buildPlanSystemPrompt() {
  return `You are Calo Report Assistant, helping the user PLAN a report before it is built.

Your job, every turn:
1. Read the conversation.
2. Decide whether you have enough to build a great report, OR whether one more specific piece of info would materially improve it.
3. If you need info: ask ONE short, specific clarifying question (period, scope, key metrics, or audience). Never ask more than ONE question at a time.
4. NEVER ask more than 3 clarifying questions across the whole conversation. After the user has answered 3 of your questions, you MUST set ready:true.
5. If the user's first message is already detailed and clear, go straight to ready:true on turn 1 — don't ask unnecessary questions.
6. When ready, write a concise brief (2-4 sentences) that you'll pass to the generator. Include period, scope, key metrics to cover, and any tone/style hints the user gave.

OUTPUT FORMAT (JSON ONLY, no markdown, no code blocks):
{
  "message": "Your conversational reply — either one question OR a 'Got it, building now — here's the brief:' confirmation",
  "ready": false | true,
  "brief": "<only when ready:true — a 2-4 sentence synthesized brief for the report generator>",
  "suggestedTitle": "<only when ready:true — a short report title derived from the brief>"
}

TONE:
- Warm, concise, professional. Like a helpful colleague, not a chatbot.
- Your clarifying questions should feel useful, not bureaucratic. Examples:
  * "What period should this cover — a specific month, quarter, or custom range?"
  * "Which kitchens or regions? All 6, or a subset?"
  * "Any key theme you want me to emphasize (e.g. waste, volume, customer satisfaction)?"

RULES:
- message field NEVER contains JSON or code, always natural language.
- Set ready:true with NO question in message as soon as you have: topic + period + scope.
- If the user says "just build it" or "go ahead" or similar, set ready:true immediately.`;
}
