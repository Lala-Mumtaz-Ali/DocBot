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
# 1. DOWNLOAD DATASET FROM KAGGLE
# ─────────────────────────────────────────────────────────────
print("📥 Downloading dataset from Kaggle...")

try:
    # dataset_download() returns a local path to the downloaded folder
    dataset_path = kagglehub.dataset_download(
        "programmer3/smart-sensor-based-diabetes-monitoring"
    )
    print(f"✅ Dataset downloaded to: {dataset_path}")
except Exception as e:
    print(f"❌ Kaggle download failed: {e}")
    print("   Make sure ~/.kaggle/kaggle.json contains a valid API key.")
    sys.exit(1)

# Find all CSV files in the downloaded folder
csv_files = glob.glob(os.path.join(dataset_path, "**", "*.csv"), recursive=True)
if not csv_files:
    print(f"❌ No CSV files found in {dataset_path}. Files present:")
    for f in glob.glob(os.path.join(dataset_path, "**", "*"), recursive=True):
        print(f"   {f}")
    sys.exit(1)

print(f"   Found CSV files: {[os.path.basename(f) for f in csv_files]}")

# Load and concatenate all CSVs
dfs = []
for csv_path in csv_files:
    try:
        tmp = pd.read_csv(csv_path)
        print(f"   Loaded: {os.path.basename(csv_path)} → {tmp.shape[0]} rows, {tmp.shape[1]} cols")
        dfs.append(tmp)
    except Exception as e:
        print(f"   ⚠️  Skipping {csv_path}: {e}")

if not dfs:
    print("❌ Could not read any CSV files.")
    sys.exit(1)

df = pd.concat(dfs, ignore_index=True)
print(f"\n✅ Combined dataset: {df.shape[0]} rows, {df.shape[1]} columns")
print(f"   Columns: {list(df.columns)}")

# Save raw data
os.makedirs("data/raw", exist_ok=True)
df.to_csv("data/raw/diabetes_raw.csv", index=False)
print("   Raw data saved to data/raw/diabetes_raw.csv")

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
# 4. CREATE RISK LABELS (Rule-based on HbA1c)
#    0 = Stable (hba1c < 6.5)
#    1 = Moderate (6.5 ≤ hba1c < 8.0)
#    2 = Rapid Deterioration (hba1c ≥ 8.0)
# ─────────────────────────────────────────────────────────────
def assign_risk_label(hba1c_val):
    if hba1c_val < 6.5:
        return 0
    elif hba1c_val < 8.0:
        return 1
    else:
        return 2

df_clean["risk_label"] = df_clean["hba1c"].apply(assign_risk_label)
print(f"\n📊 Risk label distribution:")
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

df_clean["hba1c_delta"]        = df_clean["hba1c"] - df_clean["prev_hba1c"]
df_clean["days_since_last_test"] = (df_clean["report_date"] - df_clean["prev_date"]).dt.days
df_clean["velocity"]           = df_clean["hba1c_delta"] / df_clean["days_since_last_test"].replace(0, np.nan)

# Fill first entry per patient (no prior) with 0
df_clean["hba1c_delta"]         = df_clean["hba1c_delta"].fillna(0.0)
df_clean["days_since_last_test"] = df_clean["days_since_last_test"].fillna(90.0)
df_clean["velocity"]            = df_clean["velocity"].fillna(0.0)

# Save processed features
os.makedirs("data/processed", exist_ok=True)
df_clean.to_csv("data/processed/features.csv", index=False)
print(f"   Processed features saved to data/processed/features.csv")

# ─────────────────────────────────────────────────────────────
# 6. TRAIN XGBoost
# ─────────────────────────────────────────────────────────────
FEATURE_COLS = ["hba1c", "fasting_glucose", "hba1c_delta", "days_since_last_test", "velocity"]
TARGET_COL   = "risk_label"

X = df_clean[FEATURE_COLS]
y = df_clean[TARGET_COL]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

print(f"\n🏋️  Training XGBoost on {len(X_train)} samples...")
model = XGBClassifier(
    n_estimators=200,
    max_depth=5,
    learning_rate=0.1,
    use_label_encoder=False,
    eval_metric="mlogloss",
    random_state=42,
)
model.fit(X_train, y_train)

# ─────────────────────────────────────────────────────────────
# 7. EVALUATE
# ─────────────────────────────────────────────────────────────
y_pred = model.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"\n📈 Test Accuracy: {acc:.4f}")
print("\nClassification Report:")
print(classification_report(y_test, y_pred, target_names=["Stable", "Moderate", "Rapid Deterioration"]))

# ─────────────────────────────────────────────────────────────
# 8. SAVE MODEL
# ─────────────────────────────────────────────────────────────
os.makedirs("models", exist_ok=True)
model_path = "models/xgboost_model.pkl"
joblib.dump(model, model_path)
print(f"\n✅ Model saved to {model_path}")
print("   You can now start the FastAPI server: uvicorn main:app --port 8001 --reload")
