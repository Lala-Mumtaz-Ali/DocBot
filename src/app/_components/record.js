"use client";

import React, { useState, useEffect } from "react";
import styles from "../style/Record.module.css";

import {
  FaCloudUploadAlt,
  FaList,
  FaTrash,
  FaShare,
  FaDownload,
  FaEye,
} from "react-icons/fa";

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
  const [toast, setToast] = useState({ message: "", type: "", visible: false });

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const showToast = (message, type = "success") => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast({ message: "", type: "", visible: false }), 3000);
  };

  /* ---------------- Fetch Records ---------------- */

  const fetchRecords = async () => {
    try {
      const res = await fetch("/api/records", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (res.ok && data.records) {
        setRecords(data.records);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (token) fetchRecords();
  }, []);

  useEffect(() => {
    if (activeTab === "view" && token) fetchRecords();

    setPreviewId(null);
    setFullScreenId(null);
    setZoom(1);
  }, [activeTab]);

  /* ---------------- Upload ---------------- */

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (!selected) return;
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file) {
      showToast("Choose file first", "error");
      return;
    }

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
        showToast("Record uploaded successfully");
        setFile(null);
        fetchRecords();
      } else {
        showToast(data.message || "Upload failed", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Upload failed", "error");
    }

    setLoading(false);
  };

  /* ---------------- Delete ---------------- */

  const handleDelete = async (id) => {
    if (!confirm("Delete this record permanently?")) return;

    const previous = [...records];
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

      if (!res.ok) {
        setRecords(previous);
        showToast("Failed to delete record", "error");
      } else {
        showToast("Record deleted successfully");
      }
    } catch (err) {
      setRecords(previous);
      showToast("Delete error", "error");
    }
  };

  /* ---------------- Fetch File ---------------- */

  const fetchFileBlob = async (recordId) => {
    try {
      const res = await fetch(`/api/records/${recordId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      showToast("File loading error", "error");
      return null;
    }
  };

  /* ---------------- Preview ---------------- */

  const handlePreview = async (rec) => {

    if (previewId === rec._id) {
      setPreviewId(null);
      return;
    }

    if (rec.tempUrl) {
      setPreviewId(rec._id);
      return;
    }

    setLoading(true);

    const blobUrl = await fetchFileBlob(rec._id);

    if (blobUrl) {
      setRecords((prev) =>
        prev.map((r) =>
          r._id === rec._id ? { ...r, tempUrl: blobUrl } : r
        )
      );

      setPreviewId(rec._id);
    }

    setLoading(false);
  };

  /* ---------------- Download ---------------- */

  const handleDownload = async (rec) => {

    let url = rec.tempUrl;

    if (!url) {
      url = await fetchFileBlob(rec._id);
    }

    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = rec.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  /* ---------------- Send ---------------- */

  const handleSend = async () => {

    if (!sendTo || !selectedFileId) {
      showToast("Enter recipient email", "error");
      return;
    }

    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          senderEmail: JSON.parse(localStorage.getItem("user")).email,
          receiverEmail: sendTo,
          record: selectedFileId,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        showToast("Record sent successfully");
        setShowSendPopup(false);
        setSendTo("");
      } else {
        showToast(data.message || "Send failed", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Server error", "error");
    }
  };

  /* ---------------- Zoom ---------------- */

  const zoomIn = () => setZoom((z) => Math.min(z + 0.2, 3));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.5));
  const closeFullScreen = () => setFullScreenId(null);

  /* ---------------- UI ---------------- */

  return (
    <div className={styles.container}>

      <h2 className={styles.pageTitle}>📁 Record Management</h2>

      {/* Tabs */}

      <div className={styles.tabContainer}>

        <button
          className={`${styles.tabButton} ${activeTab === "view" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("view")}
        >
          <FaList /> View Records
        </button>

        <button
          className={`${styles.tabButton} ${activeTab === "add" ? styles.activeTab : ""}`}
          onClick={() => setActiveTab("add")}
        >
          <FaCloudUploadAlt /> Add Record
        </button>

      </div>

      {/* Upload */}

      {activeTab === "add" && (

        <div className={styles.uploadSection}>

          <label className={styles.fileWrapper}>
            <input
              type="file"
              onChange={handleFileChange}
              className={styles.hiddenFileInput}
            />
            <div className={styles.inputFile}>
              {file ? (
                <>📄 <strong>{file.name}</strong></>
              ) : (
                "Click to upload or drag & drop file"
              )}
            </div>
          </label>

          <div className={styles.buttonGroup}>

            <button
              onClick={handleUpload}
              disabled={loading}
              className={`${styles.actionButton} ${styles.uploadButton}`}
            >
              {loading ? "Uploading..." : "Upload"}
            </button>

            <button
              onClick={() => setActiveTab("view")}
              className={`${styles.actionButton} ${styles.cancelButton}`}
            >
              Cancel
            </button>

          </div>

        </div>
      )}

      {/* Records */}

      {activeTab === "view" && (

        <div className={styles.recordsList}>

          {records.length === 0 ? (

            <p className={styles.emptyText}>No records found</p>

          ) : (

            records.map((rec) => (

              <div key={rec._id} className={styles.recordContainer}>

                <p className={styles.recordText}>{rec.fileName}</p>

                {/* Preview */}

                {previewId === rec._id && rec.tempUrl && (

                  <div className={styles.previewBox}>

                    {rec.fileType === "pdf" ? (

                      <iframe
                        src={rec.tempUrl}
                        className={styles.previewMedia}
                      />

                    ) : (

                      <img
                        src={rec.tempUrl}
                        alt="preview"
                        className={styles.previewMedia}
                      />

                    )}

                  </div>

                )}

                {/* Buttons */}

                <div className={styles.recordButtons}>

                  <button
                    onClick={() => handlePreview(rec)}
                    className={`${styles.actionButton} ${styles.downloadButton}`}
                  >
                    <FaEye /> Preview
                  </button>

                  <button
                    onClick={() => handleDownload(rec)}
                    className={`${styles.actionButton} ${styles.downloadButton}`}
                  >
                    <FaDownload /> Download
                  </button>

                  <button
                    onClick={() => handleDelete(rec._id)}
                    className={`${styles.actionButton} ${styles.deleteButton}`}
                  >
                    <FaTrash /> Delete
                  </button>

                  <button
                    onClick={() => {
                      setSelectedFileId(rec._id);
                      setShowSendPopup(true);
                    }}
                    className={`${styles.actionButton} ${styles.sendButton}`}
                  >
                    <FaShare /> Send
                  </button>

                </div>

              </div>

            ))
          )}

        </div>
      )}

      {/* Send Popup */}

      {showSendPopup && (

        <div className={styles.popupOverlay}>

          <div className={styles.popupBox}>

            <h3>Send Record</h3>

            <input
              type="text"
              placeholder="Enter email"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              className={styles.popupInput}
            />

            <div className={styles.popupActions}>

              <button
                onClick={handleSend}
                className={styles.popupButton}
              >
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

      {/* Toast */}

      {toast.visible && (
        <>
          <div className={styles.toastOverlay} />
          <div
            className={`${styles.toast} ${
              toast.type === "error" ? styles.toastError : styles.toastSuccess
            }`}
          >
            {toast.message}
          </div>
        </>
      )}

    </div>
  );
}
