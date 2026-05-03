"""
train_model.py — Download Kaggle dataset, engineer features, train XGBoost, save .pkl

SETUP (one-time):
1. Get your Kaggle API token from https://www.kaggle.com/settings → "Create New Token"
2. Copy kaggle.json to:
   - Linux/Mac: ~/.kaggle/kaggle.json
   - Windows:   C:\\Users\\<YourUsername>\\.kaggle\\kaggle.json
3. pip install -r requirements.txt
4. Run: python train_model.py
"""

import os
import sys
import joblib
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import kagglehub
import glob
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

# ─────────────────────────────────────────────────────────────
# 1. LOAD LOCAL FHIR DATASET
# ─────────────────────────────────────────────────────────────
print("📥 Loading generated FHIR dataset...")

csv_path = "data/raw/diabetes_raw_fhir.csv"
if not os.path.exists(csv_path):
    print(f"❌ Error: {csv_path} not found. Please run ingest_fhir.py first.")
    sys.exit(1)

df = pd.read_csv(csv_path)
print(f"\n✅ Combined dataset: {df.shape[0]} rows, {df.shape[1]} columns")
print(f"   Columns: {list(df.columns)}")

# ─────────────────────────────────────────────────────────────
# 2. COLUMN MAPPING
# Inspect actual column names and map to our schema.
# The dataset uses various column naming conventions.
# ─────────────────────────────────────────────────────────────
print("\n🔍 Inspecting columns...")
print(df.head(3))

# Build flexible column map — check for common variants
col_map = {}
cols_lower = {c.lower().replace(" ", "_").replace("-", "_"): c for c in df.columns}


def find_col(*candidates):
    """Find first matching column (case-insensitive)."""
    for c in candidates:
        key = c.lower().replace(" ", "_").replace("-", "_")
        if key in cols_lower:
            return cols_lower[key]
    return None


hba1c_col       = find_col("hba1c", "hba1c_level", "glycated_hemoglobin", "a1c", "hb_a1c")
glucose_col     = find_col("fasting_glucose", "glucose_level", "blood_glucose_level", "fasting_blood_glucose", "glucose")
patient_id_col  = find_col("patient_id", "id", "patientid")
date_col        = find_col("report_date", "date", "visit_date", "test_date")

print(f"\n📋 Column mapping:")
print(f"   HbA1c         → {hba1c_col}")
print(f"   Glucose       → {glucose_col}")
print(f"   Patient ID    → {patient_id_col}")
print(f"   Date          → {date_col}")

# ─────────────────────────────────────────────────────────────
# 3. CLEAN AND NORMALIZE
# ─────────────────────────────────────────────────────────────
df_clean = df.copy()

# Ensure HbA1c column exists
if hba1c_col:
    df_clean["hba1c"] = pd.to_numeric(df_clean[hba1c_col], errors="coerce")
else:
    print("⚠️  HbA1c column not found — generating synthetic values for training")
    # Many sensor-based datasets encode glucose but not HbA1c explicitly.
    # Approximate: HbA1c ≈ (avg_glucose + 46.7) / 28.7  (ADAG formula)
    if glucose_col:
        df_clean["hba1c"] = (pd.to_numeric(df_clean[glucose_col], errors="coerce") + 46.7) / 28.7
    else:
        raise ValueError("Cannot identify HbA1c or glucose column. Please inspect the dataset manually.")

if glucose_col:
    df_clean["fasting_glucose"] = pd.to_numeric(df_clean[glucose_col], errors="coerce").round().astype("Int64")
else:
    # Reverse-estimate glucose from HbA1c
    df_clean["fasting_glucose"] = ((df_clean["hba1c"] * 28.7) - 46.7).round().astype("Int64")

# Drop rows missing core values
df_clean = df_clean.dropna(subset=["hba1c", "fasting_glucose"])
print(f"\n✅ Clean rows: {len(df_clean)}")

# ─────────────────────────────────────────────────────────────
# 4. CREATE RISK LABELS (Clinical Zone-Based)
#
#   CLINICAL ZONES:
#     Normal:      HbA1c < 5.7%
#     Pre-diabetic: 5.7% <= HbA1c < 6.5%
#     Diabetic:    HbA1c >= 6.5%
#
#   RISK RULES:
#     Stable (0)       : Normal zone AND flat or improving (delta <= 0)
#     Moderate (1)     : Pre-diabetic zone (any direction)
#                        OR Normal zone trending upward (any positive delta)
#                        OR projected to enter pre-diabetic zone in 3 months
#     Rapid Det. (2)   : Diabetic zone (>= 6.5%) — always critical
#                        OR overshooting fast (>= 1.5% rise in a short window)
#                        OR projected to reach diabetic zone in 3 months
# ─────────────────────────────────────────────────────────────
def assign_risk_label(row):
    hba1c    = row["hba1c"]
    delta    = row.get("hba1c_delta_1", 0.0) or 0.0
    velocity = row.get("velocity_1", 0.0) or 0.0

    # Project 3-month HbA1c (90 days)
    projected = hba1c + (velocity * 90)

    # ── Already diabetic: always at least Rapid ──
    if hba1c >= 6.5:
        # Fast worsening on top of diabetic = worst case
        if delta >= 1.5:
            return 2
        return 2   # Any diabetic reading = Rapid Deterioration (critical)

    # ── Pre-diabetic zone: always at least Moderate ──
    elif hba1c >= 5.7:
        # Fast overshoot from pre-diabetic into diabetic = Rapid
        if delta >= 1.5 or projected >= 6.5:
            return 2
        return 1   # Pre-diabetic = Moderate

    # ── Normal zone ──
    else:
        # Trending upward — any positive delta = patient should be warned
        if delta > 0:
            # If the rise projects them into pre-diabetic in 3 months = Moderate
            if projected >= 5.7:
                return 1
            return 1   # Any worsening from normal = warn as Moderate
        # Flat or improving = Stable
        return 0

# Pre-pass: compute delta for labeling (before full feature engineering)
df_clean_sorted = df_clean.sort_values(["patient_id", "report_date"]).copy()
df_clean_sorted["report_date_dt"] = pd.to_datetime(df_clean_sorted["report_date"], errors="coerce")
df_clean_sorted["hba1c_delta_1"] = df_clean_sorted.groupby("patient_id")["hba1c"].diff().fillna(0.0)
df_clean_sorted["days_tmp"]      = df_clean_sorted.groupby("patient_id")["report_date_dt"].diff().dt.days.fillna(90.0)
df_clean_sorted["velocity_1"]    = df_clean_sorted["hba1c_delta_1"] / df_clean_sorted["days_tmp"].replace(0, np.nan)
df_clean_sorted["velocity_1"]    = df_clean_sorted["velocity_1"].fillna(0.0)

df_clean["hba1c_delta_1"] = df_clean_sorted["hba1c_delta_1"].values
df_clean["velocity_1"]    = df_clean_sorted["velocity_1"].values
df_clean["hba1c_delta_1"] = df_clean["hba1c_delta_1"].fillna(0.0)
df_clean["velocity_1"]    = df_clean["velocity_1"].fillna(0.0)

df_clean["risk_label"] = df_clean.apply(assign_risk_label, axis=1)
print(f"\nRisk label distribution:")
print(df_clean["risk_label"].value_counts().sort_index().rename({0:"Stable",1:"Moderate",2:"Rapid Deterioration"}))

# ─────────────────────────────────────────────────────────────
# 5. FEATURE ENGINEERING
# We simulate patient timelines. Since the dataset may not contain
# true sequential data per patient, we create synthetic sequences
# by sorting and grouping, then computing deltas within groups.
# ─────────────────────────────────────────────────────────────
print("\n⚙️  Engineering features...")

if patient_id_col:
    df_clean["patient_id"] = df_clean[patient_id_col]
else:
    # Assign synthetic patient IDs by chunking rows into groups of 5
    df_clean["patient_id"] = (df_clean.index // 5).astype(str)

if date_col:
    df_clean["report_date"] = pd.to_datetime(df_clean[date_col], errors="coerce")
else:
    # Generate synthetic dates: base date + row_within_patient * 90 days
    df_clean = df_clean.sort_values("patient_id").reset_index(drop=True)
    base_date = datetime(2022, 1, 1)
    df_clean["report_date"] = df_clean.groupby("patient_id").cumcount().apply(
        lambda x: base_date + timedelta(days=x * 90)
    )

df_clean = df_clean.sort_values(["patient_id", "report_date"]).reset_index(drop=True)

# Compute within-group deltas
df_clean["prev_hba1c"] = df_clean.groupby("patient_id")["hba1c"].shift(1)
df_clean["prev_date"]  = df_clean.groupby("patient_id")["report_date"].shift(1)

df_clean["prev2_hba1c"] = df_clean.groupby("patient_id")["hba1c"].shift(2)
df_clean["prev2_date"]  = df_clean.groupby("patient_id")["report_date"].shift(2)

df_clean["hba1c_delta_1"]        = df_clean["hba1c"] - df_clean["prev_hba1c"]
df_clean["days_since_prev1"] = (df_clean["report_date"] - df_clean["prev_date"]).dt.days
df_clean["velocity_1"]           = df_clean["hba1c_delta_1"] / df_clean["days_since_prev1"].replace(0, np.nan)

df_clean["hba1c_delta_2"]        = df_clean["hba1c"] - df_clean["prev2_hba1c"]
df_clean["days_since_prev2"] = (df_clean["report_date"] - df_clean["prev2_date"]).dt.days
df_clean["velocity_2"]           = df_clean["hba1c_delta_2"] / df_clean["days_since_prev2"].replace(0, np.nan)

# Fill first/second entries per patient with 0 (meaning no change prior)
df_clean["hba1c_delta_1"]         = df_clean["hba1c_delta_1"].fillna(0.0)
df_clean["days_since_prev1"]      = df_clean["days_since_prev1"].fillna(90.0)
df_clean["velocity_1"]            = df_clean["velocity_1"].fillna(0.0)

df_clean["hba1c_delta_2"]         = df_clean["hba1c_delta_2"].fillna(0.0)
df_clean["days_since_prev2"]      = df_clean["days_since_prev2"].fillna(180.0)
df_clean["velocity_2"]            = df_clean["velocity_2"].fillna(0.0)

# Acceleration: change in velocity
df_clean["prev_velocity"] = df_clean.groupby("patient_id")["velocity_1"].shift(1)
df_clean["acceleration"] = df_clean["velocity_1"] - df_clean["prev_velocity"].fillna(0.0)

# Projected HbA1c in 90 days (key clinical insight feature)
df_clean["projected_hba1c"] = df_clean["hba1c"] + (df_clean["velocity_1"] * 90)

# TARGET: Use current_risk (risk_label for THIS visit, not shifted next visit).
# The model's job is to evaluate the current trajectory NOW.
# risk_label was already assigned by our clinical zone + delta + projection rules.
df_clean["current_risk"] = df_clean["risk_label"].astype(int)

# Save processed features
os.makedirs("data/processed", exist_ok=True)
df_clean.to_csv("data/processed/features.csv", index=False)
print(f"   Processed features saved to data/processed/features.csv")

# ─────────────────────────────────────────────────────────────
# 6. TRAIN XGBoost
# ─────────────────────────────────────────────────────────────
FEATURE_COLS = [
    "hba1c", "fasting_glucose",
    "hba1c_delta_1", "days_since_prev1", "velocity_1",
    "hba1c_delta_2", "velocity_2",
    "acceleration", "projected_hba1c"
]
TARGET_COL   = "current_risk"

X = df_clean[FEATURE_COLS].copy()
y = df_clean[TARGET_COL].copy()

# ── Synthetic oversampling for severely underrepresented classes ──
# The FHIR dataset is nearly all "Stable" patients.
# We oversample Moderate (1) and generate Rapid (2) samples to reach a workable balance.
print(f"\nClass distribution before oversampling:\n{y.value_counts().sort_index()}")

from sklearn.utils import resample

df_combined = pd.concat([X, y.rename("next_risk")], axis=1)

# Oversample class 1 (Moderate) to 500 samples
df_class1 = df_combined[df_combined["next_risk"] == 1]
if len(df_class1) > 0:
    df_class1_up = resample(df_class1, replace=True, n_samples=500, random_state=42)
else:
    df_class1_up = df_class1

# Oversample class 2 (Rapid) — or generate synthetically if empty
df_class2 = df_combined[df_combined["next_risk"] == 2]
if len(df_class2) == 0:
    # Synthesize: Rapid = diabetic zone HbA1c + fast rising velocity
    print("  Generating synthetic Rapid Deterioration samples...")
    r_hba1c   = np.random.uniform(6.5, 12.0, 300)
    r_vel     = np.random.uniform(0.008, 0.05, 300)
    synth = pd.DataFrame({
        "hba1c":            r_hba1c,
        "fasting_glucose":  np.random.uniform(150, 400, 300),
        "hba1c_delta_1":    np.random.uniform(0.5, 4.0, 300),
        "days_since_prev1": np.random.uniform(30, 180, 300),
        "velocity_1":       r_vel,
        "hba1c_delta_2":    np.random.uniform(1.0, 5.0, 300),
        "velocity_2":       np.random.uniform(0.005, 0.04, 300),
        "acceleration":     np.random.uniform(0.001, 0.02, 300),
        "projected_hba1c":  r_hba1c + r_vel * 90,
        "next_risk":        2,
    })
    df_class2_up = synth
else:
    df_class2_up = resample(df_class2, replace=True, n_samples=300, random_state=42)

# Keep Stable (class 0) as is, combine all
df_class0 = df_combined[df_combined["next_risk"] == 0]
df_balanced = pd.concat([df_class0, df_class1_up, df_class2_up]).sample(frac=1, random_state=42).reset_index(drop=True)

X = df_balanced[FEATURE_COLS]
y = df_balanced["next_risk"]

print(f"\nClass distribution after oversampling:\n{y.value_counts().sort_index()}")

# No stratify — classes may still be too small in edge cases
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)

print(f"\nTraining XGBoost on {len(X_train)} samples...")

# Compute class weights to counteract imbalance
from sklearn.utils.class_weight import compute_sample_weight
sample_weights = compute_sample_weight(class_weight="balanced", y=y_train)

model = XGBClassifier(
    n_estimators=300,
    max_depth=4,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_alpha=0.5,
    reg_lambda=1.0,
    eval_metric="mlogloss",
    random_state=42,
    early_stopping_rounds=20,
    objective="multi:softmax",
    num_class=3
)
model.fit(
    X_train, y_train,
    sample_weight=sample_weights,
    eval_set=[(X_test, y_test)],
    verbose=False
)

# ─────────────────────────────────────────────────────────────
# 7. EVALUATE
# ─────────────────────────────────────────────────────────────
y_pred = model.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"\n📈 Test Accuracy: {acc:.4f}")
print("\nClassification Report:")
print(classification_report(y_test, y_pred))

# ─────────────────────────────────────────────────────────────
# 8. SAVE MODEL
# ─────────────────────────────────────────────────────────────
os.makedirs("models", exist_ok=True)
model_path = "models/xgboost_model.pkl"
joblib.dump(model, model_path)
print(f"\n✅ Model saved to {model_path}")
print("   You can now start the FastAPI server: uvicorn main:app --port 8001 --reload")
