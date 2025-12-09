// import mongoose from "mongoose";

// // ✅ Environment variable for MongoDB URI
// export const connectionStr = process.env.MONGODB_URI;

// if (!connectionStr) {
//   throw new Error("❌ Missing MONGODB_URI in environment variables");
// }

// // ✅ Cache to reuse MongoDB connection (prevents multiple connections in Next.js)
// let cached = global.mongoose;

// if (!cached) {
//   cached = global.mongoose = { conn: null, promise: null };
// }

// // ✅ Connection function (named + default export for flexibility)
// export async function connectDB() {
//   if (cached.conn) return cached.conn;

//   if (!cached.promise) {
//     cached.promise = mongoose
//       .connect(connectionStr, {
//         dbName: "DocBot",
//         useNewUrlParser: true,
//         useUnifiedTopology: true,
//       })
//       .then((mongoose) => {
//         console.log("✅ MongoDB Connected Successfully");
//         return mongoose;
//       })
//       .catch((err) => {
//         console.error("❌ MongoDB Connection Error:", err.message);
//         throw err;
//       });
//   }

//   cached.conn = await cached.promise;
//   return cached.conn;
// }

// // ✅ Default export for compatibility
// export default connectDB;
import mongoose from "mongoose";

export const connectionStr = process.env.MONGODB_URI;

if (!connectionStr) {
  throw new Error("❌ Missing MONGODB_URI in environment variables");
}

// ✅ Cache the connection in Next.js environment
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(connectionStr, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      })
      .then((mongoose) => {
        console.log("✅ MongoDB Connected Successfully to:", mongoose.connection.name);
        return mongoose;
      })
      .catch((err) => {
        console.error("❌ MongoDB Connection Error:", err.message);
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export default connectDB;
