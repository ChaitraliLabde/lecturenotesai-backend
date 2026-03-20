const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const multer = require("multer");
const fs = require("fs");

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

/* 🔐 GEMINI KEY (USE ENV VARIABLE IN PRODUCTION) */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyAkksLoDfshm-xtjBddpbLNSG6fWEPMmfg";

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

    console.log("🔍 Gemini Raw Response:", JSON.stringify(data));

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.log("❌ Gemini returned empty");
      throw new Error("Empty AI response");
    }

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

    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "No audio file uploaded" });
    }

    console.log("📁 File received:", file.filename);

    /* 🔥 MOCK TRANSCRIPT */
    const transcript =
      "Artificial Intelligence is the simulation of human intelligence by machines.";

    res.json({
      text: transcript
    });

  } catch (err) {
    console.error("❌ Upload Error:", err.message);
    res.status(500).json({ message: "Upload failed" });
  }
});

/* 🤖 STEP 2: GENERATE NOTES */
app.post("/generate-notes", async (req, res) => {
  try {
    console.log("🔥 NOTES API HIT");
    console.log("📦 Body:", req.body);

    const body = req.body || {};

    const transcript = body.transcript;
    const difficulty = body.difficulty || "easy";
    const aiType = body.aiType || "simple";

    if (!transcript) {
      return res.status(400).json({ message: "No transcript received" });
    }

    const notes = await generateNotes(transcript, difficulty, aiType);

    console.log("✅ Notes Generated");

    res.json({
      topic: notes.topic,
      definition: notes.definition,
      key_points: notes.key_points,
      exam_tips: notes.exam_tips,
    });

  } catch (err) {
    console.error("❌ Server Error:", err.message);
    res.status(500).json({ message: "Server failed" });
  }
});

/* 🚀 START SERVER (FIXED FOR DEPLOYMENT) */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});