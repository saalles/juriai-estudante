const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6"; // pode trocar por um Haiku 4.5 quando definir o nome exato do modelo em produção

if (!ANTHROPIC_API_KEY) {
  console.warn("AVISO: variável de ambiente ANTHROPIC_API_KEY não está definida. As chamadas à IA vão falhar.");
}

// Proxy único: o frontend nunca vê a chave, só fala com esse endpoint
app.post("/api/claude", async (req, res) => {
  const { system, messages, max_tokens } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Campo 'messages' é obrigatório e não pode ser vazio." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: max_tokens || 1000,
        system: system || undefined,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro da API Anthropic:", data);
      return res.status(response.status).json({ error: data.error?.message || "Erro na chamada à API da Anthropic." });
    }

    const textBlock = (data.content || []).find(b => b.type === "text");
    return res.json({ text: textBlock ? textBlock.text : "" });
  } catch (err) {
    console.error("Erro no proxy:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Qualquer outra rota cai no index.html (SPA simples)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
