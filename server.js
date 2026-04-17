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

/* 🔥 SAFE JSON EXTRACTOR (VERY IMPORTANT) */
function extractJSON(text) {
  try {
    text = text.replace(/```json|```/g, "").trim();

    let start = text.indexOf("{");
    let end = text.lastIndexOf("}");

    if (start !== -1 && end !== -1) {
      let jsonString = text.substring(start, end + 1);
      let parsed = JSON.parse(jsonString);

      /* 🔥 FIX: convert arrays → string (Android safe) */
      if (Array.isArray(parsed.key_points)) {
        parsed.key_points = parsed.key_points.join("\n");
      }
      if (Array.isArray(parsed.exam_tips)) {
        parsed.exam_tips = parsed.exam_tips.join("\n");
      }

      return parsed;
    }

    throw new Error("No valid JSON found");
  } catch (e) {
    throw new Error("Invalid JSON after fixing");
  }
}

/* 🤖 GEMINI FUNCTION */
async function generateNotes(transcript, difficulty, aiType, language) {

  let retries = 3;

  while (retries > 0) {
    try {

      const trimmedTranscript = transcript.slice(0, 5000); // 🔥 safer limit

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
- DO NOT mix languages

4. Output format (STRICT JSON ONLY, KEEP RESPONSE SHORT):
- key_points → max 5 points
- exam_tips → max 4 tips

{
  "topic": "...",
  "definition": "...",
  "key_points": "...",
  "exam_tips": "..."
}

Transcript:
${trimmedTranscript}

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
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
            },
          }),
        }
      );

      const data = await response.json();

      console.log("🔥 FULL GEMINI RESPONSE:", JSON.stringify(data, null, 2));

      /* ❌ HANDLE 503 */
      if (data.error && data.error.code === 503) {
        console.log("⏳ Gemini busy... retrying...");
        retries--;
        await new Promise(res => setTimeout(res, 2500));
        continue;
      }

      if (!data.candidates) {
        throw new Error("No candidates from Gemini");
      }

      /* ✅ EXTRACT TEXT */
      let text = "";
      if (data.candidates.length > 0) {
        const parts = data.candidates[0].content.parts;
        text = parts.map(p => p.text).join("");
      }

      if (!text || text.trim() === "") {
        throw new Error("Empty AI response");
      }

      /* ✅ FINAL PARSE */
      return extractJSON(text);

    } catch (err) {
      console.error("⚠️ Gemini Retry Error:", err.message);
      retries--;
      await new Promise(res => setTimeout(res, 2500));
    }
  }

  /* ✅ FALLBACK */
  return {
    topic: "AI Busy - Try Again",
    definition: "Servers are overloaded or response incomplete.",
    key_points: "1. Retry after few seconds\n2. Try shorter audio\n3. Check internet",
    exam_tips: "Try again later"
  };
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

/* 🤖 GENERATE NOTES */
app.post("/generate-notes", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ message: "Missing Gemini API key" });
    }

    const body = req.body || {};

    const transcript = body.transcript;
    const difficulty = body.difficulty || "easy";
    const aiType = body.aiType || "simple";
    const language = body.language || "English";

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
