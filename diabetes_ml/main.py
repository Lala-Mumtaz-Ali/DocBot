"""
main.py — Diabetes ML Microservice (FastAPI on port 8001)

Run with:
    uvicorn main:app --port 8001 --reload

Requires models/xgboost_model.pkl — run train_model.py first.
"""

import os
import joblib
import numpy as np
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

# ─────────────────────────────────────────────────────────────
# APP SETUP
# ─────────────────────────────────────────────────────────────
app = FastAPI(title="DocBot Diabetes ML Microservice", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# LOAD MODEL (at startup)
# ─────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "xgboost_model.pkl")

model = None
try:
    model = joblib.load(MODEL_PATH)
    print(f"✅ XGBoost model loaded from {MODEL_PATH}")
except FileNotFoundError:
    print(
        f"⚠️  Model not found at {MODEL_PATH}.\n"
        "    Run 'python train_model.py' first to generate the model file."
    )

# ─────────────────────────────────────────────────────────────
# RISK LABEL MAP
# ─────────────────────────────────────────────────────────────
RISK_LABELS = {
    0: "Stable",
    1: "Moderate Risk",
    2: "Rapid Deterioration",
}

# ─────────────────────────────────────────────────────────────
# REQUEST / RESPONSE SCHEMAS
# ─────────────────────────────────────────────────────────────
class ReportEntry(BaseModel):
    report_date: str        # ISO date string, e.g. "2024-06-15"
    hba1c: float            # e.g. 7.2
    fasting_glucose: int    # e.g. 130 (mg/dL)


class PredictRiskResponse(BaseModel):
    risk_score: int         # 0, 1, or 2
    risk_label: str         # "Stable" / "Moderate Risk" / "Rapid Deterioration"
    features_used: dict     # The engineered features sent to the model
    note: str               # Human-readable note


# ─────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────
def engineer_features(reports: List[ReportEntry]) -> dict:
    """
    Compute trend features from the last two reports in the timeline.
    
    Returns a dict with keys matching the model's training features:
      hba1c, fasting_glucose, hba1c_delta, days_since_last_test, velocity
    """
    if len(reports) < 2:
        # Only one report — no delta possible; use snapshot features only
        current = reports[-1]
        return {
            "hba1c": current.hba1c,
            "fasting_glucose": current.fasting_glucose,
            "hba1c_delta": 0.0,
            "days_since_last_test": 90.0,  # assumed baseline gap
            "velocity": 0.0,
        }

    # Use the most recent two entries
    prev    = reports[-2]
    current = reports[-1]

    try:
        prev_date    = datetime.fromisoformat(prev.report_date)
        current_date = datetime.fromisoformat(current.report_date)
        days_gap     = max((current_date - prev_date).days, 1)  # avoid zero division
    except ValueError:
        days_gap = 90  # fallback

    hba1c_delta = current.hba1c - prev.hba1c
    velocity    = hba1c_delta / days_gap

    return {
        "hba1c": current.hba1c,
        "fasting_glucose": current.fasting_glucose,
        "hba1c_delta": round(hba1c_delta, 4),
        "days_since_last_test": days_gap,
        "velocity": round(velocity, 6),
    }


# ─────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────
@app.get("/")
def health_check():
    return {
        "status": "DocBot Diabetes ML Microservice running",
        "model_loaded": model is not None,
        "model_path": MODEL_PATH,
    }


@app.post("/predict-risk", response_model=PredictRiskResponse)
def predict_risk(reports: List[ReportEntry]):
    """
    Accepts a chronologically sorted list of patient reports.
    Returns a risk_score: 0 (Stable), 1 (Moderate), 2 (Rapid Deterioration).
    """
    if not reports:
        raise HTTPException(status_code=422, detail="At least one report is required.")

    if model is None:
        raise HTTPException(
            status_code=503,
            detail="ML model is not loaded. Run 'python train_model.py' first.",
        )

    # Sort chronologically (defensive — caller should already sort)
    try:
        reports_sorted = sorted(reports, key=lambda r: datetime.fromisoformat(r.report_date))
    except ValueError:
        reports_sorted = reports  # if parsing fails, trust caller's order

    # Engineer features
    features = engineer_features(reports_sorted)

    # Build feature vector in same order as training
    FEATURE_ORDER = ["hba1c", "fasting_glucose", "hba1c_delta", "days_since_last_test", "velocity"]
    X = np.array([[features[f] for f in FEATURE_ORDER]], dtype=np.float32)

    # Predict
    risk_score = int(model.predict(X)[0])
    risk_label = RISK_LABELS.get(risk_score, "Unknown")

    note = (
        f"Based on {len(reports_sorted)} report(s). "
        f"HbA1c delta over {features['days_since_last_test']} days: {features['hba1c_delta']:+.2f}%."
    )

    return PredictRiskResponse(
        risk_score=risk_score,
        risk_label=risk_label,
        features_used=features,
        note=note,
    )
