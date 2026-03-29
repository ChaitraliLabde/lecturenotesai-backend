require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");

const app = express();

/* 🔥 MIDDLEWARE */
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

/* 📁 FILE UPLOAD SETUP */
const upload = multer({ dest: "uploads/" });

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

/* 🔐 KEYS */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ASSEMBLY_API_KEY = process.env.ASSEMBLY_API_KEY || "";

/* 🤖 GEMINI FUNCTION (🔥 UPDATED) */
async function generateNotes(transcript, difficulty, aiType, language) {
  try {
    const prompt = `
Convert the lecture transcript into structured notes.

STRICT RULES:

1. Difficulty:
- easy → very simple language
- medium → moderate explanation
- hard → detailed explanation

2. AI Mode:
- simple → beginner friendly
- smart → deep explanation with examples

3. Language:
- Output MUST be in ${language}
- If Hindi → use simple Hindi
- If Marathi → use natural Marathi (not overly formal)
- If English → use clear English
- DO NOT mix languages

4. Output format (STRICT JSON ONLY):
{
  "topic": "...",
  "definition": "...",
  "key_points": "...",
  "exam_tips": "..."
}

Transcript:
${transcript}

Difficulty: ${difficulty}
AI Mode: ${aiType}
Language: ${language}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error("Empty AI response");

    text = text.replace(/```json|```/g, "").trim();

    const match = text.match(/\{[\s\S]*\}/);

    if (!match) throw new Error("Invalid JSON from AI");

    return JSON.parse(match[0]);

  } catch (err) {
    console.error("❌ Gemini Error:", err.message);

    return {
      topic: "Fallback Topic",
      definition: "Fallback definition",
      key_points: "1. Point\n2. Point",
      exam_tips: "Revise properly",
    };
  }
}

/* ✅ TEST ROUTE */
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

/* 🎤 UPLOAD AUDIO */
app.post("/upload-audio", upload.single("audio"), async (req, res) => {
  try {
    console.log("🔥 AUDIO API HIT");

    if (!ASSEMBLY_API_KEY) {
      return res.status(500).json({ message: "Missing AssemblyAI API key" });
    }

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const uploadRes = await axios.post(
      "https://api.assemblyai.com/v2/upload",
      fs.readFileSync(file.path),
      {
        headers: {
          authorization: ASSEMBLY_API_KEY,
          "content-type": "application/octet-stream",
        },
      }
    );

    const audioUrl = uploadRes.data.upload_url;

    const transcriptRes = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: audioUrl,
        speech_models: ["universal-2"],
      },
      {
        headers: {
          authorization: ASSEMBLY_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    const transcriptId = transcriptRes.data.id;

    let transcript = "";

    while (true) {
      const polling = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: { authorization: ASSEMBLY_API_KEY },
        }
      );

      if (polling.data.status === "completed") {
        transcript = polling.data.text;
        break;
      } else if (polling.data.status === "error") {
        throw new Error("Transcription failed");
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    fs.unlinkSync(file.path);

    res.json({ text: transcript });

  } catch (err) {
    console.error("❌ STT Error:", err.response?.data || err.message);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ message: "STT failed" });
  }
});

/* 🤖 GENERATE NOTES (🔥 UPDATED) */
app.post("/generate-notes", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ message: "Missing Gemini API key" });
    }

    const body = req.body || {};

    const transcript = body.transcript;
    const difficulty = body.difficulty || "easy";
    const aiType = body.aiType || "simple";
    const language = body.language || "English"; // ✅ NEW

    if (!transcript) {
      return res.status(400).json({ message: "No transcript received" });
    }

    console.log("🌍 Language:", language);

    const notes = await generateNotes(transcript, difficulty, aiType, language);

    res.json(notes);

  } catch (err) {
    console.error("❌ Server Error:", err.message);
    res.status(500).json({ message: "Server failed" });
  }
});

/* 🚀 START SERVER */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
