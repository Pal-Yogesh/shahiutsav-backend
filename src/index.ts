import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config/index.js";

import authRoutes from "./routes/auth.routes.js";
import vendorRoutes from "./routes/vendor.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import cityRoutes from "./routes/city.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import vendorApplicationRoutes from "./routes/vendor-application.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { errorHandler } from "./helpers/http-error.js";

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));

// Better Auth reads the raw request body itself, so mount it before express.json()
app.use("/api/auth", authRoutes);
app.use(express.json({ limit: "200kb" }));

// ─── Routes ──────────────────────────────────────────────────────────
app.use("/api/vendors", vendorRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cities", cityRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/vendor-application", vendorApplicationRoutes);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Unknown API routes, then the shared error handler (must be last)
app.use("/api", (_req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[${config.appName}] Backend running on http://localhost:${config.port}`);
});

export default app;
