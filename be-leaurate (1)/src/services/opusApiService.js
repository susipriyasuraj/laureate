import axios from "axios";
import { logInfo, logError } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

const baseURL = process.env.OPUS_BASE_URL;
const apiKey = process.env.OPUS_API_KEY;
const DEFAULT_WORKFLOW_ID = process.env.WORKFLOW_ID_PRIMARY;

const opusClient = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    "x-service-key": apiKey,
    "Content-Type": "application/json",
  },
});

const withRetry = async (fn, retries = 2, delay = 1000) => {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      logInfo(`Retrying request (attempt ${i + 2})`, { error: err.message });
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
};

const schemaCache = new Map();
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getWorkflowSchema = async (
  workflowId = DEFAULT_WORKFLOW_ID
) => {
  const cached = schemaCache.get(workflowId);
  if (cached && Date.now() - cached.timestamp < SCHEMA_CACHE_TTL) {
    logInfo("Returning cached workflow schema", { workflowId });
    return cached.data;
  }

  try {
    logInfo("Fetching workflow schema from Opus", { workflowId });

    const res = await withRetry(() => opusClient.get(`/workflow/${workflowId}`), 3, 2000);
    schemaCache.set(workflowId, { data: res.data, timestamp: Date.now() });
    return res.data;
  } catch (error) {
    // If fetch fails but we have a stale cache, use it
    if (cached) {
      logInfo("Using stale cached workflow schema after fetch failure", { workflowId });
      return cached.data;
    }
    logError("Failed to fetch workflow schema", {
      workflowId,
      error: error.response?.data || error.message,
    });
    throw new Error("Unable to retrieve workflow schema from Opus");
  }
};

export const initiateJob = async (
  workflowId = DEFAULT_WORKFLOW_ID,
  title,
  description
) => {
  try {
    logInfo("Initiating Opus job execution", { workflowId });

    const res = await opusClient.post(`/job/initiate`, {
      workflowId,
      title,
      description
    });

    return res.data;
  } catch (error) {
    logError("Failed to initiate job", {
      workflowId,
      error: error.response?.data || error.message,
    });
    throw new Error("Job initiation failed");
  }
};

export const executeJob = async (
  jobExecutionId,
  jobPayloadSchemaInstance
) => {
  try {
    logInfo("Executing Opus job", { jobExecutionId });

    const res = await opusClient.post(`/job/execute`, {
      jobExecutionId,
      jobPayloadSchemaInstance,
      // callbackUrl: "https://your-webhook-url.com/opus",
    });

    return res.data;
  } catch (error) {
    logError("Failed to execute job", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Job execution failed");
  }
};

export const getJobStatus = async (jobExecutionId) => {
  try {
    const res = await opusClient.get(
      `/job/${jobExecutionId}/status`
    );
    return res.data;
  } catch (error) {
    logError("Failed to get job status", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Status check failed");
  }
};

export const getJobResult = async (jobExecutionId) => {
  try {
    const res = await opusClient.get(
      `/job/${jobExecutionId}/results`
    );
    return res.data;
  } catch (error) {
    logError("Failed to get job results", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Result retrieval failed");
  }
};

export const getJobAudit = async (jobExecutionId) => {
  try {
    const res = await opusClient.get(
      `/job/${jobExecutionId}/audit`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );
    return res.data;
  } catch (error) {
    logError("Failed to get job audit", {
      jobExecutionId,
      error: error.response?.data || error.message,
    });
    throw new Error("Audit retrieval failed");
  }
};

export const getPresignedUrl = async (fileExtension = "pdf") => {
  try {
    const res = await opusClient.post(
      `/job/file/upload`,
      {
        fileExtension,
        accessScope: "all"
      }
    );
    return res.data;
  } catch (error) {
    logError("Failed to get presigned url", {
      error: error.response?.data || error.message,
    });
    throw new Error("Status check failed");
  }
};

