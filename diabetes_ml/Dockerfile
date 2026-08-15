# 3.12+ is required: xgboost 3.3.0 and newer declare Requires-Python >=3.12,
# and the committed .pkl bundles were written by xgboost 3.4.1. On 3.11 pip can
# only reach xgboost 3.2.0, which cannot install and would be older than the
# version that pickled the models.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
