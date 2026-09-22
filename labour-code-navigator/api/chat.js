// Vercel Serverless Function — proxies "Ask the Agent" chat turns to the
// Anthropic API using a server-side API key. The key lives only in the
// Vercel project's Environment Variables (ANTHROPIC_API_KEY) and is never
// sent to the browser.
//
// Called by the front-end chat script in index.html as a fallback whenever
// window.claude.use("sample") isn't available (i.e. outside the Claude
// Artifact preview) — see ensureSample()/backendSampleFn() in that file.

var SYSTEM_PROMPT_PREFIX =
  "You are the 'Ask the Agent' assistant embedded in the Labour Code Navigator, " +
  "a training tool built by AI Academy / World HR Connect for HR teams on India's " +
  "four labour codes (Code on Wages 2019, Industrial Relations Code 2020, OSH & " +
  "Working Conditions Code 2020, Code on Social Security 2020). Use the reference " +
  "notes provided below when they are relevant to the question. Keep answers " +
  "concise and practical for HR practitioners. Always make clear this is a training " +
  "aid, not legal advice, and that provisions come into force only on dates the " +
  "Central/State Governments notify — the user should confirm current notification " +
  "status for their state and sector before acting on any figure or threshold.";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed", code: "upstream_error" });
    return;
  }

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(401).json({ error: "Server is not configured with an API key.", code: "sampling_disabled" });
    return;
  }

  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  var turns = (body && Array.isArray(body.turns)) ? body.turns : [];
  if (!turns.length) {
    res.status(400).json({ error: "No message provided.", code: "refused" });
    return;
  }

  // The front end sends the app's reference-notes knowledge base as the
  // first "user" turn (same shape it already uses for window.claude.use).
  // Lift that into the system prompt instead of the conversation itself.
  var system = SYSTEM_PROMPT_PREFIX;
  var conversation = turns;
  if (turns[0] && turns[0].role === "user" && turns[0].content && turns.length > 1) {
    system = SYSTEM_PROMPT_PREFIX + "\n\n" + String(turns[0].content);
    conversation = turns.slice(1);
  }

  var messages = conversation
    .filter(function (t) { return t && t.content; })
    .map(function (t) {
      return { role: t.role === "assistant" ? "assistant" : "user", content: String(t.content) };
    });

  if (!messages.length) {
    res.status(400).json({ error: "No message provided.", code: "refused" });
    return;
  }

  try {
    var upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: system,
        messages: messages
      })
    });

    var data = await upstream.json();

    if (!upstream.ok) {
      var code = upstream.status === 429 ? "rate_limited"
        : upstream.status === 401 ? "sampling_disabled"
        : "upstream_error";
      res.status(upstream.status).json({
        error: (data && data.error && data.error.message) || "Upstream error",
        code: code
      });
      return;
    }

    var text = (data.content || [])
      .filter(function (b) { return b && b.type === "text"; })
      .map(function (b) { return b.text; })
      .join("\n")
      .trim();

    if (!text) {
      res.status(200).json({ text: "", truncated: false, code: "empty_completion" });
      return;
    }

    res.status(200).json({
      text: text,
      truncated: data.stop_reason === "max_tokens"
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to reach the AI service.", code: "upstream_error" });
  }
};
