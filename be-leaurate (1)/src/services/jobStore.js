import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// __dirname replacement for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, "../data/jobs.json");

// In-memory cache to prevent stale-read race conditions when multiple
// async operations (trigger flow, statusSync, inbox) read/modify/write
// the same file concurrently within the same Node process.
let _jobsCache = null;

/**
 * Read jobs from file (uses in-memory cache after first load)
 */
const readJobs = () => {
  if (_jobsCache) return _jobsCache;
  const data = fs.readFileSync(filePath, "utf-8");
  _jobsCache = JSON.parse(data || "[]");
  return _jobsCache;
};

/**
 * Write jobs to file (and update in-memory cache)
 */
const writeJobs = (jobs) => {
  _jobsCache = jobs;
  fs.writeFileSync(filePath, JSON.stringify(jobs, null, 2));
};

/**
 * Invalidate in-memory cache (used after external file reset)
 */
export const invalidateJobsCache = () => {
  _jobsCache = null;
};

/**
 * CREATE job
 */
export const createJob = (data) => {
  const jobs = readJobs();

  jobs.push({...data});

  writeJobs(jobs);
  return data;
};

/**
 * READ all jobs
 */
export const getAllJobs = () => {
  return readJobs();
};

/**
 * READ job by ID
 */
export const getJobById = (jobId) => {
  const jobs = readJobs();
  return jobs.find((job) => job.jobId === jobId) || null;
};

/**
 * UPDATE job status
 */
export const updateJobStatus = (jobId, status) => {
  const jobs = readJobs();
  const job = jobs.find((job) => job.jobId === jobId);

  if (!job) {
    throw new Error(`Job with jobId ${jobId} not found`);
  }

  job.status = status;
  writeJobs(jobs);

  return job;
};

export const updateJobResult = (jobId, result) => {
  const jobs = readJobs();
  let job = jobs.findIndex((job) => job.jobId === jobId);

  if (job === -1) {
    // Upsert: create the entry if it doesn't exist (guards against race conditions)
    const newJob = { jobId, ...result };
    jobs.push(newJob);
    writeJobs(jobs);
    return newJob;
  }

  // Preserve request_type from the original record; it should only change via Excel re-import.
  const existing = jobs[job];
  const merged = { ...existing, ...result };
  if (existing.request_type !== undefined) {
    merged.request_type = existing.request_type;
  }
  jobs[job] = merged;
  writeJobs(jobs);

  return jobs[job];
};

export const updateSecondaryJobByPrimaryJobId = (jobId, result) => {
  const jobs = readJobs();
  let job = jobs.findIndex((job) => job.jobId === jobId);

  if (job === -1) {
    return null;
  }

  jobs[job] = {...jobs[job], ...result};
  writeJobs(jobs);

  return jobs[job];
};

export const updateSecondaryJob = (jobId, result) => {
  const jobs = readJobs();
  let job = jobs.findIndex((job) => job.secondaryJobId === jobId);

  if (job === -1) {
    return null;
  }

  jobs[job] = {...jobs[job], ...result};
  writeJobs(jobs);

  return jobs[job];
};

/**
 * DELETE job
 */
export const deleteJob = (jobId) => {
  const jobs = readJobs();
  const index = jobs.findIndex((job) => job.jobId === jobId);

  if (index === -1) {
    throw new Error(`Job with jobId ${jobId} not found`);
  }

  const deleted = jobs.splice(index, 1)[0];
  writeJobs(jobs);

  return deleted;
};

/**
 * READ job by Group ID
 */
export const getJobsByGroupId = (groupId) => {
  const jobs = readJobs();
  return jobs.filter((job) => String(job.groupId) === String(groupId));
};
