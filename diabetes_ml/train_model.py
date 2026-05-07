"""
train_model.py - XGBoost classifier for diabetes risk (Stable / Moderate / Rapid).

Trained on real FHIR longitudinal data only - no synthetic noise samples.
Uses a patient-level train/test split to prevent leakage and balanced sample
weights to handle class imbalance.

Run:
    cd diabetes_ml
    python ingest_fhir.py        # produces data/raw/diabetes_raw_fhir.csv
    python train_model.py
"""

import os
import sys
import joblib
import numpy as np
import pandas as pd
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.utils.class_weight import compute_sample_weight
from sklearn.dummy import DummyClassifier

RANDOM_STATE = 42
RAW_CSV      = "data/raw/diabetes_raw_fhir.csv"
PROC_CSV     = "data/processed/features.csv"
MODEL_PATH   = "models/xgboost_model.pkl"

FEATURE_COLS = [
    "hba1c", "fasting_glucose",
    "hba1c_delta_1", "days_since_prev1", "velocity_1",
    "hba1c_delta_2", "days_since_prev2", "velocity_2",
    "acceleration", "projected_hba1c",
]
TARGET_COL = "risk_label"

CLASS_NAMES = {0: "Stable", 1: "Moderate", 2: "Rapid Deterioration"}


# ─────────────────────────────────────────────────────────────
# 1. LOAD AND CLEAN FHIR DATA
# ─────────────────────────────────────────────────────────────
def load_data() -> pd.DataFrame:
    if not os.path.exists(RAW_CSV):
        print(f"ERROR: {RAW_CSV} not found. Run 'python ingest_fhir.py' first.")
        sys.exit(1)

    df = pd.read_csv(RAW_CSV)
    print(f"Loaded {len(df)} raw observations from FHIR.")

    df = df.dropna(subset=["hba1c"]).copy()
    df["report_date"] = pd.to_datetime(df["report_date"], errors="coerce")
    df = df.dropna(subset=["report_date"])
    df = df.sort_values(["patient_id", "report_date"]).reset_index(drop=True)

    # Forward/backfill glucose within each patient; fall back to ADAG formula.
    df["fasting_glucose"] = df.groupby("patient_id")["fasting_glucose"].ffill().bfill()
    df["fasting_glucose"] = df["fasting_glucose"].fillna(
        ((df["hba1c"] * 28.7) - 46.7).round()
    )

    print(f"After cleaning: {len(df)} rows across {df['patient_id'].nunique()} patients.")
    return df


# ─────────────────────────────────────────────────────────────
# 2. FEATURE ENGINEERING (matches main.py engineer_features at inference)
# ─────────────────────────────────────────────────────────────
def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby("patient_id", group_keys=False)

    df["prev_hba1c"]  = g["hba1c"].shift(1)
    df["prev_date"]   = g["report_date"].shift(1)
    df["prev2_hba1c"] = g["hba1c"].shift(2)
    df["prev2_date"]  = g["report_date"].shift(2)

    df["hba1c_delta_1"]    = (df["hba1c"] - df["prev_hba1c"]).fillna(0.0)
    df["days_since_prev1"] = (df["report_date"] - df["prev_date"]).dt.days
    df["days_since_prev1"] = df["days_since_prev1"].fillna(90.0).clip(lower=1)

    df["hba1c_delta_2"]    = (df["hba1c"] - df["prev2_hba1c"]).fillna(0.0)
    df["days_since_prev2"] = (df["report_date"] - df["prev2_date"]).dt.days
    df["days_since_prev2"] = df["days_since_prev2"].fillna(180.0).clip(lower=1)

    df["velocity_1"] = df["hba1c_delta_1"] / df["days_since_prev1"]
    df["velocity_2"] = df["hba1c_delta_2"] / df["days_since_prev2"]
    df["velocity_1"] = df["velocity_1"].fillna(0.0)
    df["velocity_2"] = df["velocity_2"].fillna(0.0)

    df["prev_velocity"] = g["velocity_1"].shift(1).fillna(0.0)
    df["acceleration"]  = df["velocity_1"] - df["prev_velocity"]

    df["projected_hba1c"] = df["hba1c"] + df["velocity_1"] * 90
    return df


# ─────────────────────────────────────────────────────────────
# 3. CLINICAL RISK LABELS
# Captures TRAJECTORY, not just current zone:
#
#   Stable (0):     Trajectory flat or improving in any zone
#   Moderate (1):   Mild worsening, OR pre-diabetic zone with no fast change,
#                   OR diabetic zone with stable/slow change (managed diabetic)
#   Rapid (2):      Fast worsening (large delta), OR projected to cross a
#                   clinical threshold within 90 days, OR newly diabetic
# ─────────────────────────────────────────────────────────────
def assign_risk_label(row) -> int:
    h         = row["hba1c"]
    delta     = row["hba1c_delta_1"]
    projected = row["projected_hba1c"]

    # Fast worsening from any zone
    if delta >= 1.0:
        return 2
    # Crossing a clinical zone in the next 90 days from below
    if h < 6.5 and projected >= 6.5 and delta > 0:
        return 2
    if h < 5.7 and projected >= 5.7 and delta > 0.3:
        return 2

    # Diabetic zone
    if h >= 6.5:
        if delta > 0.3:
            return 2          # newly worsening diabetic
        return 1              # stable / managed diabetic

    # Pre-diabetic zone
    if h >= 5.7:
        if delta > 0.3:
            return 2          # fast climb within pre-diabetic
        return 1

    # Normal zone
    if delta > 0.3:
        return 1              # rising within normal -> warn
    return 0                  # stable normal


# ─────────────────────────────────────────────────────────────
# 4. PATIENT-LEVEL SPLIT (no patient appears in both train and test)
# ─────────────────────────────────────────────────────────────
def patient_level_split(df: pd.DataFrame, test_size=0.2):
    patients = df["patient_id"].unique()
    train_pids, test_pids = train_test_split(
        patients, test_size=test_size, random_state=RANDOM_STATE
    )
    train_mask = df["patient_id"].isin(train_pids)
    return df[train_mask].copy(), df[~train_mask].copy(), train_pids, test_pids


# ─────────────────────────────────────────────────────────────
# 5. TRAIN
# ─────────────────────────────────────────────────────────────
def train_model(X_train, y_train, X_val, y_val) -> XGBClassifier:
    sample_weights = compute_sample_weight(class_weight="balanced", y=y_train)
    model = XGBClassifier(
        n_estimators=600,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.3,
        reg_lambda=1.0,
        objective="multi:softprob",
        num_class=3,
        eval_metric="mlogloss",
        random_state=RANDOM_STATE,
        early_stopping_rounds=30,
    )
    model.fit(
        X_train, y_train,
        sample_weight=sample_weights,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )
    return model


def cross_validate(X, y, n_splits=5):
    """Stratified k-fold CV with macro-F1 to gauge generalization honestly."""
    skf = XGBClassifier(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.3,
        reg_lambda=1.0,
        objective="multi:softprob",
        num_class=3,
        eval_metric="mlogloss",
        random_state=RANDOM_STATE,
    )
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_STATE)
    scores = cross_val_score(skf, X, y, cv=cv, scoring="f1_macro", n_jobs=-1)
    return scores


# ─────────────────────────────────────────────────────────────
# 6. EVALUATE
# ─────────────────────────────────────────────────────────────
def evaluate(model, X_test, y_test):
    y_pred = model.predict(X_test)

    acc      = accuracy_score(y_test, y_pred)
    f1_macro = f1_score(y_test, y_pred, average="macro")
    f1_weight = f1_score(y_test, y_pred, average="weighted")

    print("\n=== Test Performance (held-out patients) ===")
    print(f"Accuracy        : {acc:.4f}")
    print(f"Macro F1        : {f1_macro:.4f}")
    print(f"Weighted F1     : {f1_weight:.4f}")

    print("\nPer-class report:")
    print(classification_report(
        y_test, y_pred,
        labels=[0, 1, 2],
        target_names=[CLASS_NAMES[i] for i in [0, 1, 2]],
        zero_division=0,
    ))

    print("Confusion matrix (rows=true, cols=pred):")
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2])
    cm_df = pd.DataFrame(
        cm,
        index=[f"true_{CLASS_NAMES[i]}" for i in [0, 1, 2]],
        columns=[f"pred_{CLASS_NAMES[i]}" for i in [0, 1, 2]],
    )
    print(cm_df)

    # Baseline: predict the majority class always
    dummy = DummyClassifier(strategy="most_frequent", random_state=RANDOM_STATE)
    dummy.fit(np.zeros((len(y_test), 1)), y_test)
    base = dummy.predict(np.zeros((len(y_test), 1)))
    base_acc = accuracy_score(y_test, base)
    base_f1  = f1_score(y_test, base, average="macro")
    print(f"\nBaseline (majority class)  -> accuracy: {base_acc:.4f} | macro-F1: {base_f1:.4f}")
    print(f"Improvement over baseline  -> accuracy: +{(acc-base_acc)*100:.2f}pp | macro-F1: +{(f1_macro-base_f1)*100:.2f}pp")

    return acc, f1_macro


def show_feature_importance(model):
    importance = model.feature_importances_
    pairs = sorted(zip(FEATURE_COLS, importance), key=lambda p: p[1], reverse=True)
    print("\nFeature importance (gain-based):")
    for name, val in pairs:
        bar = "#" * int(round(val * 40))
        print(f"  {name:<20s} {val:.4f}  {bar}")


# ─────────────────────────────────────────────────────────────
# 7. MAIN
# ─────────────────────────────────────────────────────────────
def main():
    df = load_data()
    df = engineer_features(df)
    df["risk_label"] = df.apply(assign_risk_label, axis=1).astype(int)

    print("\nNatural class distribution (no synthetic samples):")
    print(df["risk_label"].value_counts().sort_index().rename(CLASS_NAMES).to_string())

    os.makedirs("data/processed", exist_ok=True)
    df.to_csv(PROC_CSV, index=False)
    print(f"Saved engineered features to {PROC_CSV}")

    df_train, df_test, train_pids, test_pids = patient_level_split(df, test_size=0.2)
    print(f"\nPatient-level split:")
    print(f"  Train: {len(df_train):>5} rows / {len(train_pids):>4} patients")
    print(f"  Test : {len(df_test):>5} rows / {len(test_pids):>4} patients")

    X_train_full = df_train[FEATURE_COLS].astype(np.float32)
    y_train_full = df_train[TARGET_COL].astype(int)
    X_test       = df_test[FEATURE_COLS].astype(np.float32)
    y_test       = df_test[TARGET_COL].astype(int)

    # Carve a small validation fold off the training set for early stopping
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_full, y_train_full,
        test_size=0.15,
        stratify=y_train_full,
        random_state=RANDOM_STATE,
    )

    print("\nRunning 5-fold stratified CV on the training set...")
    cv_scores = cross_validate(X_train_full, y_train_full)
    print(f"  CV macro-F1 per fold: {[f'{s:.4f}' for s in cv_scores]}")
    print(f"  CV macro-F1 mean    : {cv_scores.mean():.4f} (+/- {cv_scores.std():.4f})")

    print("\nFitting final model on the full training set...")
    model = train_model(X_train, y_train, X_val, y_val)

    evaluate(model, X_test, y_test)
    show_feature_importance(model)

    os.makedirs("models", exist_ok=True)
    bundle = {
        "model": model,
        "feature_order": FEATURE_COLS,
        "class_names": CLASS_NAMES,
    }
    joblib.dump(bundle, MODEL_PATH)
    print(f"\nSaved bundle to {MODEL_PATH}")
    print("Start the API: uvicorn main:app --port 8001 --reload")


if __name__ == "__main__":
    main()
