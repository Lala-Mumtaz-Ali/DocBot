'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '../_components/navbar'
import ReactMarkdown from 'react-markdown'
import styles from '../style/recordSummary.module.css'

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const STEPS = ['Upload PDFs', 'Extract Data', 'Trend Analysis']

const RISK_CONFIG = {
  0: { label: 'Stable',               emoji: '🟢', cls: styles.stable,   desc: 'Your readings are within a healthy range. Keep up the great work!' },
  1: { label: 'Moderate Risk',        emoji: '🟡', cls: styles.moderate, desc: 'There are signs of rising risk. Some lifestyle changes may help.' },
  2: { label: 'Rapid Deterioration',  emoji: '🔴', cls: styles.rapid,    desc: 'Your readings show a concerning upward trend. Please consult your doctor soon.' },
}

// ─────────────────────────────────────────────────────────────
// SVG TREND CHART
// ─────────────────────────────────────────────────────────────
function TrendChart({ reports }) {
  if (!reports || reports.length < 2) return null

  const values = reports.map(r => r.hba1c).filter(v => v != null)
  if (values.length < 2) return null

  const W = 700, H = 140, PAD = 30
  const minV = Math.min(...values) - 0.5
  const maxV = Math.max(...values) + 0.5

  const px = (i) => PAD + (i / (values.length - 1)) * (W - PAD * 2)
  const py = (v) => H - PAD - ((v - minV) / (maxV - minV)) * (H - PAD * 2)

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(v)}`).join(' ')
  const areaPath = `${linePath} L${px(values.length - 1)},${H - PAD} L${px(0)},${H - PAD} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#38bdf8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const y = H - PAD - t * (H - PAD * 2)
        const val = (minV + t * (maxV - minV)).toFixed(1)
        return (
          <g key={i}>
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PAD - 6} y={y + 4} fontSize="10" fill="#475569" textAnchor="end">{val}</text>
          </g>
        )
      })}

      {/* Area fill */}
      <path d={areaPath} fill="url(#chartGrad)" />

      {/* Line */}
      <path d={linePath} stroke="#38bdf8" strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round" />

      {/* Data points */}
      {values.map((v, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(v)} r="5" fill="#0d1b35" stroke="#38bdf8" strokeWidth="2" />
          <text x={px(i)} y={py(v) - 10} fontSize="10" fill="#7dd3fc" textAnchor="middle">{v.toFixed(1)}</text>
          <text x={px(i)} y={H - 8} fontSize="9" fill="#475569" textAnchor="middle"
            transform={`rotate(-30, ${px(i)}, ${H - 8})`}>
            {reports[i]?.report_date?.slice(5) ?? ''} {/* MM-DD */}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
export default function RecordSummaryPage() {
  const router = useRouter()
  const fileInputRef = useRef(null)

  // Step: 0 = upload, 1 = extracting, 2 = results
  const [step, setStep] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // Selected files with status
  const [files, setFiles] = useState([])
  // Extracted biomarker rows (one per file)
  const [extracted, setExtracted] = useState([])
  // Final analysis result
  const [result, setResult] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Add files (dedup by name) ──
  const addFiles = useCallback((incoming) => {
    setError('')
    const pdfs = Array.from(incoming).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    if (pdfs.length < incoming.length) {
      setError('Only PDF files are accepted. Non-PDF files were ignored.')
    }
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.file.name))
      const newItems = pdfs
        .filter(f => !existingNames.has(f.name))
        .map(f => ({ file: f, status: 'pending', extracted: null, error: null }))
      return [...prev, ...newItems]
    })
  }, [])

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setExtracted(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Drag & Drop ──
  const onDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = () => setIsDragging(false)

  // ── Extract all PDFs sequentially ──
  const handleExtract = async () => {
    if (files.length === 0) {
      setError('Please add at least one PDF file.')
      return
    }
    setError('')
    setStep(1)
    setExtracted([])

    const results = []

    for (let i = 0; i < files.length; i++) {
      // Mark as loading
      setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'loading' } : f))

      try {
        const fd = new FormData()
        fd.append('file', files[i].file)

        const res = await fetch('/api/extract-report', { method: 'POST', body: fd })
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Extraction failed')
        }

        const row = data.report
        results.push(row)
        setExtracted([...results])
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'done', extracted: row } : f))
      } catch (err) {
        results.push(null)
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: err.message } : f))
      }
    }

    // Check we got at least 2 valid extractions
    const valid = results.filter(Boolean)
    if (valid.length < 2) {
      setError('At least 2 reports must be successfully extracted to compute a trend. Please add more PDFs.')
    }
  }

  // ── Generate trend analysis ──
  const handleAnalyze = async () => {
    setAnalysisLoading(true)
    setError('')

    try {
      const res = await fetch('/api/analyze-trend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'demo_user' }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Analysis failed')

      setResult(data)
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setAnalysisLoading(false)
    }
  }

  // ── Reset ──
  const handleReset = () => {
    setStep(0)
    setFiles([])
    setExtracted([])
    setResult(null)
    setError('')
    setAnalysisLoading(false)
  }

  const validExtracted = extracted.filter(Boolean)
  const allDone = files.length > 0 && files.every(f => f.status === 'done' || f.status === 'error')
  const riskCfg = result ? (RISK_CONFIG[result.risk_score] ?? RISK_CONFIG[0]) : null

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <Navbar />

      {/* Hero */}
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>🩺 Diabetes Trend Analysis</h1>
        <p className={styles.heroSubtitle}>
          Upload your past diabetes lab reports (PDF). DOCBOT will extract your biomarkers,
          score your risk trend, and explain what it means — in plain English.
        </p>
      </div>

      {/* Step Tracker */}
      <div className={styles.stepper}>
        {STEPS.map((label, i) => (
          <div
            key={i}
            className={`${styles.step} ${i === step ? styles.active : ''} ${i < step ? styles.done : ''}`}
          >
            <div className={styles.stepDot}>{i < step ? '✓' : i + 1}</div>
            <span className={styles.stepLabel}>{label}</span>
          </div>
        ))}
      </div>

      {/* ─── STEP 0: UPLOAD ─── */}
      {step === 0 && (
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.cardTitle}>Upload Lab Reports</h2>
          </div>

          {/* Drop zone */}
          <div
            className={`${styles.uploadZone} ${isDragging ? styles.dragging : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
          >
            <span className={styles.uploadIcon}>📄</span>
            <p className={styles.uploadTitle}>Drag & drop PDFs here, or click to browse</p>
            <p className={styles.uploadHint}>Accepts PDF files only • Upload 2 or more reports for trend analysis</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              className={styles.uploadInput}
              onChange={e => addFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className={styles.fileList}>
              {files.map((f, idx) => (
                <div key={idx} className={styles.fileItem}>
                  <span className={styles.fileIcon}>📑</span>
                  <span className={styles.fileName}>{f.file.name}</span>
                  <span className={`${styles.fileStatus} ${styles.statusPending}`}>Ready</span>
                  <button className={styles.removeBtn} onClick={() => removeFile(idx)} title="Remove">✕</button>
                </div>
              ))}
            </div>
          )}

          {error && <div className={styles.errorBox}>⚠️ {error}</div>}

          <button
            className={styles.btnPrimary}
            onClick={handleExtract}
            disabled={files.length < 1}
          >
            Extract Biomarkers →
          </button>
        </div>
      )}

      {/* ─── STEP 1: EXTRACTING ─── */}
      {step === 1 && (
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.cardTitle}>Extracting Biomarkers</h2>
            <button className={styles.btnSecondary} onClick={handleReset}>← Start Over</button>
          </div>

          <div className={styles.fileList}>
            {files.map((f, idx) => (
              <div key={idx} className={styles.fileItem}>
                <span className={styles.fileIcon}>📑</span>
                <span className={styles.fileName}>{f.file.name}</span>
                <span className={`${styles.fileStatus} ${
                  f.status === 'loading' ? styles.statusLoading :
                  f.status === 'done'    ? styles.statusDone    :
                  f.status === 'error'   ? styles.statusError   :
                  styles.statusPending
                }`}>
                  {f.status === 'loading' && <><span className={styles.spinner}></span> Extracting…</>}
                  {f.status === 'done'    && '✓ Done'}
                  {f.status === 'error'   && '✕ Failed'}
                  {f.status === 'pending' && 'Waiting…'}
                </span>
              </div>
            ))}
          </div>

          {/* Extracted biomarker preview table */}
          {validExtracted.length > 0 && (
            <div className={styles.extractedData}>
              <p className={styles.extractedTitle}>Extracted Biomarkers</p>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Report Date</th>
                    <th>HbA1c (%)</th>
                    <th>Fasting Glucose (mg/dL)</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f, idx) =>
                    f.extracted ? (
                      <tr key={idx}>
                        <td>{f.file.name.slice(0, 20)}{f.file.name.length > 20 ? '…' : ''}</td>
                        <td>{f.extracted.report_date ?? <span className={styles.nullCell}>Not found</span>}</td>
                        <td>{f.extracted.hba1c      ?? <span className={styles.nullCell}>Not found</span>}</td>
                        <td>{f.extracted.fasting_glucose ?? <span className={styles.nullCell}>Not found</span>}</td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            </div>
          )}

          {error && <div className={styles.errorBox}>⚠️ {error}</div>}

          {allDone && (
            <button
              className={styles.btnPrimary}
              onClick={handleAnalyze}
              disabled={analysisLoading || validExtracted.length < 2}
            >
              {analysisLoading
                ? <><span className={styles.spinner}></span> Analyzing with DOCBOT…</>
                : 'Generate Trend Analysis →'}
            </button>
          )}
        </div>
      )}

      {/* ─── STEP 2: RESULTS ─── */}
      {step === 2 && result && (
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.cardTitle}>Your Trend Report</h2>
            <button className={styles.btnSecondary} onClick={handleReset}>+ Analyze More</button>
          </div>

          {/* Risk Badge */}
          {riskCfg && (
            <div className={`${styles.riskBadge} ${riskCfg.cls}`}>
              <span className={styles.riskEmoji}>{riskCfg.emoji}</span>
              <div className={styles.riskInfo}>
                <h3>Risk Level: {riskCfg.label}</h3>
                <p>{riskCfg.desc}</p>
              </div>
            </div>
          )}

          {/* HbA1c trend chart */}
          {result.reports?.length >= 2 && (
            <div className={styles.chartWrapper}>
              <p className={styles.chartTitle}>HbA1c Trend (%) Over Time</p>
              <TrendChart reports={result.reports} />
            </div>
          )}

          {/* Data table */}
          {result.reports?.length > 0 && (
            <div className={styles.extractedData}>
              <p className={styles.extractedTitle}>Report History</p>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>HbA1c (%)</th>
                    <th>Fasting Glucose (mg/dL)</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {result.reports.map((r, i) => (
                    <tr key={i}>
                      <td>{r.report_date ?? '—'}</td>
                      <td>{r.hba1c      ?? <span className={styles.nullCell}>N/A</span>}</td>
                      <td>{r.fasting_glucose ?? <span className={styles.nullCell}>N/A</span>}</td>
                      <td>{r.source_filename ? r.source_filename.slice(0, 24) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* DOCBOT analysis */}
          {result.analysis && (
            <div style={{ marginTop: '1.5rem' }}>
              <p className={styles.chartTitle}>🤖 DOCBOT Analysis</p>
              <div className={styles.analysisBox}>
                <ReactMarkdown>{result.analysis}</ReactMarkdown>
              </div>
            </div>
          )}

          {error && <div className={styles.errorBox}>⚠️ {error}</div>}
        </div>
      )}
    </div>
  )
}
