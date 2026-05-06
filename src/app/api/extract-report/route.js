import { NextResponse } from "next/server";
import connectDB from "@/app/lib/db";
import PatientReport from "@/app/lib/models/patientReport";

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEN_MODEL = process.env.GEN_MODEL || "llama-3.3-70b-versatile";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function callGroq(prompt, jsonMode = false) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set.");

  const body = {
    model: GEN_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content || "";
}

/**
 * Tries to parse a given string into YYYY-MM-DD
 */
function parseDateString(dateStr) {
  if (!dateStr) return null;
  let d = dateStr.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');

  // 1. Unix Timestamp (e.g. 1735603200)
  if (/^\d{10}$/.test(d)) {
    const dateObj = new Date(parseInt(d) * 1000);
    if (!isNaN(dateObj.getTime())) return dateObj.toISOString().split('T')[0];
  }

  // 2. Try DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY
  let match = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (match) {
    let p1 = parseInt(match[1]); 
    let p2 = parseInt(match[2]);
    let p3 = match[3];
    let year = p3.length === 2 ? `20${p3}` : p3;
    
    if (p2 > 12) {
      // It's MM/DD/YYYY
      let month = p1.toString().padStart(2, '0');
      let day = p2.toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    } else {
      // Assume DD/MM/YYYY
      let day = p1.toString().padStart(2, '0');
      let month = p2.toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 3. YYYY/MM/DD or YYYY-MM-DD
  match = d.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 4. Fallback to JS Date for written formats (Short/Long written, RFC 2822)
  const dateObj = new Date(d);
  if (!isNaN(dateObj.getTime())) {
    return dateObj.toISOString().split('T')[0];
  }

  return null;
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
    const userId = formData.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized. Missing user ID." }, { status: 401 });
    }

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
    // Extracting Date, HbA1c and Glucose directly from OCR text using robust patterns to handle typos.
    let parsedDate = null;
    const dateLabels = [
      "DATE", "DAE", "DAT", "DT", "REPORTED ON", "RECEIVED ON", "COLLECTED ON", "REGISTERED ON", 
      "COLLECTION DATE", "REPORT DATE", "DATE OF REPORT", "DATE OF COLLECTION", "DATE OF REGISTRATION"
    ];
    const labelPattern = dateLabels.map(l => l.replace(/ /g, '\\s+')).join('|');
    const dateRegex = new RegExp(`(?:${labelPattern})\\s*[:\\-]?\\s*([0-9]{1,4}[\\-\\/. \\w,]{4,25}[0-9]{2,4}|\\d{10})`, 'i');
    
    const dateMatchRaw = cleanText.match(dateRegex);
    if (dateMatchRaw && dateMatchRaw[1]) {
        parsedDate = parseDateString(dateMatchRaw[1]);
    }

    let parsedHbA1c = null;
    // Look up to 150 characters ahead to handle multi-line table extractions
    const hbRegex = /(?:HbA1c|A1c|Glycated|Glycosylated|HbAIC|HbATc|GL YCOSYLATED)[\s\S]{0,150}/i;
    const hbMatchRaw = cleanText.match(hbRegex);
    if(hbMatchRaw) {
        // Find all standalone numbers in the matched window
        const numbers = hbMatchRaw[0].match(/\b\d{1,2}(?:\.\d{1,2})?\b/g);
        if (numbers) {
            for (let numStr of numbers) {
                let val = parseFloat(numStr);
                if (val >= 0 && val <= 10) { // user's defined bounds
                    parsedHbA1c = val;
                    break;
                }
            }
        }
    }

    let parsedGlucose = null;
    const glRegex = /(?:Glucose|Blood Sugar|Fasting Blood|Average Glucose)[\s\S]{0,150}/i;
    const glMatchRaw = cleanText.match(glRegex);
    if(glMatchRaw) {
        const numbers = glMatchRaw[0].match(/\b\d{2,3}(?:\.\d{1,2})?\b/g);
        if (numbers) {
            for (let numStr of numbers) {
                let val = Math.round(parseFloat(numStr));
                if (val >= 0 && val <= 400) { // user's defined bounds
                    parsedGlucose = val;
                    break;
                }
            }
        }
    }

    // Truncate text for the LLM to avoid overflowing context window
    const truncatedText = cleanText.slice(0, 3000);

    // 3. Build extraction prompt for DeepSeek R1
    const extractionPrompt = `You are a medical data extraction assistant.
Read the following text from a diabetes lab report and extract EXACTLY these three fields:

1. report_date — the date of the test in YYYY-MM-DD format (string). We found a potential value: ${parsedDate !== null ? parsedDate : 'None'}
2. hba1c — HbA1c percentage (float). We found a potential value: ${parsedHbA1c !== null ? parsedHbA1c : 'None'}
3. fasting_glucose — fasting glucose, average glucose, estimated average glucose, or simply glucose in mg/dL (integer). We found a potential value: ${parsedGlucose !== null ? parsedGlucose : 'None'}

IMPORTANT RULES:
- Respond ONLY with a single valid JSON object. No explanation. No extra text.
- Format: {"report_date": "YYYY-MM-DD", "hba1c": "[float value]", "fasting_glucose": "[integer value]"}
- If a value is missing from the report, set it to null.

LAB REPORT TEXT:
---
${truncatedText}
---

JSON output:`;

    // 4. Call Groq
    let llmResponse = "";
    try {
      llmResponse = await callGroq(extractionPrompt, true);
    } catch (llmErr) {
      console.error("Groq call failed:", llmErr);
      return NextResponse.json(
        { error: "Failed to contact the AI model. Check GROQ_API_KEY." },
        { status: 503 }
      );
    }

    // 5. Parse JSON from LLM output (robust)
    const extracted = robustJsonParse(llmResponse);

    // Validate, sanitize types, and apply robust regex fallback
    // We prioritize the deterministic Regex fallback because small LLMs can hallucinate example values
    let finalHbA1c = parsedHbA1c !== null ? parsedHbA1c : (typeof extracted.hba1c === "number" ? extracted.hba1c : null);
    if (finalHbA1c !== null && (finalHbA1c < 0 || finalHbA1c > 10)) finalHbA1c = null;

    let finalGlucose = parsedGlucose !== null ? parsedGlucose : (typeof extracted.fasting_glucose === "number" ? Math.round(extracted.fasting_glucose) : null);
    if (finalGlucose !== null && (finalGlucose < 0 || finalGlucose > 400)) finalGlucose = null;

    // Mathematical fallback: Calculate missing values using the eAG formula
    // eAG (mg/dL) = (28.7 * HbA1c) - 46.7
    if (finalHbA1c !== null && finalGlucose === null) {
        finalGlucose = Math.round((28.7 * finalHbA1c) - 46.7);
        // Ensure the calculated value is still within realistic bounds
        if (finalGlucose < 0 || finalGlucose > 400) finalGlucose = null;
    } else if (finalGlucose !== null && finalHbA1c === null) {
        finalHbA1c = parseFloat(((finalGlucose + 46.7) / 28.7).toFixed(2));
        if (finalHbA1c < 0 || finalHbA1c > 10) finalHbA1c = null;
    }

    let llmDate = (typeof extracted.report_date === "string" && extracted.report_date !== "null") ? extracted.report_date : null;
    // Ensure the LLM date is correctly formatted as YYYY-MM-DD, otherwise try passing it through our parser
    if (llmDate && !/^\d{4}-\d{2}-\d{2}$/.test(llmDate)) {
        llmDate = parseDateString(llmDate);
    }
    let finalDate = llmDate || parsedDate;

    const reportData = {
      report_date:     finalDate,
      hba1c:           finalHbA1c,
      fasting_glucose: finalGlucose,
    };

    // 6. Save to MongoDB
    // Using the userId provided in the FormData
    // The check for userId exists at the top of the route handler
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
