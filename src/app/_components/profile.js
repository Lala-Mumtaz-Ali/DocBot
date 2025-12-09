"use client";

import { useEffect, useState } from "react";
import styles from "../style/profile.module.css";
import {
  FaUserCircle,
  FaEnvelope,
  FaPhoneAlt,
  FaMapMarkerAlt,
  FaEdit,
} from "react-icons/fa";

const Profile = () => {
  const [userdata, setUserdata] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        setUserdata(parsedUser);
      } else {
        setError("No user data found. Please log in again.");
      }
    } catch (err) {
      console.error("Error reading user data:", err);
      setError("Corrupted or invalid user data. Please log in again.");
    }
  }, []); // ✅ prevents infinite loop

  if (error) {
    return (
      <div className={styles.profileContainer}>
        <div className={styles.profileCard}>
          <FaUserCircle className={styles.defaultAvatar} />
          <h2 style={{ color: "red", marginTop: "1rem" }}>⚠️ Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!userdata) {
    return (
      <div className={styles.profileContainer}>
        <div className={styles.profileCard}>
          <FaUserCircle className={styles.defaultAvatar} />
          <p>Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.profileContainer}>
      <div className={styles.profileCard}>
        {/* Avatar */}
        <div className={styles.avatarSection}>
          {userdata.avatar ? (
            <img
              src={userdata.avatar}
              alt="User Avatar"
              className={styles.avatar}
            />
          ) : (
            <FaUserCircle className={styles.defaultAvatar} />
          )}
          <h2 className={styles.userName}>{userdata.name}</h2>
          <p className={styles.userRole}>{userdata.role}</p>
        </div>

        {/* Info Section */}
        <div className={styles.infoSection}>
          <div className={styles.infoItem}>
            <FaEnvelope className={styles.icon} />
            <span>{userdata.email}</span>
          </div>
          <div className={styles.infoItem}>
            <FaPhoneAlt className={styles.icon} />
            <span>{userdata.contact || "Not provided"}</span>
          </div>
          <div className={styles.infoItem}>
            <FaMapMarkerAlt className={styles.icon} />
            <span>{userdata.address}</span>
          </div>
          <div className={styles.infoItem}>
            <FaEdit className={styles.icon} />
            <span>Joined {userdata.createdAt || "recently"}</span>
          </div>
        </div>

        {/* Edit button */}
        <button className={styles.editButton}>
          <FaEdit /> Edit Profile
        </button>
      </div>
    </div>
  );
};

export default Profile;
