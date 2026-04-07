import json
import glob
import pandas as pd
import os
from collections import defaultdict

def main():
    print("🚀 Starting FHIR Parsing Pipeline...")

    fhir_dir = r"d:\FYP\docbot\Model_Training_Material\fhir"
    files = glob.glob(os.path.join(fhir_dir, "*.json"))

    # We group by (patient_id, date) to merge HbA1c and Glucose taken on the same day.
    data_rows = defaultdict(lambda: {"hba1c": None, "fasting_glucose": None})

    print(f"📂 Found {len(files)} JSON bundles. Processing...")

    processed = 0
    for f in files:
        with open(f, 'r', encoding='utf-8') as file:
            try:
                data = json.load(file)
            except json.JSONDecodeError:
                continue
                
            # 1. Find Patient ID (UUID)
            patient_id = None
            for entry in data.get('entry', []):
                res = entry.get('resource', {})
                rt = res.get('resourceType')
                if rt == 'Patient':
                    patient_id = res.get('id')
                    break
                    
            if not patient_id:
                continue

            # 2. Extract Observations
            for entry in data.get('entry', []):
                res = entry.get('resource', {})
                rt = res.get('resourceType')
                if rt == 'Observation':
                    coding = res.get('code', {}).get('coding', [])
                    codes = [c.get('code') for c in coding]
                    
                    # Target LOINC Codes
                    is_hba1c = "4548-4" in codes
                    is_glucose = "2339-0" in codes
                    
                    if is_hba1c or is_glucose:
                        date_str = res.get('effectiveDateTime', '')
                        if not date_str:
                            continue
                        # Slice to extract just the YYYY-MM-DD
                        date = date_str[:10]
                        
                        val = res.get('valueQuantity', {}).get('value')
                        if val is not None:
                            key = (patient_id, date)
                            if is_hba1c:
                                data_rows[key]["hba1c"] = val
                            if is_glucose:
                                data_rows[key]["fasting_glucose"] = val

        processed += 1
        if processed % 100 == 0:
            print(f"   Processed {processed} patient histories...")

    # Convert mapping to list of single-dimensional rows
    flattened = []
    for (pid, date), vals in data_rows.items():
        flattened.append({
            "patient_id": pid,
            "report_date": date,
            "hba1c": vals["hba1c"],
            "fasting_glucose": vals["fasting_glucose"]
        })

    df = pd.DataFrame(flattened)
    
    if df.empty:
        print("❌ CRITICAL: No matching observations were found in the dataset.")
        return

    # Chronologically sort the simulated tracking history
    df = df.sort_values(["patient_id", "report_date"]).reset_index(drop=True)

    # 3. Export to intermediate Raw Data
    os.makedirs("data/raw", exist_ok=True)
    out_path = "data/raw/diabetes_raw_fhir.csv"
    df.to_csv(out_path, index=False)

    print(f"\n✅ FHIR extraction complete! Extracted {len(df)} chronological health checkup events.")
    print(f"📊 Saved exactly to {out_path}")

if __name__ == "__main__":
    main()
