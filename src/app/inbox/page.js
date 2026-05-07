"use client";

import React, { useEffect, useState } from "react";
import styles from "../style/Inbox.module.css";
import { FaEye, FaDownload, FaTrash } from "react-icons/fa";
import Navbar from "../_components/navbar";
import Footer from "../_components/aboutus";
import { useRouter } from "next/navigation";
import { set } from "mongoose";

export default function InboxPage() {
const [isMounted, setIsMounted] = useState(false);  // ✅ Add mounted check to fix "NextRouter was not mounted"
  const router = useRouter();
  const [records, setRecords] = useState([]);
  const [previewId, setPreviewId] = useState(null);
  const [loading, setLoading] = useState(false);
useEffect(() => {
  setIsMounted(true);
}, []);

  const user =
    typeof window !== "undefined"
      ? JSON.parse(localStorage.getItem("user"))
      : null;

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("token")
      : null;

      useEffect(() => {
    if(!token){
      router.push('/');  // Redirect to login (or /login) if no token
    }
  }, [isMounted, router, token]);
  /* ---------------- Fetch Inbox ---------------- */

  const fetchInbox = async () => {

    if (!user?.email) { console.log("User email not found"); return; };

    try {

      const res = await fetch(`/api/inbox?receiverEmail=${user.email}`);

      const data = await res.json();

      if (res.ok) setRecords(data.data || []);

    } catch (err) {

      console.error(err);

    }

  };

  useEffect(() => {
    fetchInbox();
  }, []);

  

  /* ---------------- Fetch File Blob ---------------- */

  const fetchFileBlob = async (recordId) => {

    try {

      const res = await fetch(`/api/records/${recordId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const blob = await res.blob();

      return URL.createObjectURL(blob);

    } catch {

      alert("File loading error");
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

    const blobUrl = await fetchFileBlob(rec.record._id);

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

      url = await fetchFileBlob(rec.record._id);

    }

    if (url) {

      const a = document.createElement("a");
      a.href = url;
      a.download = rec.record.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

    }

  };

  /* ---------------- Delete ---------------- */

  const remove = async (id) => {

    if (!confirm("Remove from inbox?")) return;

    try {

      const res = await fetch("/api/inbox", {

        method: "DELETE",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ inboxId: id }),

      });

      if (res.ok) {

        setRecords((prev) => prev.filter((x) => x._id !== id));

      }

    } catch (err) {

      console.error(err);

    }

  };

  /* ---------------- UI ---------------- */

  return (

    <>
      <Navbar />

      <div className={styles.container}>

        <h2 className={styles.title}>📥 Inbox</h2>

        {records.length === 0 && (
          <p className={styles.empty}>No records received</p>
        )}

        {records.map((rec) => {

          const fileName = rec.record?.fileName || "Untitled";
          const fileType = rec.record?.fileType || "pdf";

          return (

            <div key={rec._id} className={styles.card}>

              <div>

                <p className={styles.file}>{fileName}</p>

                <span className={styles.sender}>
                  From: {rec.senderEmail}
                </span>

              </div>

              {/* Preview */}

              {previewId === rec._id && rec.tempUrl && (

                <div className={styles.previewWrapper}>

                  {fileType === "pdf" ? (

                    <iframe
                      src={rec.tempUrl}
                      className={styles.preview}
                    />

                  ) : (

                    <img
                      src={rec.tempUrl}
                      alt="preview"
                      className={styles.preview}
                    />

                  )}

                </div>

              )}

              {/* Buttons */}

              <div className={styles.actions}>

                <button onClick={() => handlePreview(rec)}>
                  <FaEye />
                </button>

                <button onClick={() => handleDownload(rec)}>
                  <FaDownload />
                </button>

                <button onClick={() => remove(rec._id)}>
                  <FaTrash />
                </button>

              </div>

            </div>

          );

        })}

      </div>

      <Footer />
    </>
  );
}