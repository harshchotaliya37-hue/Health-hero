// MedBuddy Backend — server.js
// IAR Udaan Hackathon 2026 | Problem #03

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── File Upload Config ───────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/jpg", "text/plain"];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Unsupported file type"));
  },
});

// ─── XLSX Database ────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, "medbuddy_database.xlsx");

function initDatabase() {
  if (fs.existsSync(DB_PATH)) return;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Patient Records
  const patientHeaders = [
    "Record ID", "Timestamp", "Patient Age", "Language",
    "File Name", "File Type", "Raw Text (Preview)",
    "Diagnosis (Plain)", "One-Line Summary",
    "Follow-up Tests", "Diet Restrictions", "Activity Limits",
    "Side Effect Alert 1", "Side Effect Alert 2", "Side Effect Alert 3",
    "When To Call Doctor"
  ];
  const patientWS = XLSX.utils.aoa_to_sheet([patientHeaders]);
  patientWS["!cols"] = patientHeaders.map(() => ({ wch: 30 }));
  XLSX.utils.book_append_sheet(wb, patientWS, "Patient Records");

  // Sheet 2: Medication Schedules
  const medHeaders = [
    "Record ID", "Medicine Name", "Dosage", "Timing",
    "Frequency", "Duration (Days)", "Instructions", "Side Effects"
  ];
  const medWS = XLSX.utils.aoa_to_sheet([medHeaders]);
  medWS["!cols"] = medHeaders.map(() => ({ wch: 25 }));
  XLSX.utils.book_append_sheet(wb, medWS, "Medication Schedules");

  // Sheet 3: Analytics
  const analyticsHeaders = [
    "Date", "Total Uploads", "PDF Count", "Image Count",
    "Text Count", "Hindi Requests", "English Requests",
    "Avg Processing Time (ms)"
  ];
  const analyticsWS = XLSX.utils.aoa_to_sheet([analyticsHeaders]);
  analyticsWS["!cols"] = analyticsHeaders.map(() => ({ wch: 25 }));
  XLSX.utils.book_append_sheet(wb, analyticsWS, "Analytics");

  XLSX.writeFile(wb, DB_PATH);
  console.log("✅ XLSX Database initialized:", DB_PATH);
}

function saveToDatabase(recordId, inputData, analysisResult) {
  try {
    const wb = XLSX.readFile(DB_PATH);

    // Save to Patient Records sheet
    const patientWS = wb.Sheets["Patient Records"];
    const followUp = analysisResult.followUpChecklist || {};
    const sideEffects = analysisResult.sideEffectAlerts || {};
    const allEffects = sideEffects.items || [];

    const patientRow = [
      recordId,
      new Date().toISOString(),
      inputData.age || "Not provided",
      inputData.language || "English",
      inputData.fileName || "N/A",
      inputData.fileType || "N/A",
      (inputData.rawText || "").substring(0, 200) + "...",
      (analysisResult.plainDiagnosis || {}).explanation || "",
      analysisResult.oneLineSummary || "",
      (followUp.tests || []).join("; "),
      (followUp.diet || []).join("; "),
      (followUp.activity || []).join("; "),
      allEffects[0] || "",
      allEffects[1] || "",
      allEffects[2] || "",
      sideEffects.whenToCallDoctor || "",
    ];

    XLSX.utils.sheet_add_aoa(patientWS, [patientRow], { origin: -1 });

    // Save medications to Medication Schedules sheet
    const medWS = wb.Sheets["Medication Schedules"];
    const medications = analysisResult.medicationSchedule || [];
    medications.forEach((med) => {
      const medRow = [
        recordId,
        med.name || "",
        med.dosage || "",
        med.timing || "",
        med.frequency || "",
        med.duration || "",
        med.instructions || "",
        med.sideEffects || "",
      ];
      XLSX.utils.sheet_add_aoa(medWS, [medRow], { origin: -1 });
    });

    // Update Analytics
    const analyticsWS = wb.Sheets["Analytics"];
    const today = new Date().toISOString().split("T")[0];
    const analyticsData = XLSX.utils.sheet_to_json(analyticsWS, { header: 1 });
    const lastRow = analyticsData[analyticsData.length - 1];

    if (lastRow && lastRow[0] === today) {
      // Update existing row
      const rowIndex = analyticsData.length;
      const cell = `B${rowIndex}`;
      analyticsWS[cell] = { v: (lastRow[1] || 0) + 1 };
    } else {
      const fileType = inputData.fileType || "";
      const lang = (inputData.language || "English").toLowerCase();
      XLSX.utils.sheet_add_aoa(
        analyticsWS,
        [[today, 1,
          fileType === "application/pdf" ? 1 : 0,
          fileType.startsWith("image/") ? 1 : 0,
          fileType === "text/plain" ? 1 : 0,
          lang === "hindi" ? 1 : 0,
          lang === "english" ? 1 : 0,
          0]],
        { origin: -1 }
      );
    }

    XLSX.writeFile(wb, DB_PATH);
    console.log(`✅ Record ${recordId} saved to database`);
  } catch (err) {
    console.error("❌ DB save error:", err.message);
  }
}

// ─── Text Extraction ──────────────────────────────────────────────────────────
async function extractText(filePath, mimeType) {
  if (mimeType === "application/pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  } else if (mimeType === "text/plain") {
    return fs.readFileSync(filePath, "utf8");
  } else if (mimeType.startsWith("image/")) {
    // For images, use Tesseract.js for OCR
    try {
      const Tesseract = require("tesseract.js");
      const { data: { text } } = await Tesseract.recognize(filePath, "eng");
      return text;
    } catch {
      return "[Image OCR failed — please use PDF or text format]";
    }
  }
  return "";
}

// ─── Claude AI Analysis ───────────────────────────────────────────────────────
async function analyzeWithClaude(extractedText, age, language) {
  const langInstruction = language === "hindi"
    ? "Respond in Hindi (Devanagari script) for all patient-facing sections."
    : "Respond in simple English that a patient with no medical background can understand.";

  const ageContext = age ? `The patient is ${age} years old. Adjust language accordingly.` : "";

  const systemPrompt = `You are MedBuddy, a medical document simplifier. Your job is to extract and simplify information from prescriptions and discharge summaries. 
CRITICAL RULES:
1. ONLY use information present in the document. Never add medical advice.
2. Never suggest alternative medicines or add outside information.
3. Medication dosage and timing must match the document EXACTLY — wrong dosage = patient safety failure.
4. Simplify language without distorting meaning.
5. ${langInstruction}
${ageContext}

Respond ONLY with valid JSON in this exact format:
{
  "plainDiagnosis": {
    "condition": "name of condition",
    "explanation": "plain language explanation of what this condition means"
  },
  "medicationSchedule": [
    {
      "name": "Medicine Name",
      "dosage": "e.g. 500mg",
      "timing": "e.g. Morning, Night",
      "frequency": "e.g. Twice daily",
      "duration": "e.g. 5 days",
      "instructions": "e.g. Take after food",
      "sideEffects": "brief side effect note"
    }
  ],
  "sideEffectAlerts": {
    "items": ["Alert 1", "Alert 2", "Alert 3"],
    "whenToCallDoctor": "specific warning signs to call doctor immediately"
  },
  "followUpChecklist": {
    "tests": ["Test 1", "Test 2"],
    "diet": ["Diet restriction 1", "Diet restriction 2"],
    "activity": ["Activity limit 1"]
  },
  "oneLineSummary": "One sentence a family member can understand instantly"
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Here is the medical document text. Please analyze and return structured JSON:\n\n${extractedText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const data = await response.json();
  const rawText = data.content[0].text;

  // Clean and parse JSON
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No valid JSON in Claude response");

  return JSON.parse(jsonMatch[0]);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "MedBuddy API", version: "1.0.0" });
});

// Main analysis endpoint
app.post("/api/analyze", upload.single("document"), async (req, res) => {
  const startTime = Date.now();
  const recordId = uuidv4();

  if (!req.file && !req.body.textInput) {
    return res.status(400).json({ error: "No document or text provided" });
  }

  try {
    let extractedText = "";
    let fileName = "text-input";
    let fileType = "text/plain";

    if (req.file) {
      fileName = req.file.originalname;
      fileType = req.file.mimetype;
      extractedText = await extractText(req.file.path, fileType);
      // Clean up uploaded file after extraction
      setTimeout(() => {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }, 5000);
    } else {
      extractedText = req.body.textInput;
    }

    if (!extractedText || extractedText.trim().length < 20) {
      return res.status(400).json({ error: "Could not extract sufficient text from document" });
    }

    const age = req.body.age || null;
    const language = req.body.language || "english";

    const analysisResult = await analyzeWithClaude(extractedText, age, language);
    const processingTime = Date.now() - startTime;

    // Save to XLSX database
    saveToDatabase(recordId, { age, language, fileName, fileType, rawText: extractedText }, analysisResult);

    res.json({
      success: true,
      recordId,
      processingTime,
      originalTextPreview: extractedText.substring(0, 500),
      analysis: analysisResult,
    });

  } catch (err) {
    console.error("❌ Analysis error:", err.message);
    res.status(500).json({ error: err.message || "Analysis failed" });
  }
});

// Download XLSX database
app.get("/api/database/download", (req, res) => {
  if (!fs.existsSync(DB_PATH)) {
    return res.status(404).json({ error: "Database not found" });
  }
  res.download(DB_PATH, "medbuddy_database.xlsx");
});

// Get database stats
app.get("/api/database/stats", (req, res) => {
  try {
    const wb = XLSX.readFile(DB_PATH);
    const patientWS = wb.Sheets["Patient Records"];
    const medWS = wb.Sheets["Medication Schedules"];
    const patientData = XLSX.utils.sheet_to_json(patientWS);
    const medData = XLSX.utils.sheet_to_json(medWS);
    res.json({
      totalRecords: patientData.length,
      totalMedications: medData.length,
      dbPath: DB_PATH,
    });
  } catch {
    res.json({ totalRecords: 0, totalMedications: 0 });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
initDatabase();
app.listen(PORT, () => {
  console.log(`\n🏥 MedBuddy Server running on http://localhost:${PORT}`);
  console.log(`📊 XLSX Database: ${DB_PATH}`);
  console.log(`🔑 API Key: ${process.env.ANTHROPIC_API_KEY ? "✅ Set" : "❌ Missing"}\n`);
});

module.exports = app;
