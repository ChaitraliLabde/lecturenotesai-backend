require("dotenv").config(); // ✅ LOAD ENV

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

/* 🤖 GEMINI FUNCTION */
async function generateNotes(transcript, difficulty, aiType) {
  try {
    const prompt = `
Convert this transcript into structured notes.

Transcript:
${transcript}

Difficulty: ${difficulty}
AI Type: ${aiType}

Return JSON:
{
  "topic": "",
  "definition": "",
  "key_points": "",
  "exam_tips": ""
}
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

/* 🎤 STEP 1: UPLOAD AUDIO */
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

    console.log("📁 File path:", file.path);
    console.log("📦 File size:", fs.statSync(file.path).size);

    // ✅ Upload file to AssemblyAI
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

    // ✅ START TRANSCRIPTION (FIXED HERE 🔥)
    const transcriptRes = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: audioUrl,
        speech_model: ["universal-2"], // ⭐ REQUIRED FIX
      },
      {
        headers: {
          authorization: ASSEMBLY_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    const transcriptId = transcriptRes.data.id;

    // 🔄 Polling
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

    console.log("📝 Transcript:", transcript);

    fs.unlinkSync(file.path); // cleanup

    res.json({ text: transcript });

  } catch (err) {
    console.error("❌ STT Error:", err.response?.data || err.message);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ message: "STT failed" });
  }
});

/* 🤖 STEP 2: GENERATE NOTES */
app.post("/generate-notes", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ message: "Missing Gemini API key" });
    }

    const body = req.body || {};

    const transcript = body.transcript;
    const difficulty = body.difficulty || "easy";
    const aiType = body.aiType || "simple";

    if (!transcript) {
      return res.status(400).json({ message: "No transcript received" });
    }

    const notes = await generateNotes(transcript, difficulty, aiType);

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
