"""
train_forecast_model.py — XGBoost Regressor for predicting future HbA1c values.

Predicts the patient's NEXT HbA1c reading given their current trajectory and
a target horizon (days_to_next). At inference, set days_to_next to the
forecast window you want — e.g. 90 for "predict HbA1c in 90 days".

Run:
    cd diabetes_ml
    python ingest_fhir.py        # produces data/raw/diabetes_raw_fhir.csv
    python train_forecast_model.py
"""

import os
import sys
import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# ─────────────────────────────────────────────────────────────
# 1. LOAD DATA
# ─────────────────────────────────────────────────────────────
csv_path = "data/raw/diabetes_raw_fhir.csv"
if not os.path.exists(csv_path):
    print(f"ERROR: {csv_path} not found. Run 'python ingest_fhir.py' first.")
    sys.exit(1)

df = pd.read_csv(csv_path)
print(f"Loaded {len(df)} raw observations from FHIR.")

# Keep only rows with HbA1c (the prediction target)
df = df.dropna(subset=["hba1c"]).copy()
df["report_date"] = pd.to_datetime(df["report_date"], errors="coerce")
df = df.dropna(subset=["report_date"])
df = df.sort_values(["patient_id", "report_date"]).reset_index(drop=True)

# Forward-fill fasting glucose within each patient (some readings have only HbA1c)
df["fasting_glucose"] = df.groupby("patient_id")["fasting_glucose"].ffill().bfill()
df["fasting_glucose"] = df["fasting_glucose"].fillna(
    ((df["hba1c"] * 28.7) - 46.7).round()  # ADAG fallback
)

print(f"After cleaning: {len(df)} rows across {df['patient_id'].nunique()} patients.")

# ─────────────────────────────────────────────────────────────
# 2. BUILD TIME-SHIFTED TARGETS
# Target = the patient's NEXT HbA1c reading.
# days_to_next = days between current row and the next row (becomes a feature).
# ─────────────────────────────────────────────────────────────
g = df.groupby("patient_id", group_keys=False)

df["next_hba1c"] = g["hba1c"].shift(-1)
df["next_date"]  = g["report_date"].shift(-1)
df["days_to_next"] = (df["next_date"] - df["report_date"]).dt.days

# Drop the final row per patient (no future reading available)
df_train = df.dropna(subset=["next_hba1c", "days_to_next"]).copy()
df_train = df_train[df_train["days_to_next"] > 0]
print(f"Training pairs (current -> next): {len(df_train)}")

# ─────────────────────────────────────────────────────────────
# 3. ENGINEER TREND FEATURES
# Same shape as the classifier so the inference path can be shared.
# ─────────────────────────────────────────────────────────────
df_train["prev_hba1c"]  = g["hba1c"].shift(1)
df_train["prev_date"]   = g["report_date"].shift(1)
df_train["prev2_hba1c"] = g["hba1c"].shift(2)
df_train["prev2_date"]  = g["report_date"].shift(2)

df_train["hba1c_delta_1"]    = df_train["hba1c"] - df_train["prev_hba1c"]
df_train["days_since_prev1"] = (df_train["report_date"] - df_train["prev_date"]).dt.days

df_train["hba1c_delta_2"]    = df_train["hba1c"] - df_train["prev2_hba1c"]
df_train["days_since_prev2"] = (df_train["report_date"] - df_train["prev2_date"]).dt.days

# Velocities (% change per day)
df_train["velocity_1"] = df_train["hba1c_delta_1"] / df_train["days_since_prev1"].replace(0, np.nan)
df_train["velocity_2"] = df_train["hba1c_delta_2"] / df_train["days_since_prev2"].replace(0, np.nan)

# Acceleration: change in velocity from the previous step
df_train["prev_velocity"] = g["velocity_1"].shift(1) if "velocity_1" in df.columns else np.nan
df_train["acceleration"]  = df_train["velocity_1"] - df_train["prev_velocity"]

# Linear projection (how the classifier sees it) — kept as a feature for the regressor too
df_train["projected_hba1c"] = df_train["hba1c"] + (df_train["velocity_1"] * df_train["days_to_next"])

# Defaults for first-/second-row gaps
df_train["hba1c_delta_1"]    = df_train["hba1c_delta_1"].fillna(0.0)
df_train["days_since_prev1"] = df_train["days_since_prev1"].fillna(90.0)
df_train["velocity_1"]       = df_train["velocity_1"].fillna(0.0)
df_train["hba1c_delta_2"]    = df_train["hba1c_delta_2"].fillna(0.0)
df_train["days_since_prev2"] = df_train["days_since_prev2"].fillna(180.0)
df_train["velocity_2"]       = df_train["velocity_2"].fillna(0.0)
df_train["acceleration"]     = df_train["acceleration"].fillna(0.0)
df_train["projected_hba1c"]  = df_train["projected_hba1c"].fillna(df_train["hba1c"])

# ─────────────────────────────────────────────────────────────
# 4. TRAIN / TEST SPLIT (per-patient, to avoid leakage)
# ─────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "hba1c", "fasting_glucose",
    "hba1c_delta_1", "days_since_prev1", "velocity_1",
    "hba1c_delta_2", "days_since_prev2", "velocity_2",
    "acceleration", "projected_hba1c",
    "days_to_next",
]
TARGET_COL = "next_hba1c"

# Patient-level split so a single patient never appears in both train and test
patients = df_train["patient_id"].unique()
train_pids, test_pids = train_test_split(patients, test_size=0.2, random_state=42)

train_mask = df_train["patient_id"].isin(train_pids)
X_train = df_train.loc[train_mask, FEATURE_COLS].astype(np.float32)
y_train = df_train.loc[train_mask, TARGET_COL].astype(np.float32)
X_test  = df_train.loc[~train_mask, FEATURE_COLS].astype(np.float32)
y_test  = df_train.loc[~train_mask, TARGET_COL].astype(np.float32)

print(f"Train: {len(X_train)} rows ({len(train_pids)} patients)")
print(f"Test:  {len(X_test)} rows ({len(test_pids)} patients)")

# ─────────────────────────────────────────────────────────────
# 5. TRAIN XGBoost REGRESSOR
# ─────────────────────────────────────────────────────────────
model = XGBRegressor(
    n_estimators=400,
    max_depth=5,
    learning_rate=0.05,
    subsample=0.85,
    colsample_bytree=0.85,
    reg_alpha=0.3,
    reg_lambda=1.0,
    objective="reg:squarederror",
    eval_metric="mae",
    random_state=42,
    early_stopping_rounds=25,
)
model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    verbose=False,
)

# ─────────────────────────────────────────────────────────────
# 6. EVALUATE
# ─────────────────────────────────────────────────────────────
y_pred = model.predict(X_test)
mae  = mean_absolute_error(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))
r2   = r2_score(y_test, y_pred)

print("\n=== Forecast Regressor Evaluation ===")
print(f"MAE  : {mae:.4f}  (avg absolute error in HbA1c %)")
print(f"RMSE : {rmse:.4f}")
print(f"R^2  : {r2:.4f}")

# Baseline: "the next reading equals the current reading"
naive_mae = mean_absolute_error(y_test, X_test["hba1c"])
print(f"Naive baseline MAE (predict 'no change'): {naive_mae:.4f}")
print(f"Improvement vs naive: {(naive_mae - mae) * 100 / naive_mae:.1f}%")

# ─────────────────────────────────────────────────────────────
# 7. SAVE
# ─────────────────────────────────────────────────────────────
os.makedirs("models", exist_ok=True)
out_path = "models/xgboost_forecast.pkl"
joblib.dump({"model": model, "feature_order": FEATURE_COLS}, out_path)
print(f"\nSaved forecast model to {out_path}")
