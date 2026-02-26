const TIMEOUT_MS = 90000;

export function getAvailableProviders() {
  const providers = [];
  if (process.env.GEMINI_API_KEY) providers.push({ id: "gemini", name: "Google Gemini 2.0 Flash", available: true });
  if (process.env.CLAUDE_API_KEY) providers.push({ id: "claude", name: "Anthropic Claude", available: true });
  if (process.env.PERPLEXITY_API_KEY) providers.push({ id: "perplexity", name: "Perplexity AI", available: true });
  return providers;
}

export function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text); } catch(e) {}
  const m = text.match(/\`\`\`(?:json)?\s*\n?([\s\S]*?)\n?\s*\`\`\`/);
  if (m) { try { return JSON.parse(m[1].trim()); } catch(e) {} }
  const j = text.match(/\{[\s\S]*\}/);
  if (j) { try { return JSON.parse(j[0]); } catch(e) {} }
  return null;
}

async function callGemini(systemPrompt, userMessage, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS);
  try {
    const genConfig = { temperature: options.temperature || 0.3, maxOutputTokens: options.maxTokens || 8192 };
    if (options.jsonMode) genConfig.responseMimeType = "application/json";
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: genConfig
        }),
        signal: controller.signal
      }
    );
    if (!res.ok) { const err = await res.text(); throw new Error("Gemini API error (" + res.status + "): " + err); }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { text, raw: data, tokensIn: data?.usageMetadata?.promptTokenCount, tokensOut: data?.usageMetadata?.candidatesTokenCount };
  } finally { clearTimeout(timer); }
}

async function callClaude(systemPrompt, userMessage, options = {}) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("Claude API key not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: options.model || "claude-sonnet-4-5-20250514",
        max_tokens: options.maxTokens || 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      }),
      signal: controller.signal
    });
    if (!res.ok) { const err = await res.text(); throw new Error("Claude API error (" + res.status + "): " + err); }
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    return { text, raw: data, tokensIn: data?.usage?.input_tokens, tokensOut: data?.usage?.output_tokens };
  } finally { clearTimeout(timer); }
}

async function callPerplexity(systemPrompt, userMessage, options = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("Perplexity API key not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS);
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: options.model || "sonar-pro",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
        max_tokens: options.maxTokens || 8192, temperature: options.temperature || 0.3
      }),
      signal: controller.signal
    });
    if (!res.ok) { const err = await res.text(); throw new Error("Perplexity API error (" + res.status + "): " + err); }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return { text, raw: data, tokensIn: data?.usage?.prompt_tokens, tokensOut: data?.usage?.completion_tokens };
  } finally { clearTimeout(timer); }
}

export async function callAI(provider, systemPrompt, userMessage, options = {}) {
  const p = provider || process.env.DEFAULT_AI_PROVIDER || "gemini";
  switch (p) {
    case "gemini": return callGemini(systemPrompt, userMessage, options);
    case "claude": return callClaude(systemPrompt, userMessage, options);
    case "perplexity": return callPerplexity(systemPrompt, userMessage, options);
    default: throw new Error("Unknown AI provider: " + p);
  }
}

export function buildReportSystemPrompt(dataSummary) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return "You are CALO Report AI, an expert data analyst. Analyze the data and produce a professional report.\n\n" +
    "Return ONLY valid JSON (no markdown, no code blocks):\n" +
    "{ \"title\": \"Report Title\", \"subtitle\": \"Subtitle\", \"reportDate\": \"" + today + "\", \"brandColor\": \"#22c55e\",\n" +
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
    "8. chart: {\"type\":\"chart\",\"chartType\":\"bar|line|pie|doughnut\",\"title\":\"T\",\"labels\":[\"A\"],\"datasets\":[{\"label\":\"S\",\"data\":[10]}]}\n\n" +
    "GUIDELINES:\n- Identify 4-6 KPIs\n- Create 4-8 sections\n- Use charts for numerical data\n- Use comparisons for paired data\n" +
    "- Write insightful analysis\n- Generate 3-5 actionable insights\n- ALL values as strings\n\n" +
    "DATA:\n" + JSON.stringify(dataSummary, null, 2);
}

export function buildChatSystemPrompt(reportContext) {
  return "You are CALO Report AI Assistant. Help users refine reports. Be concise.\n" +
    (reportContext ? "\nCurrent report:\n" + JSON.stringify(reportContext, null, 2).slice(0, 5000) : "");
}

export function buildRefineSystemPrompt(section, instruction) {
  return "Refine this report section per the instruction. Return ONLY updated section JSON.\n\n" +
    "Section:\n" + JSON.stringify(section, null, 2) + "\n\nInstruction: " + instruction;
}
