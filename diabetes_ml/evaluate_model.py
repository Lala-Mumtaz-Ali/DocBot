import os
import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import sys

# ─────────────────────────────────────────────────────────────
# SETUP
# ─────────────────────────────────────────────────────────────
MODEL_PATH = "models/xgboost_model.pkl"
DATA_PATH = "data/processed/features.csv"

FEATURE_COLS = [
    "hba1c", 
    "fasting_glucose", 
    "hba1c_delta_1", 
    "days_since_prev1", 
    "velocity_1", 
    "hba1c_delta_2", 
    "velocity_2", 
    "acceleration"
]
TARGET_COL = "next_risk"

def evaluate():
    print("🩺 XGBoost Model Accuracy Testing")
    print("="*40)
    
    # 1. Load Model
    if not os.path.exists(MODEL_PATH):
        print(f"❌ Error: Model not found at {MODEL_PATH}")
        sys.exit(1)
    
    print(f"📥 Loading model from {MODEL_PATH}...")
    model = joblib.load(MODEL_PATH)
    
    # 2. Load Data
    if not os.path.exists(DATA_PATH):
        print(f"❌ Error: Processed data not found at {DATA_PATH}")
        print("Run train_model.py first to generate the features.")
        sys.exit(1)
        
    print(f"📥 Loading test data from {DATA_PATH}...")
    df = pd.read_csv(DATA_PATH)
    
    # 3. Extract Features and Target
    missing_cols = [col for col in FEATURE_COLS + [TARGET_COL] if col not in df.columns]
    if missing_cols:
        print(f"❌ Error: Missing columns in dataset: {missing_cols}")
        sys.exit(1)

    X = df[FEATURE_COLS]
    y = df[TARGET_COL]
    
    print(f"📊 Running predictions on {len(df)} patient records...")
    
    # 4. Predict
    y_pred = model.predict(X)
    
    # 5. Calculate Metrics
    acc = accuracy_score(y, y_pred)
    
    print("\n" + "="*40)
    print(f"✅ OVERALL ACCURACY: {acc * 100:.2f}%")
    print("="*40 + "\n")
    
    print("📋 CLASSIFICATION REPORT:")
    print(classification_report(y, y_pred, zero_division=0))
    
    print("🧩 CONFUSION MATRIX:")
    cm = confusion_matrix(y, y_pred)
    cm_df = pd.DataFrame(cm)
    print(cm_df)
    
if __name__ == "__main__":
    evaluate()
