// import mongoose from "mongoose";
// import bcrypt from "bcryptjs";
// import validator from "validator";

// const signupSchema = new mongoose.Schema(
//   {
//     name: {
//       type: String,
//       required: [true, "Name is required"],
//       trim: true,
//       minlength: [3, "Name must be at least 3 characters"],
//       maxlength: [50, "Name must be less than 50 characters"],
//       validate: {
//         validator: (v) => /^[a-zA-Z\s]+$/.test(v),
//         message: "Name should contain only alphabets and spaces.",
//       },
//     },

//     email: {
//       type: String,
//       required: [true, "Email is required"],
//       unique: true,
//       trim: true,
//       lowercase: true,
//       validate: [validator.isEmail, "Please provide a valid email address"],
//     },

//     contact: {
//       type: String,
//       required: [true, "Contact number is required"],
//       validate: {
//         validator: (v) => /^[0-9]{10,15}$/.test(v),
//         message: "Contact number must be between 10–15 digits.",
//       },
//     },

//     address: {
//       type: String,
//       required: [true, "Address is required"],
//       trim: true,
//       minlength: [5, "Address must be at least 5 characters"],
//     },

//     city: {
//       type: String,
//       required: [true, "City is required"],
//       trim: true,
//     },

//     role: {
//       type: String,
//       required: [true, "Role is required"],
//       enum: {
//         values: ["hospital", "doctor", "patient"],
//         message: "Role must be either hospital, doctor, or patient",
//       },
//     },

//     password: {
//       type: String,
//       required: [true, "Password is required"],
//       minlength: [8, "Password must be at least 8 characters long"],
//       select: false, // hide in queries
//     },
//   },
//   { timestamps: true }
// );

// // 🧠 Hash password before saving
// signupSchema.pre("save", async function (next) {
//   if (!this.isModified("password")) return next();
//   const salt = await bcrypt.genSalt(12);
//   this.password = await bcrypt.hash(this.password, salt);
//   next();
// });

// // 🔐 Compare passwords
// signupSchema.methods.comparePassword = async function (enteredPassword) {
//   return await bcrypt.compare(enteredPassword, this.password);
// };

// export const signupmodel =
//   mongoose.models.signup || mongoose.model("signup", signupSchema);
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
      maxlength: [254, "Email must not exceed 254 characters"], // ✅ added
      validate: [validator.isEmail, "Please provide a valid email address"],
    },

    contact: {
      type: String,
      required: [true, "Contact number is required"],
      validate: {
        validator: (v) => /^03\d{9}$/.test(v), // ✅ Pakistani format
        message: "Contact must be a valid Pakistani number (03XXXXXXXXX)",
      },
    },

    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      minlength: [5, "Address must be at least 5 characters"],
      maxlength: [200, "Address too long"], // ✅ added
    },

    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
      validate: {
        validator: (v) => /^[A-Za-z\s]{2,}$/.test(v), // ✅ added
        message: "City must contain only letters",
      },
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
      validate: {
        validator: function (v) {
          return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(v);
        },
        message:
          "Password must include uppercase, lowercase, number & special character",
      },
      select: false,
    },

    // 🔐 NEW: Email verification fields
    isVerified: {
      type: Boolean,
      default: false,
    },

    verifyToken: String,

    verifyTokenExpiry: Date,
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