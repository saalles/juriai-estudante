const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "nova"; // vozes: alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer

const MODEL = "claude-sonnet-4-6"; // pode trocar por um Haiku 4.5 quando definir o nome exato do modelo em produção

if (!ANTHROPIC_API_KEY) {
  console.warn("AVISO: ANTHROPIC_API_KEY não está definida. Chamadas de texto vão falhar.");
}
if (!DEEPGRAM_API_KEY) {
  console.warn("AVISO: DEEPGRAM_API_KEY não está definida. Transcrição de voz vai falhar.");
}
if (!OPENAI_API_KEY) {
  console.warn("AVISO: OPENAI_API_KEY não está definida. Resposta falada (TTS) vai falhar.");
}

// ---------------- Anthropic (texto) ----------------
async function askClaude(system, messages, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 1000,
      system: system || undefined,
      messages
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Erro na chamada à API da Anthropic.");
  }
  const textBlock = (data.content || []).find(b => b.type === "text");
  return textBlock ? textBlock.text : "";
}

// ---------------- Deepgram (STT) ----------------
async function transcreverAudio(audioBuffer, mimeType) {
  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&language=pt-BR&smart_format=true",
    {
      method: "POST",
      headers: {
        "Authorization": `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": mimeType || "audio/webm"
      },
      body: audioBuffer
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.err_msg || "Erro na transcrição (Deepgram).");
  }
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return transcript;
}

// ---------------- OpenAI (TTS) ----------------
async function falarTexto(texto) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: OPENAI_TTS_VOICE,
      input: texto,
      response_format: "mp3"
    })
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || "Erro na geração de voz (OpenAI TTS).");
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

// ---------------- Rotas ----------------

// Proxy de texto: o frontend nunca vê a chave, só fala com esse endpoint
app.post("/api/claude", async (req, res) => {
  const { system, messages, max_tokens } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Campo 'messages' é obrigatório e não pode ser vazio." });
  }
  try {
    const text = await askClaude(system, messages, max_tokens);
    return res.json({ text });
  } catch (err) {
    console.error("Erro em /api/claude:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Um turno completo do debate por voz: áudio do estudante entra, áudio da IA sai
app.post("/api/voice/turn", async (req, res) => {
  const { audioBase64, mimeType, system, messages, max_tokens } = req.body;

  if (!audioBase64) {
    return res.status(400).json({ error: "Campo 'audioBase64' é obrigatório." });
  }
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "Campo 'messages' é obrigatório." });
  }

  try {
    // 1. Transcreve a fala do estudante
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const transcript = await transcreverAudio(audioBuffer, mimeType);

    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: "Não consegui entender o áudio. Tente falar novamente, mais perto do microfone." });
    }

    // 2. Manda a transcrição para a Claude, junto do histórico do debate
    const fullMessages = [...messages, { role: "user", content: transcript }];
    const respostaTexto = await askClaude(system, fullMessages, max_tokens);

    // 3. Converte a resposta da IA em áudio
    const audioRespostaBase64 = await falarTexto(respostaTexto);

    return res.json({
      transcript_estudante: transcript,
      resposta_texto: respostaTexto,
      audio_base64: audioRespostaBase64
    });
  } catch (err) {
    console.error("Erro em /api/voice/turn:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Qualquer outra rota cai no index.html (SPA simples)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
