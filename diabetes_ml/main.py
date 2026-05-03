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
    print(f"SUCCESS: XGBoost model loaded from {MODEL_PATH}")
except FileNotFoundError:
    print(
        f"WARNING: Model not found at {MODEL_PATH}.\n"
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
    Compute trend features looking back up to 3 reports (Current, Prev1, Prev2).
    If fewer than 3 reports exist, pad missing data by duplicating the oldest available report (0 delta).
    """
    current = reports[-1]
    prev1 = reports[-2] if len(reports) >= 2 else current
    prev2 = reports[-3] if len(reports) >= 3 else prev1

    try:
        current_date = datetime.fromisoformat(current.report_date)
        prev1_date = datetime.fromisoformat(prev1.report_date)
        days_gap_1 = max((current_date - prev1_date).days, 1)
    except ValueError:
        days_gap_1 = 90

    try:
        prev2_date = datetime.fromisoformat(prev2.report_date)
        days_gap_2 = max((current_date - prev2_date).days, 1)
    except ValueError:
        days_gap_2 = 180

    hba1c_delta_1 = current.hba1c - prev1.hba1c
    velocity_1 = hba1c_delta_1 / days_gap_1

    hba1c_delta_2 = current.hba1c - prev2.hba1c
    velocity_2 = hba1c_delta_2 / days_gap_2

    # To calculate acceleration, we need prev_velocity (prev1 vs prev2)
    if prev1 == prev2:
        prev_velocity = 0.0
    else:
        prev_hba1c_delta = prev1.hba1c - prev2.hba1c
        try:
            prev_days_gap = max((prev1_date - prev2_date).days, 1)
        except ValueError:
            prev_days_gap = 90
        prev_velocity = prev_hba1c_delta / prev_days_gap

    acceleration = velocity_1 - prev_velocity

    return {
        "hba1c": current.hba1c,
        "fasting_glucose": current.fasting_glucose,
        "hba1c_delta_1": round(hba1c_delta_1, 4),
        "days_since_prev1": days_gap_1,
        "velocity_1": round(velocity_1, 6),
        "hba1c_delta_2": round(hba1c_delta_2, 4),
        "days_since_prev2": days_gap_2,
        "velocity_2": round(velocity_2, 6),
        "acceleration": round(acceleration, 6),
        "projected_hba1c": round(current.hba1c + velocity_1 * 90, 4),
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
    FEATURE_ORDER = [
        "hba1c", "fasting_glucose",
        "hba1c_delta_1", "days_since_prev1", "velocity_1",
        "hba1c_delta_2", "velocity_2",
        "acceleration", "projected_hba1c"
    ]
    X = np.array([[features[f] for f in FEATURE_ORDER]], dtype=np.float32)

    # Predict
    risk_score = int(model.predict(X)[0])
    risk_label = RISK_LABELS.get(risk_score, "Unknown")

    note = (
        f"Based on {len(reports_sorted)} report(s). "
        f"Short-term delta: {features['hba1c_delta_1']:+.2f}%. "
        f"Acceleration: {features['acceleration']:+.4f}."
    )

    return PredictRiskResponse(
        risk_score=risk_score,
        risk_label=risk_label,
        features_used=features,
        note=note,
    )
