import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import axios from "axios";
import userRoutes from "./routes/userRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import uiCompatRoutes from "./routes/uiCompatRoutes.js";
import cors from "cors"
import { syncStatus } from "./jobs/statusSync.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const documentsDir = path.join(__dirname, "data", "documents");

if (!fs.existsSync(documentsDir)) {
    fs.mkdirSync(documentsDir, { recursive: true });
}

const app = express();

// Enable CORS for all origins (must be before other middleware)
app.use(cors());
app.use(express.json());
app.use("/documents", express.static(documentsDir));

setInterval(async () => {
    try {
        await syncStatus()
    } catch (err) {
        console.error("Status sync failed:", err.message)
    }
}, 30000)

app.use("/api/users", userRoutes);
app.use("/jobs", jobRoutes);

// Proxy rename requests to the rename microservice
app.post("/rename/student", async (req, res) => {
    try {
        const response = await axios.post("http://127.0.0.1:8001/rename/student", req.body);
        res.status(response.status).json(response.data);
    } catch (err) {
        const status = err.response?.status || 500;
        const data = err.response?.data || { detail: err.message };
        res.status(status).json(data);
    }
});

app.use("/", uiCompatRoutes);

export default app;
