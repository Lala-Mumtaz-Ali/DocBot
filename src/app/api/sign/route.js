import mongoose from "mongoose";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { connectionStr } from "@/app/lib/db";
import { signupmodel } from "@/app/lib/models/signupmodel";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(connectionStr);
    if (process.env.NODE_ENV !== "production") {
      console.log("✅ Connected to MongoDB");
    }
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    await connectDB();

    // =========================
    // 🔐 LOGIN FLOW
    // =========================
    if (payload.login) {
      const user = await signupmodel
        .findOne({ email: payload.email })
        .select("+password");

      if (!user) {
        return NextResponse.json(
          { success: false, message: "User not found" },
          { status: 404 }
        );
      }

      const isMatch = await user.comparePassword(payload.password);
      if (!isMatch) {
        return NextResponse.json(
          { success: false, message: "Invalid password" },
          { status: 401 }
        );
      }

      const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      const safeUser = user.toObject();
      delete safeUser.password;

      return NextResponse.json({
        success: true,
        message: "Login successful",
        result: safeUser,
        token,
      });
    }

    // =========================
    // 🧠 SIGNUP FLOW
    // =========================
    const { name, email, address, city, role, contact, password } = payload;

    if (!name || !email || !address || !city || !role || !contact || !password) {
      return NextResponse.json(
        { success: false, message: "All fields are required" },
        { status: 400 }
      );
    }

    const existingUser = await signupmodel.findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: "Email already registered" },
        { status: 409 }
      );
    }

    const newUser = await signupmodel.create({
      name,
      email,
      address,
      city,
      role,
      contact,
      password,
    });

    const token = jwt.sign(
      { id: newUser._id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const safeUser = newUser.toObject();
    delete safeUser.password;

    return NextResponse.json({
      success: true,
      message: "Account created successfully",
      result: safeUser,
      token,
    });
  } catch (error) {
    console.error("❌ Signup/Login API Error:", error);

    // 🧠 Handle Mongo duplicate email error
    if (error.code === 11000 && error.keyPattern?.email) {
      return NextResponse.json(
        { success: false, message: "Email already registered" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, message: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await connectDB();
    const users = await signupmodel.find({}, "-password");
    return NextResponse.json({ success: true, result: users });
  } catch (error) {
    console.error("❌ GET /api/sign error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
