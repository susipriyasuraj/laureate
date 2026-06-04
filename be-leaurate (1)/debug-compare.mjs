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

// Compare the working Google Drive node (new path) vs broken one (updated path)
const workingNodeId = '1cb80b4f-bbd0-4e35-9ec0-51a8efe023b6'; // new path
const brokenNodeId = '037f4d82-b5dc-416d-ba0c-15cbf4679a0f';  // updated path
const updocNodeId = '7b7b3f21-5479-4ff5-97da-2e021788b0c9';   // updoc node

console.log('=== WORKING NODE (new path - Google Drive sps) ===');
const working = nodes[workingNodeId];
console.log('Mappings:', JSON.stringify(working.mappings, null, 2));
console.log('Input schema:');
for (const [key, val] of Object.entries(working.input_schema?.schema || {})) {
  console.log(`  ${key}: value="${val?.value || ''}" display="${val?.display_name}"`);
}

console.log('\n=== BROKEN NODE (updated path - Google Drive sps) ===');
const broken = nodes[brokenNodeId];
console.log('Mappings:', JSON.stringify(broken.mappings, null, 2));
console.log('Input schema:');
for (const [key, val] of Object.entries(broken.input_schema?.schema || {})) {
  console.log(`  ${key}: value="${val?.value || ''}" display="${val?.display_name}"`);
}

console.log('\n=== UPDOC NODE (Google Drive sps-updoc) ===');
const updoc = nodes[updocNodeId];
console.log('Mappings:', JSON.stringify(updoc.mappings, null, 2));
console.log('Input schema:');
for (const [key, val] of Object.entries(updoc.input_schema?.schema || {})) {
  console.log(`  ${key}: value="${val?.value || ''}" display="${val?.display_name}"`);
}
console.log('Output schema:');
for (const [key, val] of Object.entries(updoc.output_schema?.schema || {})) {
  console.log(`  ${key}: display="${val?.display_name}"`);
}
