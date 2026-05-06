import { NextResponse } from "next/server";
import connectDB from "@/app/lib/db";
import PatientReport from "@/app/lib/models/patientReport";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEN_MODEL = process.env.GEN_MODEL || "llama-3.3-70b-versatile";
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8001";

// ─────────────────────────────────────────────────────────────
// CALL GROQ
// ─────────────────────────────────────────────────────────────
async function callGroq(prompt) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set.");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GEN_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content || "";
}

// ─────────────────────────────────────────────────────────────
// BUILD TREND TABLE FOR PROMPT
// ─────────────────────────────────────────────────────────────
function buildTrendTable(reports) {
  const header = "Date        | HbA1c (%) | Fasting Glucose (mg/dL)";
  const divider = "------------|-----------|------------------------";
  const rows = reports.map((r) => {
    const date = String(r.report_date || "Unknown").padEnd(12);
    const hba1c = (r.hba1c != null ? r.hba1c.toFixed(1) : "N/A").padEnd(9);
    const glucose = (r.fasting_glucose != null ? String(r.fasting_glucose) : "N/A").padEnd(24);
    return `${date}| ${hba1c} | ${glucose}`;
  });
  return [header, divider, ...rows].join("\n");
}

// ─────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────
export async function POST(req) {
  try {
    const body = await req.json();

    // TODO: Replace "demo_user" with real userId from JWT auth
    //       e.g. const userId = body.userId || req.headers.get("x-user-id");
    const userId = body.userId || "demo_user";

    // ── 1. Fetch all reports for this user from MongoDB ──
    await connectDB();
    let reports = await PatientReport.find({ userId }).lean();

    // Sort chronologically using JS native Date parsing to handle mixed formatting (MM/DD/YYYY vs YYYY-MM-DD)
    reports.sort((a, b) => new Date(a.report_date) - new Date(b.report_date));

    if (reports.length === 0) {
      return NextResponse.json(
        {
          error:
            "No reports found for this user. Please upload at least one PDF report first.",
        },
        { status: 404 }
      );
    }

    if (reports.length < 2) {
      return NextResponse.json(
        {
          error:
            "At least 2 reports are needed to calculate a meaningful trend. Please upload another report.",
          reports,
        },
        { status: 422 }
      );
    }

    // ── 2. Call ML Microservice for risk score ──
    const mlPayload = reports.map((r) => ({
      report_date: r.report_date,
      hba1c: r.hba1c ?? 0,
      fasting_glucose: r.fasting_glucose ?? 0,
    }));

    let riskScore = 0;
    let riskLabel = "Stable";
    let mlFeatures = {};

    try {
      const mlRes = await fetch(`${ML_SERVICE_URL}/predict-risk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mlPayload),
      });

      if (mlRes.ok) {
        const mlData = await mlRes.json();
        riskScore = mlData.risk_score ?? 0;
        riskLabel = mlData.risk_label ?? "Stable";
        mlFeatures = mlData.features_used ?? {};
      } else {
        console.warn("⚠️  ML service returned non-OK:", mlRes.status);
      }
    } catch (mlErr) {
      console.warn("⚠️  ML service unreachable:", mlErr.message);
      // Degrade gracefully: compute a simple rule-based score
      const latest = reports[reports.length - 1];
      const hba1c = latest.hba1c ?? 0;
      riskScore = hba1c < 6.5 ? 0 : hba1c < 8.0 ? 1 : 2;
      riskLabel = ["Stable", "Moderate Risk", "Rapid Deterioration"][riskScore];
    }
    // ── 3. Build LLM synthesis prompt ──
    const trendTable    = buildTrendTable(reports);
    const riskEmoji     = ["🟢", "🟡", "🔴"][riskScore] ?? "⚪";
    const latestReport  = reports[reports.length - 1];
    const prevReport    = reports[reports.length - 2];

    // Pre-compute values to give to the LLM as facts, not for it to infer
    const latestHba1c   = latestReport.hba1c?.toFixed(1)          ?? "N/A";
    const latestGlucose = latestReport.fasting_glucose             ?? "N/A";
    const prevHba1c     = prevReport.hba1c?.toFixed(1)             ?? "N/A";
    const prevGlucose   = prevReport.fasting_glucose               ?? "N/A";
    const delta1        = mlFeatures.hba1c_delta_1 != null
                          ? `${mlFeatures.hba1c_delta_1 > 0 ? "+" : ""}${mlFeatures.hba1c_delta_1.toFixed(2)}%`
                          : "N/A";
    const accel         = mlFeatures.acceleration != null
                          ? mlFeatures.acceleration.toFixed(4)
                          : "N/A";
    const trendDirection = (mlFeatures.hba1c_delta_1 ?? 0) > 0
                          ? "WORSENING (HbA1c is increasing)"
                          : (mlFeatures.hba1c_delta_1 ?? 0) < 0
                          ? "IMPROVING (HbA1c is decreasing)"
                          : "FLAT (no change detected)";

    const synthesisPrompt = `You are DOCBOT, a friendly medical AI assistant explaining diabetes lab results to a patient in simple, clear language.

=== PATIENT LAB DATA (CHRONOLOGICAL) ===
${trendTable}

=== MACHINE LEARNING ANALYSIS ===
- Previous HbA1c: ${prevHba1c}%  |  Previous Fasting Glucose: ${prevGlucose} mg/dL
- Latest HbA1c:   ${latestHba1c}%  |  Latest Fasting Glucose:   ${latestGlucose} mg/dL
- Short-term HbA1c Change: ${delta1}
- Trend Direction: ${trendDirection}
- Acceleration: ${accel} (positive = worsening is speeding up, negative = worsening is slowing down)
- Overall Risk Score: ${riskScore}/2 → "${riskLabel}" ${riskEmoji}

=== YOUR TASK ===
Write a short, warm, patient-friendly explanation in plain English. Follow this EXACT structure:

**Greeting:** One sentence greeting the patient.

**Your Results:** In 2-3 sentences, plainly describe what the numbers show (e.g. "Your HbA1c went from X% to Y%, which means..."). Use the exact numbers above. Do NOT make up numbers.

**What This Means:** In 1-2 sentences, explain if this is good or bad. CRITICAL: an INCREASE in HbA1c or Glucose is ALWAYS a bad sign — say so clearly. A DECREASE is always good — say so positively.

**Our Prediction:** In 1-2 sentences, state what the ML model predicts will happen next based on the risk score (${riskLabel}).

**Action:** One sentence advising them to consult their doctor.

Keep the total response under 180 words. Write in second person ("you / your"). Do NOT include any <think> tags or reasoning steps.

DOCBOT response:`;

    // ── 4. Call Groq for synthesis ──
    let analysis = "";
    try {
      analysis = await callGroq(synthesisPrompt);
    } catch (llmErr) {
      console.error("Groq synthesis failed:", llmErr);
      analysis = `Your ${reports.length} reports have been analyzed. Your risk level is "${riskLabel}". Please consult your doctor for a detailed explanation of your results.`;
    }

    // ── 5. Return result ──
    return NextResponse.json({
      success: true,
      userId,
      risk_score: riskScore,
      risk_label: riskLabel,
      analysis,
      reports: reports.map((r) => ({
        report_date: r.report_date,
        hba1c: r.hba1c,
        fasting_glucose: r.fasting_glucose,
        source_filename: r.source_filename,
      })),
    });
  } catch (err) {
    console.error("analyze-trend error:", err);
    return NextResponse.json(
      { error: "Internal server error.", detail: err.message },
      { status: 500 }
    );
  }
}
