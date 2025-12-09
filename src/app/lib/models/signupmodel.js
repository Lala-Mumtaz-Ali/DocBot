// // import mongoose from "mongoose";
// // import bcrypt from "bcryptjs";
// // import validator from "validator";

// // const signupSchema = new mongoose.Schema(
// //   {
// //     name: {
// //       type: String,
// //       required: [true, "Name is required"],
// //       trim: true,
// //       minlength: [3, "Username must be at least 3 characters long"],
// //       maxlength: [50, "Username must be less than 50 characters"],
// //       validate: {
// //         validator: function (v) {
// //           return /^[a-zA-Z\s]+$/.test(v); // Only letters and spaces
// //         },
// //         message: "Name should contain only alphabets and spaces.",
// //       },
// //     },

// //     email: {
// //       type: String,
// //       required: [true, "Email is required"],
// //       unique: true,
// //       trim: true,
// //       lowercase: true,
// //       validate: [validator.isEmail, "Please provide a valid email address"],
// //     },

// //     address: {
// //       type: String,
// //       required: [true, "Address is required"],
// //       trim: true,
// //       minlength: [5, "Address must be at least 5 characters"],
// //     },

// //     city: {
// //       type: String,
// //       required: [true, "City is required"],
// //       trim: true,
// //     },

// //     role: {
// //       type: String,
// //       required: [true, "Role is required"],
// //       enum: {
// //         values: ["hospital", "doctor", "patient"],
// //         message: "Role must be either hospital, doctor, or patient",
// //       },
// //     },

// //     password: {
// //       type: String,
// //       required: [true, "Password is required"],
// //       minlength: [8, "Password must be at least 8 characters long"],
// //       select: false, // hide from query results
// //     },

// //     createdAt: {
// //       type: Date,
// //       default: Date.now,
// //     },

// //     updatedAt: {
// //       type: Date,
// //       default: Date.now,
// //     },
// //   },
// //   {
// //     timestamps: true,
// //   }
// // );

// // /**
// //  * 🧠 Pre-save middleware: Hash password before saving
// //  */
// // signupSchema.pre("save", async function (next) {
// //   // Only hash if the password is new or modified
// //   if (!this.isModified("password")) return next();

// //   // Hash password with bcrypt (12 rounds = strong security)
// //   const salt = await bcrypt.genSalt(12);
// //   this.password = await bcrypt.hash(this.password, salt);

// //   next();
// // });

// // /**
// //  * 🧩 Method: Compare entered password with hashed password
// //  */
// // signupSchema.methods.comparePassword = async function (enteredPassword) {
// //   return await bcrypt.compare(enteredPassword, this.password);
// // };

// // /**
// //  * 🧱 Indexes for faster queries and uniqueness enforcement
// //  */
// // signupSchema.index({ email: 1 }, { unique: true });

// // /**
// //  * 🧼 Sanitize inputs to prevent injection or special chars
// //  */
// // signupSchema.pre("validate", function (next) {
// //   this.name = validator.escape(this.name);
// //   this.address = validator.escape(this.address);
// //   this.city = validator.escape(this.city);
// //   next();
// // });

// // export const signupmodel =
// //   mongoose.models.signup || mongoose.model("signup", signupSchema);
// import mongoose from "mongoose";
// import { NextResponse } from "next/server";
// import jwt from "jsonwebtoken";
// import { connectionStr } from "@/app/lib/db";
// import { signupmodel } from "@/app/lib/models/signupmodel";

// const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey"; // ⚠️ Use strong secret in .env.local

// // ✅ MongoDB connection helper
// async function connectDB() {
//   if (mongoose.connection.readyState === 0) {
//     await mongoose.connect(connectionStr);
//     if (process.env.NODE_ENV !== "production") {
//       console.log("✅ Connected to MongoDB");
//     }
//   }
// }

// export async function POST(request) {
//   try {
//     const payload = await request.json();
//     await connectDB();

//     // =========================
//     // 🧠 LOGIN FLOW
//     // =========================
//     if (payload.login) {
//       const user = await signupmodel
//         .findOne({ email: payload.email })
//         .select("+password");

//       if (!user) {
//         return NextResponse.json(
//           { success: false, message: "User not found" },
//           { status: 404 }
//         );
//       }

//       const isPasswordMatch = await user.comparePassword(payload.password);
//       if (!isPasswordMatch) {
//         return NextResponse.json(
//           { success: false, message: "Invalid password" },
//           { status: 401 }
//         );
//       }

//       // ✅ Generate JWT Token
//       const token = jwt.sign(
//         { id: user._id, email: user.email, role: user.role },
//         JWT_SECRET,
//         { expiresIn: "7d" }
//       );

//       const safeUser = user.toObject();
//       delete safeUser.password;

//       return NextResponse.json({
//         success: true,
//         message: "Login successful",
//         result: safeUser,
//         token,
//       });
//     }

//     // =========================
//     // 🧠 SIGNUP FLOW
//     // =========================
//     const { name, email, address, city, role, password } = payload;

//     if (!name || !email || !address || !city || !role || !password) {
//       return NextResponse.json(
//         { success: false, message: "All fields are required" },
//         { status: 400 }
//       );
//     }

//     const existingUser = await signupmodel.findOne({ email });
//     if (existingUser) {
//       return NextResponse.json(
//         { success: false, message: "Email already registered" },
//         { status: 409 }
//       );
//     }

//     // ✅ Let the model hash password automatically (pre-save hook)
//     const newUser = await signupmodel.create({
//       name,
//       email,
//       address,
//       city,
//       role,
//       password,
//     });

//     // ✅ Create JWT token for new user
//     const token = jwt.sign(
//       { id: newUser._id, email: newUser.email, role: newUser.role },
//       JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     const safeUser = newUser.toObject();
//     delete safeUser.password;

//     return NextResponse.json({
//       success: true,
//       message: "Account created successfully",
//       result: safeUser,
//       token,
//     });
//   } catch (error) {
//     console.error("❌ Signup/Login API Error:", error);
//     return NextResponse.json(
//       { success: false, message: error.message || "Internal Server Error" },
//       { status: 500 }
//     );
//   }
// }

// // =========================
// // 🧾 GET /api/sign (Admin / Debug only)
// // =========================
// export async function GET() {
//   try {
//     await connectDB();
//     const users = await signupmodel.find({}, "-password"); // exclude password
//     return NextResponse.json({ success: true, result: users });
//   } catch (error) {
//     console.error("❌ GET /api/sign error:", error);
//     return NextResponse.json(
//       { success: false, message: "Failed to fetch users" },
//       { status: 500 }
//     );
//   }
// }
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import validator from "validator";

const signupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [3, "Name must be at least 3 characters"],
      maxlength: [50, "Name must be less than 50 characters"],
      validate: {
        validator: (v) => /^[a-zA-Z\s]+$/.test(v),
        message: "Name should contain only alphabets and spaces.",
      },
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      validate: [validator.isEmail, "Please provide a valid email address"],
    },

    contact: {
      type: String,
      required: [true, "Contact number is required"],
      validate: {
        validator: (v) => /^[0-9]{10,15}$/.test(v),
        message: "Contact number must be between 10–15 digits.",
      },
    },

    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      minlength: [5, "Address must be at least 5 characters"],
    },

    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
    },

    role: {
      type: String,
      required: [true, "Role is required"],
      enum: {
        values: ["hospital", "doctor", "patient"],
        message: "Role must be either hospital, doctor, or patient",
      },
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters long"],
      select: false, // hide in queries
    },
  },
  { timestamps: true }
);

// 🧠 Hash password before saving
signupSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 🔐 Compare passwords
signupSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export const signupmodel =
  mongoose.models.signup || mongoose.model("signup", signupSchema);
