---
title: DocBot ML Service
emoji: 🩺
colorFrom: green
colorTo: blue
sdk: docker
pinned: false
app_port: 7860
---

# DocBot Diabetes ML Microservice

XGBoost-based diabetes risk prediction service.

## Endpoints

- `GET /` — health check
- `POST /predict-risk` — returns risk score (0=Stable, 1=Moderate, 2=Rapid Deterioration)
