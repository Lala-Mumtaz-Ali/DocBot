"use client";

import React, { useState, useEffect } from "react";
import styles from "../style/Record.module.css";

import { FaCloudUploadAlt, FaList, FaTrash, FaShare, FaTimes, FaSearchPlus, FaSearchMinus, FaDownload, FaEye } from "react-icons/fa";

export default function RecordPage() {
  const [file, setFile] = useState(null);
  const [records, setRecords] = useState([]);
  const [previewId, setPreviewId] = useState(null);
  const [fullScreenId, setFullScreenId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("view");
  const [showSendPopup, setShowSendPopup] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [selectedFileId, setSelectedFileId] = useState(null);

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  // ✅ Fetch records
  const fetchRecords = async () => {
    try {
      const res = await fetch("/api/records", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok && data.records) {
        // ✅ We don't need fileUrl here immediately due to auth issue
        setRecords(data.records);
      } else {
        console.error("❌", data.message);
      }
    } catch (err) {
      console.error("❌ Fetch Error:", err);
    }
  };

  useEffect(() => {
    if (token) fetchRecords();
  }, []);

  useEffect(() => {
    if (activeTab === "view" && token) fetchRecords();

    // ✅ Close preview when switching tabs
    setPreviewId(null);
    setFullScreenId(null);
    setZoom(1);
  }, [activeTab]);

  // ✅ File input
  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (!selected) return;
    setFile(selected);
  };

  // ✅ Upload
  const handleUpload = async () => {
    if (!file) return alert("Please choose a file first!");
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/records", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        alert("✅ Record uploaded successfully!");
        setFile(null);
        // setActiveTab("view"); // Removed
        await fetchRecords();
      } else {
        alert(`❌ ${data.message || "Upload failed"}`);
      }
    } catch (err) {
      console.error("❌ Upload Error:", err);
    } finally {
      setLoading(false);
    }
  };

  // ✅ Delete (Optimistic UI)
  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this record?")) return;

    // 1. Optimistic Update: Remove from UI immediately
    const previousRecords = [...records];
    setRecords((prev) => prev.filter((r) => r._id !== id));

    try {
      const res = await fetch("/api/records", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ recordId: id }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Rollback if failed
        alert(`❌ ${data.message || "Delete failed"}`);
        setRecords(previousRecords);
      }
    } catch (err) {
      console.error("❌ Delete Error:", err);
      alert("❌ Delete failed (Network Error)");
      setRecords(previousRecords);
    }
  };

  // ✅ Authenticated Fetch for Blob
  const fetchFileBlob = async (recordId) => {
    try {
      const res = await fetch(`/api/records/${recordId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load file");
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error("Error fetching file:", err);
      alert("Error loading file. Please try again.");
      return null;
    }
  };

  const handlePreview = async (rec) => {
    if (previewId === rec._id) {
      setPreviewId(null);
      return;
    }

    // Check cache first
    if (rec.tempUrl) {
      setPreviewId(rec._id);
      return;
    }

    setLoading(true);
    const blobUrl = await fetchFileBlob(rec._id);
    if (blobUrl) {
      // Update local state with temp URL
      setRecords(prev => prev.map(r => r._id === rec._id ? { ...r, tempUrl: blobUrl } : r));
      setPreviewId(rec._id);
    }
    setLoading(false);
  };

  const handleDownload = async (rec) => {
    let blobUrl = rec.tempUrl;

    // If not cached, fetch it
    if (!blobUrl) {
      blobUrl = await fetchFileBlob(rec._id);
      if (blobUrl) {
        setRecords(prev => prev.map(r => r._id === rec._id ? { ...r, tempUrl: blobUrl } : r));
      }
    }

    if (blobUrl) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = rec.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Clean up strictly if needed, but keeping for preview might be okay
    }
  };

  // ✅ Send record
  const handleSend = async () => {
    if (!sendTo || !selectedFileId) {
      alert("Please enter recipient email or user ID.");
      return;
    }

    try {
      const res = await fetch("/api/send-record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recordId: selectedFileId,
          recipient: sendTo,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        alert("✅ Record sent successfully!");
        setShowSendPopup(false);
        setSendTo("");
        setSelectedFileId(null);
      } else {
        alert(`❌ ${data.message || "Failed to send file"}`);
      }
    } catch (err) {
      console.error("❌ Send Error:", err);
    }
  };

  // ✅ Zoom controls
  const zoomIn = () => setZoom((z) => Math.min(z + 0.2, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.5));
  const closeFullScreen = () => setFullScreenId(null);

  return (
    <div className={styles.container}>
      <h2 className={styles.pageTitle}>📁 Record Management</h2>

      {/* Tabs */}
      <div className={styles.tabContainer}>
        <button
          className={`${styles.tabButton} ${activeTab === "view" ? styles.activeTab : ""
            }`}
          onClick={() => setActiveTab("view")}
        >
          <FaList /> View Past Records
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "add" ? styles.activeTab : ""
            }`}
          onClick={() => setActiveTab("add")}
        >
          <FaCloudUploadAlt /> Add Record
        </button>
      </div>

      {/* Add Record */}
      {activeTab === "add" && (
        <div className={styles.uploadSection}>
          <input
            type="file"
            className={styles.inputFile}
            onChange={handleFileChange}
          />
          <div className={styles.buttonGroup}>
            <button
              className={`${styles.actionButton} ${styles.uploadButton}`}
              onClick={handleUpload}
              disabled={loading}
            >
              <FaCloudUploadAlt /> {loading ? "Uploading..." : "Upload Record"}
            </button>
            <button
              className={`${styles.actionButton} ${styles.cancelButton}`}
              onClick={() => {
                setFile(null);
                setActiveTab("view");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* View Records */}
      {activeTab === "view" && (
        <div className={styles.recordsList}>
          {records.length === 0 ? (
            <p className={styles.emptyText}>No records found.</p>
          ) : (
            records.map((rec) => (
              <div key={rec._id} className={styles.recordContainer}>
                {/* ✅ Preview */}
                {/* ✅ File Name */}
                <p className={styles.recordText}>{rec.fileName}</p>

                <div className={styles.recordButtons}>
                  <button
                    className={styles.actionButton}
                    onClick={() => handlePreview(rec)}
                  >
                    <FaEye /> {previewId === rec._id ? "Close Preview" : "Preview"}
                  </button>

                  <button
                    className={`${styles.actionButton} ${styles.downloadButton}`}
                    onClick={() => handleDownload(rec)}
                  >
                    <FaDownload /> Download
                  </button>

                  <button
                    className={`${styles.actionButton} ${styles.deleteButton}`}
                    onClick={() => handleDelete(rec._id)}
                  >
                    <FaTrash /> Delete
                  </button>

                  <button
                    className={`${styles.actionButton} ${styles.sendButton}`}
                    onClick={() => {
                      setSelectedFileId(rec._id);
                      setShowSendPopup(true);
                    }}
                  >
                    <FaShare /> Send
                  </button>
                </div>

                {previewId === rec._id && (
                  <div className={styles.previewBox}>
                    {loading ? (
                      <p>Loading file...</p>
                    ) : (
                      <>
                        {rec.fileType === "pdf" ? (
                          <iframe
                            src={rec.tempUrl}
                            className={styles.previewMedia}
                            title="PDF Preview"
                          />
                        ) : (
                          <img
                            src={rec.tempUrl}
                            alt={rec.fileName}
                            className={styles.previewMedia}
                          />
                        )}
                        <button
                          className={styles.fullScreenButton}
                          onClick={() => {
                            setFullScreenId(rec._id);
                            setZoom(1);
                          }}
                        >
                          Full Screen
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* ✅ Fullscreen */}
                {fullScreenId === rec._id && (
                  <div className={styles.fullScreenOverlay}>
                    {rec.fileType === "pdf" ? (
                      <iframe
                        src={rec.tempUrl} // Use Blob URL
                        title="Full PDF"
                        className={styles.fullScreenMedia}
                        style={{
                          transform: `scale(${zoom})`,
                          transformOrigin: "0 0",
                        }}
                      />
                    ) : (
                      <img
                        src={rec.tempUrl} // Use Blob URL
                        alt="Full"
                        className={styles.fullScreenMedia}
                        style={{ transform: `scale(${zoom})` }}
                      />
                    )}
                    <div className={styles.zoomControls}>
                      <button onClick={zoomIn}><FaSearchPlus /></button>
                      <button onClick={zoomOut}><FaSearchMinus /></button>
                    </div>
                    <button
                      className={styles.closeFullScreen}
                      onClick={closeFullScreen}
                    >
                      <FaTimes />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Popup */}
      {showSendPopup && (
        <div className={styles.popupOverlay}>
          <div className={styles.popupBox}>
            <h3>Send Record</h3>
            <input
              type="text"
              placeholder="Enter recipient email or user ID"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              className={styles.popupInput}
            />
            <div className={styles.popupActions}>
              <button onClick={handleSend} className={styles.popupButton}>
                Send
              </button>
              <button
                onClick={() => setShowSendPopup(false)}
                className={styles.popupCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
