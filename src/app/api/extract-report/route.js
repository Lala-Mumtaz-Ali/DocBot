import { NextResponse } from "next/server";
import connectDB from "@/app/lib/db";
import PatientReport from "@/app/lib/models/patientReport";

const PYTHON_BACKEND_URL = "http://localhost:8000";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const GEN_MODEL = process.env.OLLAMA_MODEL || "deepseek-r1:1.5b";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Calls DeepSeek R1 via Ollama with a structured extraction prompt.
 * Returns the raw text response.
 */
async function callDeepSeek(prompt) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEN_MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  let text = data.response || "";

  // Strip <think>...</think> blocks (DeepSeek R1 chain-of-thought)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return text;
}

/**
 * Attempts to parse a JSON object from an LLM response string.
 * Strategy: JSON.parse → regex block extract → safe fallback.
 */
function robustJsonParse(rawText) {
  // 1. Direct parse
  try {
    return JSON.parse(rawText);
  } catch (_) {}

  // 2. Extract first JSON block {}
  const match = rawText.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }

  // 3. Regex field-by-field extraction
  const dateMatch    = rawText.match(/"?report_date"?\s*[:=]\s*"?([0-9]{4}-[0-9]{2}-[0-9]{2})"?/i);
  const hba1cMatch   = rawText.match(/"?hba1c"?\s*[:=]\s*([0-9]+\.?[0-9]*)/i);
  const glucoseMatch = rawText.match(/"?fasting_glucose"?\s*[:=]\s*([0-9]+)/i);

  return {
    report_date:     dateMatch    ? dateMatch[1]           : null,
    hba1c:           hba1cMatch   ? parseFloat(hba1cMatch[1]) : null,
    fasting_glucose: glucoseMatch ? parseInt(glucoseMatch[1])  : null,
  };
}

// ─────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────
export async function POST(req) {
  try {
    // 1. Parse multipart form — get the uploaded PDF
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const filename = file.name || "report.pdf";
    const mimeType = file.type || "";

    if (!mimeType.includes("pdf") && !filename.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are supported." },
        { status: 400 }
      );
    }

    // 2. Transmit PDF buffer to Python backend for text extraction (PyMuPDF)
    let rawText = "";

    try {
      // Convert the Next.js File to a Buffer, then a Blob to ensure fetch serializes it as a proper file
      const arrayBuffer = await file.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      
      const fd = new FormData();
      fd.append("file", blob, filename);

      const extractRes = await fetch(`${PYTHON_BACKEND_URL}/extract_pdf_text`, {
        method: "POST",
        body: fd,
      });

      if (!extractRes.ok) {
        throw new Error(`Python API returned ${extractRes.status}`);
      }

      const extractData = await extractRes.json();
      rawText = extractData.text || "";
    } catch (pdfErr) {
      console.error("PyMuPDF extraction error via Python backend:", pdfErr);
      return NextResponse.json(
        { error: "Failed to read the PDF. Ensure the main Python backend (port 8000) is running." },
        { status: 503 }
      );
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "PDF appears to be empty or image-only. No text could be extracted." },
        { status: 422 }
      );
    }

    // --- STRIP INTERPRETATION SECTION ---
    // Remove the "Interpretation" sections at the bottom of reports to prevent
    // confusing reference scale numbers from tricking the LLM or Regex.
    const interpretationRegex = /\b(?:Interpretation|Interprlation|Intepretation)\b/i;
    const cleanText = rawText.split(interpretationRegex)[0].trim();

    // --- ENHANCED REGEX EXTRACTION FALLBACK ---
    // Extracting HbA1c and Glucose directly from OCR text using robust patterns to handle typos.
    let parsedHbA1c = null;
    const hbRegex = /(?:HbA1c|A1c|Glycated|Glycosylated|HbAIC|HbATc|GL YCOSYLATED)[\s\S]{0,35}?(\d{1,2}\.\d{1,2}|\d{1,2})/i;
    const hbMatchRaw = cleanText.match(hbRegex);
    if(hbMatchRaw && hbMatchRaw[1]) {
        parsedHbA1c = parseFloat(hbMatchRaw[1]);
        if(parsedHbA1c > 20 || parsedHbA1c < 3) parsedHbA1c = null; // sanity bounds check
    }

    let parsedGlucose = null;
    const glRegex = /(?:Glucose|Blood Sugar|Fasting Blood|Average Glucose)[\s\S]{0,30}?(\d{2,3}(?:\.\d{1,2})?)/i;
    const glMatchRaw = cleanText.match(glRegex);
    if(glMatchRaw && glMatchRaw[1]) {
        parsedGlucose = Math.round(parseFloat(glMatchRaw[1]));
    }

    // Truncate text for the LLM to avoid overflowing context window
    const truncatedText = cleanText.slice(0, 3000);

    // 3. Build extraction prompt for DeepSeek R1
    const extractionPrompt = `You are a medical data extraction assistant.
Read the following text from a diabetes lab report and extract EXACTLY these three fields:

1. report_date — the date of the test in YYYY-MM-DD format (string). If not found, use null.
2. hba1c — HbA1c percentage (float). We found a potential value: ${parsedHbA1c !== null ? parsedHbA1c : 'None'}
3. fasting_glucose — fasting/average glucose in mg/dL (integer). We found a potential value: ${parsedGlucose !== null ? parsedGlucose : 'None'}

IMPORTANT RULES:
- Respond ONLY with a single valid JSON object. No explanation. No extra text.
- Format: {"report_date": "YYYY-MM-DD", "hba1c": 7.2, "fasting_glucose": 130}
- If a value is missing from the report, set it to null.

LAB REPORT TEXT:
---
${truncatedText}
---

JSON output:`;

    // 4. Call DeepSeek R1
    let llmResponse = "";
    try {
      llmResponse = await callDeepSeek(extractionPrompt);
    } catch (llmErr) {
      console.error("DeepSeek call failed:", llmErr);
      return NextResponse.json(
        { error: "Failed to contact the AI model. Is Ollama running?" },
        { status: 503 }
      );
    }

    // 5. Parse JSON from LLM output (robust)
    const extracted = robustJsonParse(llmResponse);

    // Validate, sanitize types, and apply robust regex fallback
    const reportData = {
      report_date:     (typeof extracted.report_date === "string" && extracted.report_date !== "null") ? extracted.report_date : null,
      hba1c:           typeof extracted.hba1c       === "number"   ? extracted.hba1c       : (parsedHbA1c !== null ? parsedHbA1c : null),
      fasting_glucose: typeof extracted.fasting_glucose === "number" ? Math.round(extracted.fasting_glucose) : (parsedGlucose !== null ? parsedGlucose : null),
    };

    // 6. Save to MongoDB
    // TODO: Replace "demo_user" with the real userId from JWT when auth is wired up
    //       e.g. const userId = req.headers.get("x-user-id") || "demo_user";
    const userId = "demo_user";

    await connectDB();
    const savedReport = await PatientReport.create({
      userId,
      report_date:     reportData.report_date || new Date().toISOString().split("T")[0],
      hba1c:           reportData.hba1c,
      fasting_glucose: reportData.fasting_glucose,
      raw_text:        rawText.slice(0, 5000), // store first 5000 chars
      source_filename: filename,
    });

    console.log(`✅ Patient report saved: ${savedReport._id} (user: ${userId})`);

    // 7. Return extracted data + DB id
    return NextResponse.json({
      success: true,
      report: {
        _id:             savedReport._id,
        report_date:     reportData.report_date,
        hba1c:           reportData.hba1c,
        fasting_glucose: reportData.fasting_glucose,
        source_filename: filename,
      },
      raw_llm_output: llmResponse, // for debugging; remove in production
    });
  } catch (err) {
    console.error("extract-report error:", err);
    return NextResponse.json(
      { error: "Internal server error.", detail: err.message },
      { status: 500 }
    );
  }
}
