import { NextResponse } from "next/server";
import connectDB from "@/app/lib/db";
import PatientReport from "@/app/lib/models/patientReport";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const GEN_MODEL = process.env.OLLAMA_MODEL || "deepseek-r1:1.5b";
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8001";

// ─────────────────────────────────────────────────────────────
// CALL DEEPSEEK VIA OLLAMA
// ─────────────────────────────────────────────────────────────
async function callDeepSeek(prompt) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: GEN_MODEL, prompt, stream: false }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const data = await response.json();
  let text = data.response || "";
  // Strip DeepSeek R1 chain-of-thought tags
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return text;
}

// ─────────────────────────────────────────────────────────────
// BUILD TREND TABLE FOR PROMPT
// ─────────────────────────────────────────────────────────────
function buildTrendTable(reports) {
  const header = "Date        | HbA1c (%) | Fasting Glucose (mg/dL)";
  const divider = "------------|-----------|------------------------";
  const rows = reports.map((r) => {
    const date    = String(r.report_date || "Unknown").padEnd(12);
    const hba1c   = (r.hba1c   != null ? r.hba1c.toFixed(1)   : "N/A").padEnd(9);
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
    const reports = await PatientReport.find({ userId })
      .sort({ report_date: 1 }) // ascending = chronological
      .lean();

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
        riskScore  = mlData.risk_score  ?? 0;
        riskLabel  = mlData.risk_label  ?? "Stable";
        mlFeatures = mlData.features_used ?? {};
      } else {
        console.warn("⚠️  ML service returned non-OK:", mlRes.status);
      }
    } catch (mlErr) {
      console.warn("⚠️  ML service unreachable:", mlErr.message);
      // Degrade gracefully: compute a simple rule-based score
      const latest = reports[reports.length - 1];
      const hba1c  = latest.hba1c ?? 0;
      riskScore    = hba1c < 6.5 ? 0 : hba1c < 8.0 ? 1 : 2;
      riskLabel    = ["Stable", "Moderate Risk", "Rapid Deterioration"][riskScore];
    }

    // ── 3. Build LLM synthesis prompt ──
    const trendTable  = buildTrendTable(reports);
    const riskEmoji   = ["🟢", "🟡", "🔴"][riskScore] ?? "⚪";
    const latestReport = reports[reports.length - 1];
    const prevReport   = reports[reports.length - 2];

    const synthesisPrompt = `You are DOCBOT, a caring and empathetic medical assistant chatbot. Your job is to explain a patient's diabetes trend clearly in plain English.

Patient Data Summary:
${trendTable}

Risk Score: ${riskScore} (${riskLabel}) ${riskEmoji}
${mlFeatures.hba1c_delta != null ? `HbA1c Change: ${mlFeatures.hba1c_delta > 0 ? "+" : ""}${mlFeatures.hba1c_delta} over ${mlFeatures.days_since_last_test} days` : ""}

Instructions:
1. Start with a warm, empathetic greeting as DOCBOT.
2. Briefly summarize the overall trend in HbA1c levels across the reports shown above.
3. Explain what the Risk Score of ${riskScore} (${riskLabel}) means in simple, patient-friendly language. Do NOT use medical jargon.
4. Point out any notable change between the last two readings (${prevReport.report_date} and ${latestReport.report_date}).
5. End with encouragement and a clear reminder to consult their doctor for professional advice. 
6. DO NOT diagnose. DO NOT prescribe. Just explain and encourage.
7. Keep the response under 200 words. Be concise and friendly.

DOCBOT response:`;

    // ── 4. Call DeepSeek R1 for synthesis ──
    let analysis = "";
    try {
      analysis = await callDeepSeek(synthesisPrompt);
    } catch (llmErr) {
      console.error("DeepSeek synthesis failed:", llmErr);
      analysis = `Your ${reports.length} reports have been analyzed. Your risk level is "${riskLabel}". Please consult your doctor for a detailed explanation of your results.`;
    }

    // ── 5. Return result ──
    return NextResponse.json({
      success:    true,
      userId,
      risk_score: riskScore,
      risk_label: riskLabel,
      analysis,
      reports:    reports.map((r) => ({
        report_date:     r.report_date,
        hba1c:           r.hba1c,
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
