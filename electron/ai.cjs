// Atelier's own AI layer. Providers: Claude Code and Codex (command-line agents),
// the Anthropic API, any OpenAI-compatible API (OpenAI, OpenRouter, Ollama,
// LM Studio, ...), and a custom command. Messages use the OpenAI shape; a reply
// streams as { type: "text", text } and { type: "tool", id, name, input }.
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULTS = {
  provider: "none",
  anthropicModel: "claude-sonnet-5-5",
  openaiModel: "gpt-4.1",
  openaiBase: "https://api.openai.com/v1",
  claudeModel: "",
  codexModel: "",
  customCommand: "",
  anthropicKey: "",
  openaiKey: "",
  localUrl: "http://127.0.0.1:11434",
  localModel: "",
  localCtx: "16384",
};
// Servers people commonly run local models with; each answers on a fixed port by default.
const LOCAL_SERVERS = [
  { id: "ollama", name: "Ollama", url: "http://127.0.0.1:11434" },
  { id: "lmstudio", name: "LM Studio", url: "http://127.0.0.1:1234" },
  { id: "llamacpp", name: "llama.cpp / other", url: "http://127.0.0.1:8080" },
];
const PROVIDERS = [
  { id: "claude-code", name: "Claude Code", kind: "cli", bin: "claude", install: "Install Claude Code, then run `claude` once to sign in." },
  { id: "codex", name: "Codex", kind: "cli", bin: "codex", install: "Install the Codex CLI, then run `codex` once to sign in." },
  { id: "local", name: "Local model", kind: "local" },
  { id: "anthropic", name: "Anthropic API", kind: "api" },
  { id: "openai", name: "OpenAI-compatible API", kind: "api" },
  { id: "custom", name: "Custom command", kind: "cli" },
];

function createAi({ safeStorage, getStore, setStore, scratchDir, workspaceRoot }) {
  // ----- settings (API keys are encrypted with the OS keychain when available) -----
  const seal = (s) => (!s ? "" : safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(s).toString("base64") : "raw:" + Buffer.from(s).toString("base64"));
  const unseal = (s) => {
    if (!s) return "";
    try {
      if (s.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(s.slice(4), "base64"));
      if (s.startsWith("raw:")) return Buffer.from(s.slice(4), "base64").toString();
    } catch {
      /* unreadable key */
    }
    return "";
  };
  const settings = () => Object.assign({}, DEFAULTS, getStore().ai || {});
  const publicSettings = () => {
    const s = settings();
    return { ...s, anthropicKey: undefined, openaiKey: undefined, hasAnthropicKey: !!s.anthropicKey, hasOpenaiKey: !!s.openaiKey };
  };
  function update(patch) {
    const cur = settings();
    const next = { ...cur };
    for (const k of Object.keys(DEFAULTS)) {
      if (!(k in patch)) continue;
      if (k === "anthropicKey" || k === "openaiKey") {
        if (patch[k] === null) next[k] = "";
        else if (typeof patch[k] === "string" && patch[k]) next[k] = seal(patch[k].trim());
      } else if (typeof patch[k] === "string") next[k] = patch[k].trim();
    }
    if (!["none", ...PROVIDERS.map((p) => p.id)].includes(next.provider)) next.provider = "none";
    if (!/^https?:\/\/[^\s]+$/i.test(next.localUrl)) next.localUrl = DEFAULTS.localUrl;
    setStore({ ai: next });
    return publicSettings();
  }

  // ----- discovering command-line tools -----
  const found = new Map();
  function which(bin) {
    return new Promise((resolve) => {
      execFile(process.platform === "win32" ? "where" : "which", [bin], { timeout: 5000 }, (err, out) => resolve(err ? null : String(out).split(/\r?\n/)[0].trim() || null));
    });
  }
  async function status() {
    const out = [];
    for (const p of PROVIDERS) {
      if (p.kind === "cli" && p.bin) {
        if (!found.has(p.bin) || !found.get(p.bin)) found.set(p.bin, await which(p.bin));
        out.push({ id: p.id, name: p.name, kind: p.kind, available: !!found.get(p.bin), where: found.get(p.bin), install: p.install });
      } else out.push({ id: p.id, name: p.name, kind: p.kind, available: true });
    }
    return out;
  }

  // ----- message helpers -----
  const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : x?.text || "")).join("") : c == null ? "" : String(c));
  const imagesOf = (c) => (Array.isArray(c) ? c.filter((x) => x?.type === "image_url" || x?.type === "image").map((x) => x.image_url?.url || x.url || x.source?.data).filter(Boolean) : []);

  // Expand @path mentions of workspace files into their text (for providers that cannot read files).
  function expandMentions(text) {
    return text.replace(/(^|\s)@([^\s@]+\.[A-Za-z0-9]{1,6})/g, (m, pre, rel) => {
      try {
        const abs = path.resolve(workspaceRoot(), rel);
        if (!abs.startsWith(workspaceRoot() + path.sep)) return m;
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size > 200_000) return m;
        const buf = fs.readFileSync(abs);
        if (buf.includes(0)) return m;
        return `${pre}\n[File ${rel}]\n${buf.toString("utf8")}\n[End of ${rel}]\n`;
      } catch {
        return m;
      }
    });
  }

  function flatten(messages) {
    const system = [];
    const turns = [];
    for (const m of messages) {
      const t = textOf(m.content);
      if (m.role === "system") system.push(t);
      else if (m.role === "assistant") turns.push("Assistant: " + t);
      else if (m.role === "tool") turns.push("Tool result: " + t);
      else turns.push((messages.length > 1 ? "User: " : "") + t);
    }
    return (system.length ? system.join("\n\n") + "\n\n" : "") + turns.join("\n\n");
  }

  // ----- streaming helpers -----
  async function* sse(res, signal) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
          const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
          if (data && data !== "[DONE]") {
            try {
              yield JSON.parse(data);
            } catch {
              /* partial */
            }
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }
  async function apiError(res, name) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message || j?.message || JSON.stringify(j).slice(0, 300);
    } catch {
      /* no body */
    }
    const e = new Error(`${name} error ${res.status}${detail ? ": " + detail : ""}`);
    e.code = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : "api_error";
    return e;
  }

  // ----- Anthropic API -----
  function toAnthropic(messages) {
    const system = [];
    const out = [];
    const push = (role, blocks) => {
      const last = out[out.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else out.push({ role, content: blocks });
    };
    const img = (url) => {
      const m = /^data:([^;]+);base64,(.*)$/.exec(url || "");
      return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null;
    };
    for (const m of messages) {
      if (m.role === "system") system.push(textOf(m.content));
      else if (m.role === "tool") push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content) || "(no output)" }]);
      else if (m.role === "assistant") {
        const blocks = [];
        const t = textOf(m.content);
        if (t) blocks.push({ type: "text", text: t });
        for (const c of m.tool_calls || []) {
          let input = {};
          try {
            input = JSON.parse(c.function?.arguments || "{}");
          } catch {
            /* keep empty */
          }
          blocks.push({ type: "tool_use", id: c.id, name: c.function?.name, input });
        }
        if (blocks.length) push("assistant", blocks);
      } else {
        const blocks = [];
        const t = expandMentions(textOf(m.content));
        for (const u of imagesOf(m.content)) {
          const b = img(u);
          if (b) blocks.push(b);
        }
        blocks.push({ type: "text", text: t || " " });
        push("user", blocks);
      }
    }
    return { system: system.join("\n\n"), messages: out };
  }
  async function* anthropicChat(messages, opts, signal) {
    const s = settings();
    const key = unseal(s.anthropicKey);
    if (!key) throw Object.assign(new Error("Add your Anthropic API key in Atelier → AI settings."), { code: "no_key" });
    const { system, messages: msgs } = toAnthropic(messages);
    const body = {
      model: s.anthropicModel || DEFAULTS.anthropicModel,
      max_tokens: opts.max_tokens || 4096,
      stream: true,
      messages: msgs,
      ...(system ? { system } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.tools?.length ? { tools: opts.tools.map((t) => ({ name: t.function?.name || t.name, description: t.function?.description || t.description || "", input_schema: t.function?.parameters || t.input_schema || { type: "object", properties: {} } })) } : {}),
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(res, "Anthropic");
    const tools = new Map();
    for await (const ev of sse(res, signal)) {
      if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") tools.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: "" });
      else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta" && ev.delta.text) yield { type: "text", text: ev.delta.text };
        else if (ev.delta?.type === "input_json_delta") {
          const t = tools.get(ev.index);
          if (t) t.json += ev.delta.partial_json || "";
        }
      } else if (ev.type === "content_block_stop" && tools.has(ev.index)) {
        const t = tools.get(ev.index);
        let input = {};
        try {
          input = t.json ? JSON.parse(t.json) : {};
        } catch {
          /* leave empty */
        }
        tools.delete(ev.index);
        yield { type: "tool", id: t.id, name: t.name, input };
      } else if (ev.type === "error") throw new Error(ev.error?.message || "Anthropic stream error");
    }
  }

  // ----- OpenAI-compatible API -----
  function toOpenAI(messages) {
    return messages.map((m) => {
      if (m.role === "user" && Array.isArray(m.content)) {
        return { role: "user", content: m.content.map((c) => (typeof c === "string" ? { type: "text", text: expandMentions(c) } : c.type === "text" ? { type: "text", text: expandMentions(c.text || "") } : c)) };
      }
      if (m.role === "user") return { role: "user", content: expandMentions(textOf(m.content)) };
      return m;
    });
  }
  async function* openaiChat(messages, opts, signal, over = {}) {
    const s = settings();
    const key = over.key ?? unseal(s.openaiKey);
    const base = (over.base || s.openaiBase || DEFAULTS.openaiBase).replace(/\/+$/, "");
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base);
    if (!key && !local) throw Object.assign(new Error("Add your API key in Atelier → AI settings."), { code: "no_key" });
    const body = {
      model: over.model || s.openaiModel || DEFAULTS.openaiModel,
      stream: true,
      messages: toOpenAI(messages),
      ...(opts.max_tokens ? { max_tokens: opts.max_tokens } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.tools?.length ? { tools: opts.tools.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema || { type: "object", properties: {} } } })) } : {}),
    };
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(res, "AI provider");
    const calls = new Map();
    for await (const ev of sse(res, signal)) {
      const d = ev.choices?.[0]?.delta;
      if (d?.content) yield { type: "text", text: d.content };
      for (const c of d?.tool_calls || []) {
        const cur = calls.get(c.index ?? 0) || { id: c.id, name: "", args: "" };
        if (c.id) cur.id = c.id;
        if (c.function?.name) cur.name += c.function.name;
        if (c.function?.arguments) cur.args += c.function.arguments;
        calls.set(c.index ?? 0, cur);
      }
    }
    for (const c of calls.values()) {
      let input = {};
      try {
        input = c.args ? JSON.parse(c.args) : {};
      } catch {
        /* leave empty */
      }
      yield { type: "tool", id: c.id, name: c.name, input };
    }
  }

  // ----- command-line agents -----
  const safeModel = (m) => (/^[\w.:/@-]{1,80}$/.test(m || "") ? m : "");
  async function* cliChat(provider, messages, opts, signal) {
    const s = settings();
    let cmd;
    let args;
    const agent = !!opts.agent;
    if (provider === "claude-code") {
      cmd = "claude";
      // stream-json: text as it is written, plus the tools Claude Code uses, shown as steps.
      args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
      if (safeModel(s.claudeModel)) args.push("--model", safeModel(s.claudeModel));
      if (agent) args.push("--permission-mode", "acceptEdits");
    } else if (provider === "codex") {
      cmd = "codex";
      args = ["exec", "--skip-git-repo-check", "--sandbox", agent ? "workspace-write" : "read-only"];
      if (safeModel(s.codexModel)) args.push("--model", safeModel(s.codexModel));
      args.push("-");
    } else {
      const parts = (s.customCommand || "").match(/"[^"]*"|\S+/g) || [];
      if (!parts.length) throw Object.assign(new Error("Set a command in Atelier → AI settings (the prompt is sent on stdin)."), { code: "no_command" });
      cmd = parts[0].replace(/^"|"$/g, "");
      args = parts.slice(1).map((a) => a.replace(/^"|"$/g, ""));
    }
    const cwd = agent ? workspaceRoot() : scratchDir();
    fs.mkdirSync(cwd, { recursive: true });
    const prompt = expandMentions(flatten(messages));
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32", windowsHide: true, env: { ...process.env, NO_COLOR: "1" } });
    const queue = [];
    let wake = null;
    let ended = false;
    let failed = null;
    let err = "";
    const push = (v) => {
      queue.push(v);
      wake?.();
    };
    const streaming = provider === "claude-code";
    let lineBuf = "";
    let sawDelta = false;
    let started = false;
    const base = (p) => String(p || "").split(/[\\/]/).pop();
    const toolLabel = (name, input = {}) => {
      const file = base(input.file_path || input.path || input.notebook_path);
      if (name === "Read") return "Reading " + (file || "a file");
      if (name === "Write") return "Writing " + (file || "a file");
      if (name === "Edit" || name === "NotebookEdit") return "Editing " + (file || "a file");
      if (name === "Glob" || name === "Grep") return "Searching the files";
      if (name === "Bash" || name === "PowerShell") return "Running a command";
      if (name === "WebSearch") return "Searching the web";
      if (name === "WebFetch") return "Reading a web page";
      if (name === "Task") return "Handing a part to a helper";
      return name;
    };
    const onEvent = (j) => {
      if (j.type === "stream_event") {
        const ev = j.event || {};
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") push({ type: "step", id: ev.content_block.id, label: toolLabel(ev.content_block.name), state: "running" });
        else if (ev.type === "content_block_start" && ev.content_block?.type === "text" && sawDelta) push({ type: "text", text: "\n\n" });
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") (sawDelta = true, push({ type: "text", text: ev.delta.text }));
        else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") push({ type: "thinking", text: ev.delta.thinking });
      } else if (j.type === "assistant") {
        for (const b of j.message?.content || []) {
          if (b.type === "tool_use") push({ type: "step", id: b.id, label: toolLabel(b.name, b.input), state: "running" });
          else if (b.type === "text" && !sawDelta && b.text) push({ type: "text", text: (started ? "\n\n" : "") + b.text });
          if (b.type === "text") started = true;
        }
      } else if (j.type === "user") {
        for (const b of j.message?.content || []) if (b.type === "tool_result") push({ type: "step", id: b.tool_use_id, state: b.is_error ? "error" : "done" });
      } else if (j.type === "result" && j.is_error && !failed) {
        failed = Object.assign(new Error(String(j.result || "Claude Code reported an error.").slice(0, 400)), { code: "cli_failed" });
      }
    };
    child.stdout.on("data", (d) => {
      const chunk = d.toString("utf8");
      if (!streaming) return push({ type: "text", text: chunk });
      lineBuf += chunk;
      let nl;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        if (line[0] !== "{") {
          push({ type: "text", text: line + "\n" });
          continue;
        }
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* a partial or unknown line */
        }
      }
    });
    child.stderr.on("data", (d) => (err = (err + d.toString("utf8")).slice(-2000)));
    child.on("error", (e) => {
      failed = Object.assign(new Error(e.code === "ENOENT" ? `${cmd} was not found. Install it or choose another provider.` : e.message), { code: e.code === "ENOENT" ? "not_installed" : "spawn_failed" });
      ended = true;
      wake?.();
    });
    child.on("close", (code) => {
      if (code && !failed) failed = Object.assign(new Error((err.trim().split("\n").slice(-3).join(" ") || `${cmd} exited with code ${code}`).slice(0, 400)), { code: "cli_failed" });
      ended = true;
      wake?.();
    });
    signal?.addEventListener("abort", () => child.kill());
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    for (;;) {
      while (queue.length) yield queue.shift();
      if (ended) break;
      await new Promise((r) => (wake = r));
      wake = null;
    }
    while (queue.length) yield queue.shift();
    if (failed && !signal?.aborted) throw failed;
  }

  // ----- local models: Ollama, LM Studio, llama.cpp and anything OpenAI-compatible -----
  const getJson = async (url, ms = 1500) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  };
  // Which servers are running right now, and what models each one has.
  async function detectLocal() {
    const found = await Promise.all(
      LOCAL_SERVERS.map(async (srv) => {
        try {
          // Ollama answers /api/tags; the others answer /v1/models.
          if (srv.id === "ollama") {
            const j = await getJson(srv.url + "/api/tags");
            return { ...srv, kind: "ollama", models: (j.models || []).map((m) => ({ name: m.name, size: m.size || 0, params: m.details?.parameter_size || "" })) };
          }
          const j = await getJson(srv.url + "/v1/models");
          return { ...srv, kind: "openai", models: (j.data || []).map((m) => ({ name: m.id, size: 0, params: "" })) };
        } catch {
          return null;
        }
      }),
    );
    return found.filter(Boolean);
  }
  // Reasoning models (Qwen3, DeepSeek-R1...) print their thinking in <think> tags: it becomes
  // "thinking" events, kept out of the reply.
  async function* stripThink(source) {
    let inside = false;
    let buf = "";
    for await (const part of source) {
      if (part.type !== "text") {
        yield part;
        continue;
      }
      buf += part.text;
      for (;;) {
        if (inside) {
          const end = buf.indexOf("</think>");
          if (end < 0) {
            if (buf.length > 8) yield { type: "thinking", text: buf.slice(0, -8) };
            buf = buf.slice(-8);
            break;
          }
          if (end > 0) yield { type: "thinking", text: buf.slice(0, end) };
          buf = buf.slice(end + 8).replace(/^\s+/, "");
          inside = false;
        } else {
          const start = buf.indexOf("<think>");
          if (start < 0) {
            // Keep a possible partial tag for the next chunk.
            const keep = Math.max(0, buf.length - 6);
            const safe = /<(t(h(i(n(k)?)?)?)?)?$/.exec(buf.slice(keep))?.index;
            const cut = safe == null ? buf.length : keep + safe;
            if (buf.slice(0, cut)) yield { type: "text", text: buf.slice(0, cut) };
            buf = buf.slice(cut);
            break;
          }
          if (buf.slice(0, start)) yield { type: "text", text: buf.slice(0, start) };
          buf = buf.slice(start + 7);
          inside = true;
        }
      }
    }
    if (!inside && buf) yield { type: "text", text: buf };
  }
  async function* ollamaChat(base, model, messages, opts, signal) {
    const s = settings();
    const body = {
      model,
      stream: true,
      messages: messages.map((m) => {
        const text = expandMentions(textOf(m.content));
        const images = imagesOf(m.content).map((u) => u.replace(/^data:[^;]+;base64,/, ""));
        return { role: m.role === "tool" ? "user" : m.role, content: text, ...(images.length ? { images } : {}) };
      }),
      options: { num_ctx: Math.max(2048, Number(s.localCtx) || 16384), ...(opts.temperature != null ? { temperature: opts.temperature } : {}) },
    };
    const res = await fetch(base + "/api/chat", { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error || "";
      } catch {
        /* no body */
      }
      const e = new Error(res.status === 404 ? `The model "${model}" isn't installed. Pick another one, or download it in AI settings.` : `Ollama error ${res.status}${detail ? ": " + detail : ""}`);
      e.code = res.status === 404 ? "no_model" : "api_error";
      throw e;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let j;
          try {
            j = JSON.parse(line);
          } catch {
            continue;
          }
          if (j.error) throw new Error(j.error);
          if (j.message?.content) yield { type: "text", text: j.message.content };
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }
  async function* localChat(messages, opts, signal) {
    const s = settings();
    const base = (s.localUrl || DEFAULTS.localUrl).replace(/\/+$/, "").replace(/\/v1$/, "");
    const model = (s.localModel || "").trim();
    if (!model) throw Object.assign(new Error("Pick a model in Atelier → AI settings → Local model (Detect shows what is installed)."), { code: "no_model" });
    let kind = null;
    try {
      const tags = await getJson(base + "/api/tags");
      kind = Array.isArray(tags.models) ? "ollama" : "openai";
    } catch (err) {
      // /api/tags missing (not Ollama) but the server is up: it is OpenAI-compatible.
      if (/HTTP \d+/.test(err.message)) kind = "openai";
      else throw Object.assign(new Error(`Couldn't reach a local model server at ${base}. Start Ollama or LM Studio, then try again.`), { code: "no_server" });
    }
    const source = kind === "ollama" ? ollamaChat(base, model, messages, opts, signal) : openaiChat(messages, { ...opts, tools: undefined }, signal, { base: base + "/v1", model, key: "local" });
    yield* stripThink(source);
  }
  // Downloads a model into Ollama, reporting progress.
  async function pullModel(name, onProgress, signal) {
    const base = (settings().localUrl || DEFAULTS.localUrl).replace(/\/+$/, "").replace(/\/v1$/, "");
    if (!/^[\w.:/@-]{1,100}$/.test(name)) throw new Error("That isn't a valid model name.");
    let res;
    try {
      res = await fetch(base + "/api/pull", { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ model: name, stream: true }) });
    } catch {
      throw new Error("Couldn't reach Ollama. Install and start it first (ollama.com).");
    }
    if (!res.ok) throw new Error(`Ollama couldn't download "${name}" (HTTP ${res.status}).`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.error) throw new Error(j.error);
          onProgress({ status: j.status || "", total: j.total || 0, completed: j.completed || 0 });
        } catch (err) {
          if (err.message && !/JSON/.test(err.message)) throw err;
        }
      }
    }
  }

  // Tool calling for providers that have none (Claude Code, Codex, local models, a custom command):
  // the tools are described in the prompt, the model writes <tool_call> blocks, and they are turned back
  // into the same { type: "tool" } events a native API gives. The apps' assistants cannot tell the difference.
  const TOOL_RE = /<tool_call(?:\s+id="([^"]*)")?\s*>([\s\S]*?)<\/tool_call>/g;
  function toolGuide(tools) {
    const brief = (t) => {
      const f = t.function || t;
      const props = f.parameters?.properties || f.input_schema?.properties || {};
      const req = new Set(f.parameters?.required || f.input_schema?.required || []);
      const args = Object.entries(props)
        .map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${v.enum ? v.enum.join("|") : v.type || "any"}`)
        .join(", ");
      return `- ${f.name}(${args}) — ${String(f.description || "").replace(/\s+/g, " ").slice(0, 260)}`;
    };
    return [
      "You can use tools to read and change the document. To use one, write a block exactly like this, then stop writing:",
      '<tool_call>{"name":"tool_name","arguments":{"arg":"value"}}</tool_call>',
      "You may write several blocks in a row. Their results come back in the next message as <tool_result id=...> blocks. When you have what you need, answer in plain words with no block.",
      "Tools:",
      ...tools.map(brief),
    ].join("\n");
  }
  function withToolPrompt(messages, tools) {
    const out = [];
    const guide = toolGuide(tools);
    let hasSystem = false;
    for (const m of messages) {
      if (m.role === "system") {
        out.push({ role: "system", content: textOf(m.content) + (hasSystem ? "" : "\n\n" + guide) });
        hasSystem = true;
      } else if (m.role === "assistant") {
        const calls = (m.tool_calls || []).map((c) => `<tool_call id="${c.id}">{"name":${JSON.stringify(c.function?.name)},"arguments":${c.function?.arguments || "{}"}}</tool_call>`);
        out.push({ role: "assistant", content: [textOf(m.content), ...calls].filter(Boolean).join("\n") || "(no reply)" });
      } else if (m.role === "tool") {
        const block = `<tool_result id="${m.tool_call_id}">\n${textOf(m.content)}\n</tool_result>`;
        const last = out[out.length - 1];
        if (last && last.role === "user" && last._tool) last.content += "\n" + block;
        else out.push({ role: "user", content: block, _tool: true });
      } else out.push(m);
    }
    if (!hasSystem) out.unshift({ role: "system", content: guide });
    return out.map(({ _tool, ...m }) => m);
  }
  async function* emulateTools(provider, messages, opts, signal) {
    const tools = opts.tools;
    const { tools: _t, ...plain } = opts;
    let buf = "";
    let shown = 0;
    const source = provider === "local" ? localChat(withToolPrompt(messages, tools), plain, signal) : cliChat(provider, withToolPrompt(messages, tools), plain, signal);
    for await (const part of source) {
      if (part.type !== "text") {
        yield part;
        continue;
      }
      buf += part.text;
      // Show the words before a tool block, but never the block itself (or a start of one).
      const cut = buf.indexOf("<tool_call");
      const safeEnd = cut >= 0 ? cut : Math.max(shown, buf.length - 10);
      if (safeEnd > shown) {
        yield { type: "text", text: buf.slice(shown, safeEnd) };
        shown = safeEnd;
      }
    }
    const first = buf.indexOf("<tool_call");
    if (first < 0) {
      if (buf.length > shown) yield { type: "text", text: buf.slice(shown) };
      return;
    }
    let n = 0;
    for (const m of buf.matchAll(TOOL_RE)) {
      let call = null;
      try {
        call = JSON.parse(m[2].trim());
      } catch {
        /* unreadable: reported to the model below */
      }
      const id = m[1] || `call_${Date.now().toString(36)}_${n++}`;
      if (call?.name) yield { type: "tool", id, name: String(call.name), input: call.arguments && typeof call.arguments === "object" ? call.arguments : call.input && typeof call.input === "object" ? call.input : {} };
      else yield { type: "tool", id, name: "", input: { __unreadable: m[2] } };
    }
  }

  async function* run(messages, opts = {}, signal) {
    const provider = opts.provider || settings().provider;
    if (!provider || provider === "none") {
      throw Object.assign(new Error("No AI provider is set up. Open Atelier's AI settings (the AI button in the sidebar) and pick Claude Code, Codex or an API key."), { code: "no_provider" });
    }
    if (opts.tools?.length && provider !== "anthropic" && provider !== "openai") return yield* emulateTools(provider, messages, opts, signal);
    if (provider === "local") yield* localChat(messages, opts, signal);
    else if (provider === "anthropic") yield* anthropicChat(messages, opts, signal);
    else if (provider === "openai") yield* openaiChat(messages, opts, signal);
    else yield* cliChat(provider, messages, opts, signal);
  }

  async function test() {
    let text = "";
    for await (const p of run([{ role: "user", content: "Reply with the single word: ready" }], { max_tokens: 20 }, AbortSignal.timeout(60000))) if (p.type === "text") text += p.text;
    return text.trim().slice(0, 200) || "(empty reply)";
  }

  return { run, status, settings: publicSettings, update, test, detectLocal, pullModel };
}

module.exports = { createAi };
