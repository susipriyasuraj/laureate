import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';

const baseURL = process.env.OPUS_BASE_URL;
const apiKey = process.env.OPUS_API_KEY;
const workflowId = process.env.WORKFLOW_ID_PRIMARY;

const client = axios.create({
  baseURL,
  headers: { 'x-service-key': apiKey, 'Content-Type': 'application/json' }
});

const res = await client.get(`/workflow/${workflowId}`);
const data = res.data;
const nodes = data.nodes;

const responderNodeId = '0950ad43-382f-4079-9f81-b13da24ba779';
const responder = nodes[responderNodeId];

// Dump full node config (removing massive fields)
console.log('=== Full Responder Node Config ===');
const keys = Object.keys(responder);
console.log('Keys:', keys);
console.log();

// Check all fields except the schema ones we already saw
for (const key of keys) {
  if (['input_schema', 'output_schema', 'mappings', 'set_values'].includes(key)) continue;
  const val = responder[key];
  if (typeof val === 'object' && val !== null) {
    const str = JSON.stringify(val);
    if (str.length > 500) {
      console.log(`${key}: [${str.length} chars] ${str.substring(0, 500)}...`);
    } else {
      console.log(`${key}:`, str);
    }
  } else {
    console.log(`${key}:`, val);
  }
}

// Also check the last job audit for "Update Case Data Responder"
// Run a quick test job with student 45090489 to see the audit
console.log('\n\n=== Checking most recent job for this student ===');
// Use jobStore if available, or just check the workflow's recent jobs
try {
  // Let's just look at what the audit says for the last job
  const jobsFile = await import('fs').then(fs => fs.promises.readFile('./src/data/jobs.json', 'utf8'));
  const jobs = JSON.parse(jobsFile);
  // Find the most recent job for student 45090489
  const studentJobs = Object.values(jobs).filter(j => 
    j.studentId === '45090489' || j.payload?.student_id === '45090489'
  );
  if (studentJobs.length > 0) {
    const lastJob = studentJobs[studentJobs.length - 1];
    console.log('Last job ID:', lastJob.opusJobId || lastJob.jobId);
    console.log('Status:', lastJob.status);
    
    if (lastJob.opusJobId) {
      // Get the audit for this job
      const auditRes = await client.get(`/job/${lastJob.opusJobId}/audit`);
      const audit = auditRes.data;
      console.log('\nAudit entries:');
      for (const entry of audit.node_executions || []) {
        console.log(`  ${entry.node_name}: status=${entry.status}, error=${entry.error || 'none'}`);
      }
    }
  } else {
    console.log('No jobs found for student 45090489');
  }
} catch (e) {
  console.log('Error checking jobs:', e.message);
}
