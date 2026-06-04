import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';
import fs from 'fs';

const baseURL = process.env.OPUS_BASE_URL;
const apiKey = process.env.OPUS_API_KEY;

const client = axios.create({
  baseURL,
  headers: { 'x-service-key': apiKey, 'Content-Type': 'application/json' }
});

// Get the last job for student 45090489
const jobsData = JSON.parse(fs.readFileSync('./src/data/jobs.json', 'utf8'));
const studentJobs = Object.values(jobsData).filter(j => 
  j.studentId === '45090489'
);
const lastJob = studentJobs[studentJobs.length - 1];
console.log('Job ID:', lastJob.opusJobId);
console.log('Status:', lastJob.status);

// Get audit
const auditRes = await client.get(`/job/${lastJob.opusJobId}/audit`);
const audit = auditRes.data;

console.log('\n=== Node Executions ===');
for (const entry of audit.node_executions || []) {
  const status = entry.status || entry.state;
  const error = entry.error || '';
  console.log(`  ${entry.node_name || entry.name}: status=${status} ${error ? 'ERROR: ' + error : ''}`);
  if (entry.output || entry.outputs) {
    const out = entry.output || entry.outputs;
    const outStr = JSON.stringify(out);
    if (outStr.length > 200) {
      console.log(`    output: ${outStr.substring(0, 200)}...`);
    } else {
      console.log(`    output: ${outStr}`);
    }
  }
}

// Also get job results
console.log('\n=== Job Results ===');
try {
  const resultsRes = await client.get(`/job/${lastJob.opusJobId}/results`);
  console.log('Status code:', resultsRes.status);
  console.log('Results:', JSON.stringify(resultsRes.data, null, 2).substring(0, 1000));
} catch (e) {
  console.log('Results error:', e.response?.status, e.response?.data);
}

// Get job status
const statusRes = await client.get(`/job/${lastJob.opusJobId}/status`);
console.log('\n=== Job Status ===');
console.log(JSON.stringify(statusRes.data, null, 2));
