import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import XLSX from "xlsx";
import { fileURLToPath } from "node:url";
import {
  createJob,
  getAllJobs,
  updateJobResult,
} from "../services/jobStore.js";
import {
  executeJob,
  getPresignedUrl,
  getJobAudit,
  getJobResult,
  getJobStatus,
  getWorkflowSchema,
  initiateJob,
} from "../services/opusApiService.js";

const WORKFLOW_ID_PRIMARY = process.env.WORKFLOW_ID_PRIMARY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jobsFilePath = path.join(__dirname, "../data/jobs.json");
const excelFilePath = path.join(__dirname, "../data/Applicant_Case_Tracker.xlsx");
const activeScreeningByStudent = new Map();

const WORKFLOW_FILE_INPUT_ALIASES = [
  "crm_input_file",
  "fileUrl",
  "file_url",
  "input_file",
  "inputFile",
];

const WORKFLOW_STUDENT_ID_INPUT_ALIASES = [
  "studentId",
  "student_id",
  "student id",
  "studentID",
  "student_id_input",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getNormalized = (value) =>
  String(value || "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();

const getRowValue = (row, aliases = []) => {
  const normalizedMap = new Map();
  for (const [key, value] of Object.entries(row || {})) {
    normalizedMap.set(getNormalized(key), value);
  }

  for (const alias of aliases) {
    const normalizedAlias = getNormalized(alias);
    if (normalizedMap.has(normalizedAlias)) {
      return normalizedMap.get(normalizedAlias);
    }
  }

  return "";
};

const formatCandidateDocumentName = (candidateName = "") => {
  const normalized = String(candidateName || "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.toLowerCase() === "unknown applicant") {
    return "";
  }
  return normalized.toLowerCase().endsWith(".pdf")
    ? normalized
    : `${normalized}.pdf`;
};

const readApplicantRowsFromExcel = () => {
  if (!fs.existsSync(excelFilePath)) {
    return [];
  }

  const workbook = XLSX.readFile(excelFilePath);
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
};

const ensureSeedDataFromExcel = () => {
  const rows = readApplicantRowsFromExcel();
  if (rows.length === 0) {
    return;
  }

  const jobs = getAllJobs();
  const existingStudentIds = new Set(jobs.map((job) => String(job.studentId || "")));

  rows.forEach((row, index) => {
    const studentId = String(
      getRowValue(row, ["Student_ID", "Student ID", "studentId", "student_id"])
    ).trim();

    if (!studentId || existingStudentIds.has(studentId)) {
      return;
    }

    const applicantName = String(
      getRowValue(row, ["Applicant_Name", "Applicant Name", "Name"])
    ).trim();
    const requestType = String(
      getRowValue(row, ["Request_Type", "Request Type"])
    ).trim();
    const applicationStatus = String(
      getRowValue(row, ["Application_Status", "Application Status"])
    ).trim();
    const attachments = String(getRowValue(row, ["Attachments"]) || "").trim();
    const decision = String(getRowValue(row, ["Decision"]) || "").trim();
    const reason = String(getRowValue(row, ["Reason"]) || "").trim();
    const caseStatus = String(getRowValue(row, ["Case_Status", "Case Status"]) || "").trim();
    const email = String(getRowValue(row, ["Email"]) || "").trim();

    const candidateDocumentName = formatCandidateDocumentName(applicantName);

    createJob({
      // Negative IDs keep seeded records below real Opus execution IDs in sort order.
      jobId: String(-(Date.now() + index)),
      studentId,
      applicant_name: applicantName,
      request_type: requestType || "new",
      application_status: applicationStatus || "Under Review",
      attachments: candidateDocumentName || attachments || "Application file",
      decision,
      reason,
      case_status: caseStatus || "Open",
      email,
      fileName: path.basename(excelFilePath),
      localFilePath: excelFilePath,
      status: "NOT_STARTED",
      isSecondaryWorkflowExecuted: false,
      submittedAt: new Date().toLocaleString("en-GB"),
    });

    existingStudentIds.add(studentId);
  });
};

const extractWorkflowInputSchema = (workflowData) => {
  if (
    workflowData?.jobPayloadSchema &&
    typeof workflowData.jobPayloadSchema === "object"
  ) {
    return workflowData.jobPayloadSchema;
  }

  const inputNodeId = workflowData?.workflow_input_node_id;
  const inputNode = inputNodeId ? workflowData?.nodes?.[inputNodeId] : null;
  const schemaFromNode =
    inputNode?.output_schema?.schema || inputNode?.input_schema?.schema;

  if (schemaFromNode && typeof schemaFromNode === "object") {
    return schemaFromNode;
  }

  return null;
};

const getAliasedInputValue = (inputData = {}, aliases = []) => {
  for (const alias of aliases) {
    const value = inputData[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const isFileLikeWorkflowField = (key, field = {}) => {
  const allowedTypes = Array.isArray(field.allowed_types)
    ? field.allowed_types
    : [];
  const tags = Array.isArray(field.tags) ? field.tags : [];
  const displayName = String(field.display_name || "").toLowerCase();
  const variableName = String(field.variable_name || key || "").toLowerCase();

  const hasFileType = allowedTypes.some((item) => item?.type === "file");
  const hasAllowedFileTag = tags.some(
    (tag) => tag?.variable_name === "allowed_file_types"
  );
  const nameLooksLikeFileField =
    displayName.includes("file") ||
    displayName.includes("data") ||
    variableName.includes("file") ||
    variableName.includes("data");

  return hasFileType || hasAllowedFileTag || nameLooksLikeFileField;
};

const isStudentIdWorkflowField = (key, field = {}) => {
  const displayName = String(field.display_name || "").toLowerCase();
  const variableName = String(field.variable_name || key || "").toLowerCase();

  return (
    displayName.includes("student id") ||
    displayName === "studentid" ||
    variableName.includes("student_id") ||
    variableName.includes("studentid")
  );
};

const buildPayloadInstance = (schema, inputData = {}) => {
  const instance = {};
  const aliasedFileValue = getAliasedInputValue(
    inputData,
    WORKFLOW_FILE_INPUT_ALIASES
  );
  const aliasedStudentIdValue = getAliasedInputValue(
    inputData,
    WORKFLOW_STUDENT_ID_INPUT_ALIASES
  );

  for (const [key, field] of Object.entries(schema)) {
    const normalizedField = field && typeof field === "object" ? field : {};

    let value = inputData[key];
    if (
      value === undefined &&
      aliasedFileValue &&
      isFileLikeWorkflowField(key, normalizedField)
    ) {
      value = aliasedFileValue;
    }
    if (
      value === undefined &&
      aliasedStudentIdValue &&
      isStudentIdWorkflowField(key, normalizedField)
    ) {
      value = aliasedStudentIdValue;
    }
    if (value === undefined) {
      value = normalizedField.value ?? normalizedField.default ?? null;
    }

    instance[key] = { ...normalizedField, value };
  }

  return instance;
};

const toKeyedResult = (payload = {}) => {
  const schema = payload?.jobResultsPayloadSchema;
  if (!schema || typeof schema !== "object") {
    return {};
  }

  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    result[key] = value?.value;
  }
  return result;
};

const parseList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];

    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        return [raw];
      }
    }

    return raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [String(value)];
};

const isPassSignal = (value = "") => {
  const v = String(value).toLowerCase();
  return (
    v.includes("present") ||
    v.includes("verified") ||
    v.includes("selected") ||
    v.includes("above") ||
    v.includes("satisf") ||
    v.includes("eligible") ||
    v.includes("green") ||
    v.includes("pass")
  );
};

const toUiFlagValue = (value) => {
  const text = String(value || "Not available").trim();
  return `${text} ${isPassSignal(text) ? "✓" : "✗"}`;
};

/**
 * Determine color from a flag value: "Green" → "green", "Red" → "red", "Skipped"/other → "yellow"
 */
const resolveColor = (flagValue) => {
  if (!flagValue) return null;
  const v = String(flagValue).toLowerCase().trim();
  if (v === "green") return "green";
  if (v === "red") return "red";
  return "yellow"; // skipped or unknown
};

/**
 * Build a structured screening flag object with text (one-liner) and color.
 */
const toScreeningFlagObj = (resultText, flagColor) => {
  const text = resultText ? String(resultText).trim() : null;
  const color = resolveColor(flagColor);
  if (!text && !color) return { text: "Not available", color: null, status: "unavailable" };
  return {
    text: text || (color === "green" ? "Pass" : color === "red" ? "Fail" : "Skipped"),
    color: color || (text && isPassSignal(text) ? "green" : "red"),
    status: color || (text && isPassSignal(text) ? "green" : "red"),
  };
};

/**
 * Build a structured completeness flag object with the one-liner text.
 */
const toCompletenessFlagObj = (detailText, checkValue) => {
  // detailText = one-liner from workflow, checkValue = "Present"/"Missing" single-word
  const text = detailText ? String(detailText).trim() : null;
  const check = checkValue ? String(checkValue).toLowerCase().trim() : null;

  if (!text && !check) return { text: "Not available", color: null, status: "unavailable" };

  // Determine pass/fail from the check word or text content
  const pass = check
    ? (check.includes("present") || check.includes("green"))
    : (text && isPassSignal(text));

  return {
    text: text || (pass ? "Present" : "Missing"),
    color: pass ? "green" : "red",
    status: pass ? "green" : "red",
  };
};

const resolveCaseStatus = (job = {}) => {
  return (
    job.case_status ||
    job.workflow_output_k47bmhmub ||
    job.workflow_output_010zbd01n ||
    (job.status === "COMPLETED" ? "Closed" : "Open")
  );
};

const resolveDecision = (job = {}) => {
  return (
    job.decision ||
    job.application_status ||
    job.workflow_output_d8mdr6bal ||
    job.workflow_output_ojfjahh0s ||
    job.workflow_output_fg5kqpiq4 ||
    job.workflow_output_s5292luro ||
    job.workflow_output_gxbiv80u5 ||
    job.workflow_output_gay6rslpz ||
    job.workflow_output_p1e47k0wq ||
    job.workflow_output_i7abcyo03 ||
    "Pending Review"
  );
};

const resolveApplicantName = (job = {}) => {
  return job.workflow_output_dtnvounmw || job.applicant_name || "Unknown Applicant";
};

const resolveAttachmentLabel = (job = {}) => {
  const candidateDocumentName = formatCandidateDocumentName(resolveApplicantName(job));
  if (candidateDocumentName) {
    return candidateDocumentName;
  }

  const existingAttachment = String(job.attachments || "").trim();
  if (existingAttachment) {
    return existingAttachment;
  }

  return job.fileName || "Application file";
};

const sanitizeFileName = (value = "") =>
  path.basename(String(value || "").trim()).replace(/[\\/]+/g, "");

const resolveDocumentFileName = (attachmentName = "") => {
  const safeAttachmentName = sanitizeFileName(attachmentName);
  if (!safeAttachmentName) {
    return null;
  }

  const documentsDir = path.join(__dirname, "../data/documents");
  const directPath = path.join(documentsDir, safeAttachmentName);
  if (fs.existsSync(directPath)) {
    return safeAttachmentName;
  }

  if (!fs.existsSync(documentsDir)) {
    return null;
  }

  const targetLower = safeAttachmentName.toLowerCase();
  const files = fs.readdirSync(documentsDir).filter((name) => {
    const fullPath = path.join(documentsDir, name);
    return fs.statSync(fullPath).isFile();
  });

  const exactInsensitive = files.find(
    (name) => String(name).toLowerCase() === targetLower
  );
  if (exactInsensitive) {
    return exactInsensitive;
  }

  const endsWithMatch = files.find((name) =>
    String(name).toLowerCase().endsWith(targetLower)
  );
  if (endsWithMatch) {
    return endsWithMatch;
  }

  const baseToken = path.parse(targetLower).name;
  if (!baseToken) {
    return null;
  }

  const containsBaseName = files.find((name) =>
    String(name).toLowerCase().includes(baseToken)
  );
  return containsBaseName || null;
};

const resolveAttachmentUrl = (job = {}) => {
  const rawAttachments = String(job.attachments || "").trim();
  const firstAttachment = rawAttachments
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0];

  const candidateFileName = formatCandidateDocumentName(resolveApplicantName(job));
  const lookupCandidates = [firstAttachment, candidateFileName].filter(Boolean);

  for (const candidate of lookupCandidates) {
    const resolvedFileName = resolveDocumentFileName(candidate);
    if (resolvedFileName) {
      return `/documents/${encodeURIComponent(resolvedFileName)}`;
    }
  }

  // Fall back to the attachment name as URL even if not found on disk
  const fallback = lookupCandidates[0];
  return fallback ? `/documents/${encodeURIComponent(fallback)}` : null;
};

const resolveAllDocumentsForStudent = (job = {}) => {
  const applicantName = resolveApplicantName(job);
  const normalizedName = String(applicantName || "").trim().toLowerCase();
  const documentsDir = path.join(__dirname, "../data/documents");

  if (!normalizedName || normalizedName === "unknown applicant" || !fs.existsSync(documentsDir)) {
    // Fall back to single attachment_url if available
    const singleUrl = resolveAttachmentUrl(job);
    if (singleUrl) {
      const fileName = decodeURIComponent(singleUrl.split("/").pop());
      return [{ name: fileName, url: singleUrl }];
    }
    return [];
  }

  const files = fs.readdirSync(documentsDir).filter((name) => {
    const fullPath = path.join(documentsDir, name);
    return fs.statSync(fullPath).isFile() && name.toLowerCase() !== "readme.md";
  });

  // Find all files whose name contains the applicant's name (case-insensitive)
  const nameToken = normalizedName.replace(/\.pdf$/i, "");
  const matchingFiles = files.filter((file) =>
    file.toLowerCase().includes(nameToken)
  );

  if (matchingFiles.length > 0) {
    return matchingFiles.map((file) => ({
      name: file,
      url: `/documents/${encodeURIComponent(file)}`,
    }));
  }

  // Fall back to single resolved attachment
  const singleUrl = resolveAttachmentUrl(job);
  if (singleUrl) {
    const fileName = decodeURIComponent(singleUrl.split("/").pop());
    return [{ name: fileName, url: singleUrl }];
  }
  return [];
};

const toInboxCase = (job) => ({
  student_id: String(job.studentId || ""),
  applicant_name: resolveApplicantName(job),
  request_type: job.request_type || "New",
  case_status: resolveCaseStatus(job),
  application_status:
    job.status === "COMPLETED" || job.status === "IN PROGRESS"
      ? resolveDecision(job)
      : "Under Review",
  attachments: resolveAttachmentLabel(job),
  attachment_url: resolveAttachmentUrl(job),
});

const resolveScreeningStatus = (job = {}) => {
  if (job.status === "COMPLETED") return "Completed";
  if (job.status === "IN PROGRESS") return "In Progress";
  return "Not Started";
};

const toCaseInfo = (job) => ({
  student_id: String(job.studentId || ""),
  applicant_name: resolveApplicantName(job),
  request_type: job.request_type || "New",
  screening_status: resolveScreeningStatus(job),
  application_status:
    job.status === "COMPLETED" || job.status === "IN PROGRESS"
      ? resolveDecision(job)
      : "Under Review",
  attachments: resolveAttachmentLabel(job),
  attachment_url: resolveAttachmentUrl(job),
  attachment_urls: resolveAllDocumentsForStudent(job),
});

const formatExecutionTime = (startMs, endMs) => {
  if (!startMs || !endMs) return null;
  const totalSeconds = Math.round((endMs - startMs) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

const toScreeningResult = (job) => {
  const deficiencyList = parseList(
    job.workflow_output_4nsq04hnq || job.workflow_output_0zvjoraqj ||
    job.workflow_output_4mxgvc0db || job.workflow_output_qbme87hzy ||
    job.workflow_output_w2xij3alp
  );

  return {
    thread_id: String(job.jobId),
    execution_time: formatExecutionTime(job.screeningStartedAt, job.screeningCompletedAt),
    decision: resolveDecision(job),
    flagged_or_verified:
      job.workflow_output_xrxx2p2el || job.workflow_output_39yf6sxsk ||
      job.workflow_output_3snxpv1l4 || job.workflow_output_izvdziwj0 ||
      job.workflow_output_akfo7j55t || "Flagged",
    case_status: resolveCaseStatus(job),
    completeness_flags: {
      "ID and Personal Details": toCompletenessFlagObj(
        null,
        job.id_proof_check || job.workflow_output_s3t4r9a5d || job.workflow_output_4f6zv6ezv || job.workflow_output_9sd0a6s0c
      ),
      "Gradesheets and Certificates": toCompletenessFlagObj(
        null,
        job.grade_sheets_check || job.workflow_output_pook82hn8 || job.workflow_output_hqo6skenu
      ),
      "LOR Documents": toCompletenessFlagObj(
        null,
        job.lor_check || job.workflow_output_9eyscad0a || job.workflow_output_wppc352e4
      ),
      "Supplemental Documents": toCompletenessFlagObj(
        null,
        job.work_experience_check || job.workflow_output_r6ieynkdw || job.workflow_output_ohi0ujbcx
      ),
    },
    screening_flags: {
      "GPA Rule": toScreeningFlagObj(
        job.workflow_output_cd4rwg8jc || job.workflow_output_0grmdqhhh || job.workflow_output_19ta2ozzp || job.workflow_output_zoi9kbovp || job.workflow_output_023wrk0az,
        job.workflow_output_f5gjak4tz || job.workflow_output_86j1k78bn || job.gpa_screening
      ),
      "Work Experience Rule": toScreeningFlagObj(
        job.workflow_output_ga0k4n971 || job.workflow_output_ye44rvws7 || job.workflow_output_xxtwwawgq || job.workflow_output_z9kai3q6o,
        job.workflow_output_5zqm4lvlm || job.workflow_output_l0stk8r0x || job.work_exp_screening
      ),
      "LOR Institution Rule": toScreeningFlagObj(
        job.workflow_output_lw6wqc2qi || job.workflow_output_yk6si123w || job.workflow_output_5ixpqswvn || job.workflow_output_cvrqcxwzu,
        job.workflow_output_6tl5iyh7f || job.workflow_output_h9gink23g || job.lor_university_screening
      ),
      "LOR Recency Rule": toScreeningFlagObj(
        job.workflow_output_05bbe8fsy || job.workflow_output_fvnjvkgal || job.workflow_output_dammvoyz1 || job.workflow_output_pexqqlsbt,
        job.workflow_output_tmbkyiyod || job.workflow_output_8b8oevxrm || job.lor_date_screening
      ),
    },
    deficiency_list: deficiencyList,
    reason: deficiencyList.join("; ") || "No deficiencies.",
    available_actions: ["approve", "reject", "waitlist", "raise_insufficiency"],
  };
};

const toHumanDecisionResult = (decisionAction, existingJob = {}) => {
  const mapping = {
    approve: {
      decision: "Selected",
      application_status: "Selected",
      case_status: "Closed",
    },
    reject: {
      decision: "Deny",
      application_status: "Rejected",
      case_status: "Closed",
    },
    waitlist: {
      decision: "Waitlisted",
      application_status: "Waitlisted",
      case_status: "Open",
    },
    raise_insufficiency: {
      decision: "Incomplete Application",
      application_status: "Incomplete Application",
      case_status: "Open",
    },
  };

  return mapping[decisionAction] || {
    decision: resolveDecision(existingJob),
    application_status: resolveDecision(existingJob),
    case_status: resolveCaseStatus(existingJob),
  };
};

const findLatestJobByStudentId = (studentId) => {
  const jobs = getAllJobs();
  const matches = jobs
    .filter((job) => String(job.studentId) === String(studentId))
    .sort((a, b) => Number(b.jobId) - Number(a.jobId));

  return matches[0] || null;
};

const waitForJobCompletion = async (jobExecutionId) => {
  const maxAttempts = 120;
  const intervalMs = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const statusPayload = await getJobStatus(jobExecutionId);
    const status = statusPayload?.status;

    if (status === "COMPLETED") {
      const resultPayload = await getJobResult(jobExecutionId);
      const keyedResult = toKeyedResult(resultPayload);
      // Always try to merge audit results to capture all workflow outputs
      try {
        const audit = await getJobAudit(jobExecutionId);
        const workflowData = await getWorkflowSchema(WORKFLOW_ID_PRIMARY);
        const auditResult = extractResultsFromAudit(audit, workflowData);
        // Merge: audit fills in keys not already in keyedResult
        return { status, result: { ...auditResult, ...keyedResult } };
      } catch {
        // Audit fetch failed, use keyed result only
      }
      return { status, result: keyedResult };
    }

    if (["FAILED", "CANCELLED"].includes(status)) {
      // Try to extract partial results from the audit data
      try {
        const audit = await getJobAudit(jobExecutionId);
        const workflowData = await getWorkflowSchema(WORKFLOW_ID_PRIMARY);
        const partialResult = extractResultsFromAudit(audit, workflowData);
        // Only treat as completed if we have actual workflow OUTPUT keys (not just inputs/extracted_text)
        const hasRealOutputs = Object.keys(partialResult).some(
          (k) => k.startsWith("workflow_output_") || k === "decision" || k === "case_status"
        );
        if (hasRealOutputs) {
          return { status: "COMPLETED", result: partialResult };
        }
      } catch {
        // Audit retrieval failed, fall through to error
      }
      throw new Error(`Job did not complete successfully. Last status: ${status}`);
    }

    await sleep(intervalMs);
  }

  throw new Error("Timed out waiting for Opus workflow completion");
};

const extractResultsFromAudit = (audit, workflowData) => {
  const result = {};
  const nodesData = audit?.audit?.nodes_execution_data;
  if (!nodesData || typeof nodesData !== "object") return result;

  // Collect all node outputs by their internal variable names
  for (const [, nodeData] of Object.entries(nodesData)) {
    if (nodeData.execution_status !== "COMPLETED") continue;
    const outputs = nodeData.execution_output;
    if (!Array.isArray(outputs)) continue;

    for (const output of outputs) {
      if (output?.variable_name && output?.value !== undefined) {
        result[output.variable_name] = output.value;
      }
    }
  }

  // Use the workflow output node's mappings to translate internal variable names
  // to the expected output variable names
  const outputNodeId = workflowData?.workflow_output_node_id;
  const outputNode = outputNodeId ? workflowData?.nodes?.[outputNodeId] : null;
  const mappings = outputNode?.mappings;

  if (mappings && typeof mappings === "object") {
    for (const [outputKey, mapping] of Object.entries(mappings)) {
      const internalKey = mapping?.variable_path;
      if (internalKey && result[internalKey] !== undefined && result[outputKey] === undefined) {
        result[outputKey] = result[internalKey];
      }
    }
  }

  return result;
};

const uploadLocalExcelToOpus = async (localPath) => {
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error("Local Excel file was not found in backend data folder");
  }

  const extension = path.extname(localPath).replace(".", "").toLowerCase() || "xlsx";
  const { presignedUrl, fileUrl } = await getPresignedUrl(extension);

  const fileBuffer = fs.readFileSync(localPath);
  await axios.put(presignedUrl, fileBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": fileBuffer.length,
    },
  });

  return fileUrl;
};

const jobHasScreeningOutputs = (job) => {
  return Object.keys(job).some(
    (k) => k.startsWith("workflow_output_") && !k.includes("input")
  );
};

const enrichCompletedJobFromAudit = async (job) => {
  try {
    const jobId = String(job.jobId);
    // Skip negative (seed) job IDs
    if (jobId.startsWith("-")) return job;

    const audit = await getJobAudit(jobId);
    const workflowData = await getWorkflowSchema(WORKFLOW_ID_PRIMARY);
    const auditResult = extractResultsFromAudit(audit, workflowData);
    if (Object.keys(auditResult).length > 0) {
      const updated = updateJobResult(jobId, auditResult);
      return updated;
    }
  } catch (err) {
    // Audit enrichment failed, return job as-is
  }
  return job;
};

const runPrimaryWorkflowForStudent = async (studentId) => {
  ensureSeedDataFromExcel();
  let existing = findLatestJobByStudentId(studentId);
  if (!existing) {
    throw new Error("Student was not found in Excel metadata");
  }

  // If job is already in progress, return it
  if (existing.status === "IN PROGRESS") {
    return existing;
  }

  // If completed with actual screening outputs, return it (idempotency)
  if (existing.status === "COMPLETED") {
    if (jobHasScreeningOutputs(existing)) {
      return existing;
    }
    // Try to enrich from audit
    existing = await enrichCompletedJobFromAudit(existing);
    if (jobHasScreeningOutputs(existing)) {
      return existing;
    }
    // Still no outputs — the job failed silently. Reset status so we re-run below.
    existing = updateJobResult(String(existing.jobId), { status: "NOT_STARTED" });
  }

  if (!existing.fileUrl) {
    const storedPath = existing.localFilePath;
    const localSourcePath = (storedPath && fs.existsSync(storedPath)) ? storedPath : excelFilePath;
    const fileUrl = await uploadLocalExcelToOpus(localSourcePath);
    existing = updateJobResult(String(existing.jobId), {
      fileUrl,
      fileName: path.basename(localSourcePath),
    });
  }

  const workflowData = await getWorkflowSchema(WORKFLOW_ID_PRIMARY);
  const schema = extractWorkflowInputSchema(workflowData);
  if (!schema) {
    throw new Error("Workflow input schema was not found in Opus response");
  }

  const payloadInstance = buildPayloadInstance(schema, {
    studentId: String(studentId),
    crm_input_file: existing.fileUrl,
  });

  const { jobExecutionId } = await initiateJob(
    WORKFLOW_ID_PRIMARY,
    "UI Triggered Screening",
    `Screening for student ${studentId}`
  );

  createJob({
    jobId: String(jobExecutionId),
    isSecondaryWorkflowExecuted: false,
    fileUrl: existing.fileUrl,
    fileName: existing.fileName,
    localFilePath: existing.localFilePath,
    applicant_name: existing.applicant_name,
    request_type: existing.request_type,
    attachments: existing.attachments,
    email: existing.email,
    decision: existing.decision,
    final_decision: existing.final_decision,
    reason: existing.reason,
    case_status: existing.case_status,
    studentId: String(studentId),
    groupId: existing.groupId || null,
    status: "IN PROGRESS",
    submittedAt: new Date().toLocaleString("en-GB"),
    screeningStartedAt: Date.now(),
  });

  await executeJob(jobExecutionId, payloadInstance);

  const { status, result } = await waitForJobCompletion(jobExecutionId);
  const updated = updateJobResult(String(jobExecutionId), {
    status,
    ...result,
    screeningCompletedAt: Date.now(),
  });

  return updated;
};

export const getInboxController = async (_req, res) => {
  try {
    ensureSeedDataFromExcel();
    const jobs = getAllJobs().sort((a, b) => Number(b.jobId) - Number(a.jobId));
    const seenStudentIds = new Set();
    const uniqueByStudent = [];

    for (const job of jobs) {
      const studentId = String(job.studentId || "").trim();
      if (!studentId || seenStudentIds.has(studentId)) {
        continue;
      }
      seenStudentIds.add(studentId);
      uniqueByStudent.push(job);
    }

    res.status(200).json(uniqueByStudent.map(toInboxCase));
  } catch (error) {
    res.status(500).json({ detail: error.message || "Failed to fetch inbox" });
  }
};

export const getCaseStatusController = async (req, res) => {
  try {
    ensureSeedDataFromExcel();
    const job = findLatestJobByStudentId(req.params.studentId);
    if (!job) {
      return res.status(404).json({ detail: "Case not found" });
    }

    return res.status(200).json(toCaseInfo(job));
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Failed to fetch case" });
  }
};

export const triggerScreeningController = async (req, res) => {
  const studentId = String(req.params.studentId || "").trim();
  try {
    ensureSeedDataFromExcel();

    if (activeScreeningByStudent.has(studentId)) {
      const inFlight = await activeScreeningByStudent.get(studentId);
      return res.status(200).json(inFlight);
    }

    const runPromise = (async () => {
      const updatedJob = await runPrimaryWorkflowForStudent(studentId);
      return toScreeningResult(updatedJob);
    })();

    activeScreeningByStudent.set(studentId, runPromise);
    const result = await runPromise;
    activeScreeningByStudent.delete(studentId);

    return res.status(200).json(result);
  } catch (error) {
    activeScreeningByStudent.delete(studentId);
    return res.status(500).json({ detail: error.message || "Screening failed" });
  }
};

export const submitHumanDecisionController = async (req, res) => {
  try {
    ensureSeedDataFromExcel();
    const threadId = String(req.params.threadId);
    const action = req.body?.human_decision;

    const job = getAllJobs().find((item) => String(item.jobId) === threadId);
    if (!job) {
      return res.status(404).json({ detail: "Screening thread not found" });
    }

    const mapped = toHumanDecisionResult(action, job);
    const updated = updateJobResult(threadId, {
      decision: mapped.decision,
      application_status: mapped.application_status,
      case_status: mapped.case_status,
      workflow_output_p1e47k0wq: mapped.application_status,
      workflow_output_i7abcyo03: mapped.application_status,
    });

    return res.status(200).json({
      decision: mapped.decision,
      application_status: mapped.application_status,
      case_status: mapped.case_status,
      thread_id: threadId,
      student_id: String(updated.studentId || ""),
    });
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Decision submission failed" });
  }
};

export const resetJobsController = async (_req, res) => {
  try {
    fs.writeFileSync(jobsFilePath, "[]\n");
    return res.status(200).json({ message: "Jobs reset successful" });
  } catch (error) {
    return res.status(500).json({ detail: error.message || "Reset failed" });
  }
};
