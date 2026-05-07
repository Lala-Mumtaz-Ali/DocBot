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
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# LOAD MODELS (at startup)
# ─────────────────────────────────────────────────────────────
MODEL_PATH    = os.path.join(os.path.dirname(__file__), "models", "xgboost_model.pkl")
FORECAST_PATH = os.path.join(os.path.dirname(__file__), "models", "xgboost_forecast.pkl")

model = None
classifier_features = None
try:
    loaded = joblib.load(MODEL_PATH)
    if isinstance(loaded, dict) and "model" in loaded:
        model               = loaded["model"]
        classifier_features = loaded.get("feature_order")
    else:
        model = loaded
    print(f"SUCCESS: XGBoost classifier loaded from {MODEL_PATH}")
except FileNotFoundError:
    print(
        f"WARNING: Classifier not found at {MODEL_PATH}.\n"
        "    Run 'python train_model.py' first to generate the model file."
    )

forecast_bundle = None
forecast_model = None
forecast_features = None
try:
    forecast_bundle = joblib.load(FORECAST_PATH)
    forecast_model    = forecast_bundle["model"]
    forecast_features = forecast_bundle["feature_order"]
    print(f"SUCCESS: XGBoost forecast regressor loaded from {FORECAST_PATH}")
except FileNotFoundError:
    print(
        f"WARNING: Forecast model not found at {FORECAST_PATH}.\n"
        "    Run 'python train_forecast_model.py' first to enable /predict-forecast."
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

    # Build feature vector in same order as training. Prefer the order saved in
    # the model bundle, falling back to a legacy hard-coded list for older .pkl files.
    feature_order = classifier_features or [
        "hba1c", "fasting_glucose",
        "hba1c_delta_1", "days_since_prev1", "velocity_1",
        "hba1c_delta_2", "days_since_prev2", "velocity_2",
        "acceleration", "projected_hba1c",
    ]
    # Engineered features may not include every feature the model was trained
    # on (e.g. old saved models without `days_since_prev2`). Default missing
    # columns to 0.0 so the predict call doesn't blow up.
    X = np.array(
        [[features.get(f, 0.0) for f in feature_order]],
        dtype=np.float32,
    )

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


# ─────────────────────────────────────────────────────────────
# FORECAST ENDPOINT — predict the patient's HbA1c at a future horizon
# ─────────────────────────────────────────────────────────────
class PredictForecastRequest(BaseModel):
    reports: List[ReportEntry]
    horizon_days: int = 90      # forecast window in days


class PredictForecastResponse(BaseModel):
    predicted_hba1c: float
    current_hba1c: float
    delta_predicted: float       # predicted_hba1c - current_hba1c
    horizon_days: int
    projected_zone: str          # "Normal" | "Pre-diabetic" | "Diabetic"
    features_used: dict


def _classify_zone(hba1c: float) -> str:
    if hba1c >= 6.5:
        return "Diabetic"
    if hba1c >= 5.7:
        return "Pre-diabetic"
    return "Normal"


@app.post("/predict-forecast", response_model=PredictForecastResponse)
def predict_forecast(payload: PredictForecastRequest):
    """
    Predict the patient's HbA1c value `horizon_days` from the most recent report.
    Uses an XGBoost regressor trained on longitudinal FHIR data.
    """
    if not payload.reports:
        raise HTTPException(status_code=422, detail="At least one report is required.")

    if forecast_model is None:
        raise HTTPException(
            status_code=503,
            detail="Forecast model is not loaded. Run 'python train_forecast_model.py' first.",
        )

    horizon = max(1, int(payload.horizon_days))

    try:
        reports_sorted = sorted(payload.reports, key=lambda r: datetime.fromisoformat(r.report_date))
    except ValueError:
        reports_sorted = payload.reports

    features = engineer_features(reports_sorted)
    # Re-project using the requested horizon (engineer_features hardcodes 90)
    features["projected_hba1c"] = round(features["hba1c"] + features["velocity_1"] * horizon, 4)
    features["days_to_next"]    = horizon

    X = np.array([[features[f] for f in forecast_features]], dtype=np.float32)
    predicted = float(forecast_model.predict(X)[0])

    # Clamp to a clinically plausible range
    predicted = max(3.5, min(15.0, predicted))

    return PredictForecastResponse(
        predicted_hba1c=round(predicted, 2),
        current_hba1c=round(features["hba1c"], 2),
        delta_predicted=round(predicted - features["hba1c"], 2),
        horizon_days=horizon,
        projected_zone=_classify_zone(predicted),
        features_used=features,
    )
