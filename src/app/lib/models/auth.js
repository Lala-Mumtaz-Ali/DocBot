import jwt from "jsonwebtoken";
import User from "@/app/lib/models/signupmodel";
import { connectDB } from "./db";

const SECRET_KEY = process.env.JWT_SECRET || "your_secret_here";

/**
 * Get user from JWT token in Authorization header
 */
export async function getUser(req = null) {
  try {
    await connectDB();

    let token;

    // If req is passed (server-side)
    if (req && req.headers?.authorization) {
      token = req.headers.authorization.split(" ")[1];
    } 
    // Otherwise, check client-side localStorage (fallback)
    else if (typeof window !== "undefined") {
      token = localStorage.getItem("token");
    }

    if (!token) return null;

    const decoded = jwt.verify(token, SECRET_KEY);

    // Fetch user from DB
    const user = await User.findById(decoded.userId).select("-password");
    return user;
  } catch (err) {
    console.error("Auth Error:", err.message);
    return null;
  }
}
