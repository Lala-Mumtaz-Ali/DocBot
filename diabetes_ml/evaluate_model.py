"""
evaluate_model.py - Sanity-check a saved classifier against the processed feature set.

The model bundle saved by train_model.py contains its own feature_order and
class names, so this script only needs the .pkl plus the processed CSV.
"""

import os
import sys
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)

MODEL_PATH = "models/xgboost_model.pkl"
DATA_PATH  = "data/processed/features.csv"
TARGET_COL = "risk_label"


def main():
    print("XGBoost Classifier Evaluation")
    print("=" * 40)

    if not os.path.exists(MODEL_PATH):
        print(f"ERROR: model not found at {MODEL_PATH}. Run train_model.py first.")
        sys.exit(1)
    if not os.path.exists(DATA_PATH):
        print(f"ERROR: processed data not found at {DATA_PATH}. Run train_model.py first.")
        sys.exit(1)

    bundle = joblib.load(MODEL_PATH)
    if isinstance(bundle, dict) and "model" in bundle:
        model         = bundle["model"]
        feature_order = bundle["feature_order"]
        class_names   = bundle.get("class_names", {0: "0", 1: "1", 2: "2"})
    else:
        # Backwards compat: legacy .pkl that stored only the model object
        model         = bundle
        feature_order = [
            "hba1c", "fasting_glucose",
            "hba1c_delta_1", "days_since_prev1", "velocity_1",
            "hba1c_delta_2", "days_since_prev2", "velocity_2",
            "acceleration", "projected_hba1c",
        ]
        class_names = {0: "Stable", 1: "Moderate", 2: "Rapid Deterioration"}

    df = pd.read_csv(DATA_PATH)

    missing = [c for c in feature_order + [TARGET_COL] if c not in df.columns]
    if missing:
        print(f"ERROR: columns missing in {DATA_PATH}: {missing}")
        sys.exit(1)

    X = df[feature_order].astype(np.float32)
    y = df[TARGET_COL].astype(int)

    print(f"Evaluating on {len(df)} rows...")
    y_pred = model.predict(X)

    acc      = accuracy_score(y, y_pred)
    f1_macro = f1_score(y, y_pred, average="macro")

    print(f"\nOverall accuracy : {acc * 100:.2f}%")
    print(f"Macro F1         : {f1_macro:.4f}")

    print("\nClassification report:")
    print(classification_report(
        y, y_pred,
        labels=[0, 1, 2],
        target_names=[class_names[i] for i in [0, 1, 2]],
        zero_division=0,
    ))

    print("Confusion matrix (rows=true, cols=pred):")
    cm = confusion_matrix(y, y_pred, labels=[0, 1, 2])
    cm_df = pd.DataFrame(
        cm,
        index=[f"true_{class_names[i]}" for i in [0, 1, 2]],
        columns=[f"pred_{class_names[i]}" for i in [0, 1, 2]],
    )
    print(cm_df)

    print("\nNote: this evaluates on the FULL dataset, including training rows.")
    print("Honest held-out scores are printed during train_model.py itself.")


if __name__ == "__main__":
    main()
