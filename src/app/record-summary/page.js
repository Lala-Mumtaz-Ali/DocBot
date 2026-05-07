'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '../_components/navbar'
import ReactMarkdown from 'react-markdown'
import styles from '../style/recordSummary.module.css'
import Footer from '../_components/aboutus'

// ─────────────────────────────────────────────────────────────
// CHART COMPONENT
// ─────────────────────────────────────────────────────────────
function TrendChart({ reports }) {
  if (!reports || reports.length < 2) return null

  // Sort by date chronologically
  const sorted = [...reports].sort((a, b) => new Date(a.report_date) - new Date(b.report_date))
  const data = sorted.map(r => ({
    date: r.report_date,
    val: r.hba1c ?? null
  }))

  const validData = data.filter(d => d.val !== null)
  if (validData.length < 2) return <div style={{color:'#64748b'}}>Not enough HbA1c data points for chart.</div>

  const minVal = Math.min(...validData.map(d => d.val))
  const maxVal = Math.max(...validData.map(d => d.val))
  const range = maxVal - minVal || 1
  const padding = range * 0.2
  const yMin = Math.max(0, minVal - padding)
  const yMax = maxVal + padding

  return (
    <div className={styles.chart}>
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        {/* Threshold line at 6.5% (Diabetes cutoff) */}
        {yMax > 6.5 && yMin < 6.5 && (
          <line
            x1="0" y1={100 - ((6.5 - yMin) / (yMax - yMin)) * 100}
            x2="100" y2={100 - ((6.5 - yMin) / (yMax - yMin)) * 100}
            stroke="#f87171" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.6"
          />
        )}
        <polyline
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2.5"
          points={validData.map((d, i) => {
            const x = (i / (validData.length - 1)) * 100
            const y = 100 - ((d.val - yMin) / (yMax - yMin)) * 100
            return `${x},${y}`
          }).join(' ')}
        />
        {validData.map((d, i) => {
          const x = (i / (validData.length - 1)) * 100
          const y = 100 - ((d.val - yMin) / (yMax - yMin)) * 100
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="2.5" fill="#0d1b35" stroke="#38bdf8" strokeWidth="1" />
              <text x={x} y={y - 5} fill="#94a3b8" fontSize="4" textAnchor="middle">
                {d.val}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const RISK_CONFIG = {
  0: { label: "Stable", desc: "Your metrics are generally within healthy or stable limits.", emoji: "🟢", cls: styles.stable },
  1: { label: "Moderate Risk", desc: "Your metrics show some deterioration. Monitoring advised.", emoji: "🟡", cls: styles.moderate },
  2: { label: "Rapid Deterioration", desc: "Your metrics are rapidly worsening. Please consult your doctor.", emoji: "🔴", cls: styles.rapid },
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
export default function RecordSummaryPage() {
  const router = useRouter()
  const fileInputRef = useRef(null)

  // Auth & Init State
  const [user, setUser] = useState(null)
  const [initialLoading, setInitialLoading] = useState(true)

  // Tabs: 'summary' or 'upload'
  const [activeTab, setActiveTab] = useState('summary')

  // History State
  const [historyResult, setHistoryResult] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Upload State
  const [step, setStep] = useState(0) // 0 = upload, 1 = extracting
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState([])
  const [extracted, setExtracted] = useState([])
  const [error, setError] = useState('')

  // ── Fetch user & history on mount ──
  useEffect(() => {
    const fetchHistory = async (userId) => {
      setHistoryLoading(true)
      try {
        const res = await fetch('/api/analyze-trend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        })
        
        if (res.status === 404) {
          // No reports found, force them to upload tab
          setHistoryResult(null)
          setActiveTab('upload')
        } else if (res.ok) {
          const data = await res.json()
          setHistoryResult(data)
          setActiveTab('summary')
        } else {
           throw new Error('Failed to load history')
        }
      } catch (err) {
        console.error(err)
      } finally {
        setHistoryLoading(false)
        setInitialLoading(false)
      }
    }

    const userData = localStorage.getItem('user')
    if (userData) {
      try {
        const parsed = JSON.parse(userData)
        setUser(parsed)
        fetchHistory(parsed.email)
      } catch(e) {
        console.error("Invalid user data")
        router.push('/signin')
      }
    } else {
      router.push('/signin')
    }
  }, [router])

  // ── Dynamic File Requirement ──
  const minRequiredFiles = historyResult && historyResult.reports?.length > 0 ? 1 : 2;

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
    if (files.length < minRequiredFiles) {
      setError(`Please add at least ${minRequiredFiles} PDF file${minRequiredFiles > 1 ? 's' : ''}.`)
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
        fd.append('userId', user.email) // Send actual user ID!

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

    // Check we got enough valid extractions
    const valid = results.filter(Boolean)
    if (valid.length < minRequiredFiles) {
      setError(`At least ${minRequiredFiles} report${minRequiredFiles > 1 ? 's' : ''} must be successfully extracted to proceed.`)
      return
    }

    // Extraction done successfully! 
    // Now trigger an automatic re-fetch of the trend analysis.
    try {
      const res = await fetch('/api/analyze-trend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.email }),
      })
      const data = await res.json()
      if (res.ok) {
        setHistoryResult(data)
        // Reset upload state and switch back to summary
        setStep(0)
        setFiles([])
        setExtracted([])
        setActiveTab('summary')
      } else {
        throw new Error(data.error || 'Trend analysis failed')
      }
    } catch(err) {
      setError(`Extraction succeeded, but trend update failed: ${err.message}`)
    }
  }

  // ── Reset Upload State ──
  const handleResetUpload = () => {
    setStep(0)
    setFiles([])
    setExtracted([])
    setError('')
  }

  const validExtracted = extracted.filter(Boolean)
  const allDone = files.length > 0 && files.every(f => f.status === 'done' || f.status === 'error')
  const riskCfg = historyResult ? (RISK_CONFIG[historyResult.risk_score] ?? RISK_CONFIG[0]) : null

  if (initialLoading) {
    return (
      <div className={styles.page}>
        <Navbar />
        <div style={{ textAlign: 'center', marginTop: '10rem', color: '#94a3b8' }}>
          <div className={styles.spinner} style={{ width: '2rem', height: '2rem', borderWidth: '3px' }}></div>
          <p style={{ marginTop: '1rem' }}>Loading your records...</p>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <>
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

      {/* Tabs Menu */}
      <div className={styles.tabsMenu}>
        <button 
           className={`${styles.tabBtn} ${activeTab === 'summary' ? styles.activeTab : ''}`}
           onClick={() => setActiveTab('summary')}
           disabled={!historyResult} 
           title={!historyResult ? "Upload at least 2 reports first" : ""}
        >
          Summary & Trend
        </button>
        <button 
           className={`${styles.tabBtn} ${activeTab === 'upload' ? styles.activeTab : ''}`}
           onClick={() => setActiveTab('upload')}
        >
          Upload Reports
        </button>
      </div>

      {/* ─── TAB: RECORD SUMMARY ─── */}
      {activeTab === 'summary' && historyResult && (
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.cardTitle}>Your Trend Report</h2>
            <button className={styles.btnSecondary} onClick={() => setActiveTab('upload')}>+ Add New Report</button>
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
          {historyResult.reports?.length >= 2 && (
            <div className={styles.chartWrapper}>
              <p className={styles.chartTitle}>HbA1c Trend (%) Over Time</p>
              <TrendChart reports={historyResult.reports} />
            </div>
          )}

          {/* Data table */}
          {historyResult.reports?.length > 0 && (
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
                  {historyResult.reports.map((r, i) => (
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
          {historyResult.analysis && (
            <div style={{ marginTop: '1.5rem' }}>
              <p className={styles.chartTitle}>🤖 DOCBOT Analysis</p>
              <div className={styles.analysisBox}>
                <ReactMarkdown>{historyResult.analysis}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: UPLOAD REPORTS ─── */}
      {activeTab === 'upload' && (
        <>
          {/* Step Tracker (Only visible during upload) */}
          <div className={styles.stepper}>
            <div className={`${styles.step} ${step === 0 ? styles.active : ''} ${step > 0 ? styles.done : ''}`}>
              <div className={styles.stepDot}>{step > 0 ? '✓' : '1'}</div>
              <span className={styles.stepLabel}>Upload</span>
            </div>
            <div className={`${styles.step} ${step === 1 ? styles.active : ''}`}>
              <div className={styles.stepDot}>2</div>
              <span className={styles.stepLabel}>Extracting</span>
            </div>
          </div>

          {/* UPLOAD VIEW */}
          {step === 0 && (
            <div className={styles.card}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.cardTitle}>Upload Lab Reports</h2>
              </div>

              {/* Dynamic instruction based on history */}
              {!historyResult && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(56,189,248,0.1)', borderRadius: '0.5rem', color: '#7dd3fc', fontSize: '0.9rem' }}>
                  👋 <strong>Welcome!</strong> We noticed you don't have any past reports in our system. Please upload <strong>at least 2 reports</strong> below to establish your initial trend baseline.
                </div>
              )}

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
                <p className={styles.uploadHint}>
                  Accepts PDF files only • Minimum {minRequiredFiles} report{minRequiredFiles > 1 ? 's' : ''} required
                </p>
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
                disabled={files.length < minRequiredFiles}
              >
                Extract Biomarkers & Update Trend →
              </button>
            </div>
          )}

          {/* EXTRACTING VIEW */}
          {step === 1 && (
            <div className={styles.card}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.cardTitle}>Extracting Biomarkers</h2>
                <button className={styles.btnSecondary} onClick={handleResetUpload}>← Stop & Reset</button>
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
                  <p className={styles.extractedTitle}>Extracted Results</p>
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

              {/* Show loading indicator when generating updated trend */}
              {allDone && validExtracted.length >= minRequiredFiles && !error && (
                <div style={{ marginTop: '2rem', textAlign: 'center' }}>
                   <div className={styles.spinner}></div>
                   <p style={{ marginTop: '0.5rem', color: '#94a3b8' }}>Generating updated trend analysis...</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
    <Footer  />
    </>
  )
}
