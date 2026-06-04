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
const updocNodeId = '7b7b3f21-5479-4ff5-97da-2e021788b0c9';
const nextNodeId = '037f4d82-b5dc-416d-ba0c-15cbf4679a0f'; // Google Drive sps (on updated path)

// Check next node details
const nextNode = nodes[nextNodeId];
console.log('=== Next Node (Google Drive sps on updated path) ===');
console.log('Name:', nextNode.name);
console.log('Input schema:');
const inputSchema = nextNode.input_schema?.schema;
if (inputSchema) {
  for (const [key, val] of Object.entries(inputSchema)) {
    console.log(`  ${key}: display="${val?.display_name}" required=${val?.required} value="${val?.value || ''}"`);
  }
}

console.log('\nMappings:');
console.log(JSON.stringify(nextNode.mappings, null, 2));

console.log('\nSet values:');
console.log(JSON.stringify(nextNode.set_values, null, 2));

// Check the edges between these nodes
console.log('\n=== All edges (looking for connections around updoc node) ===');
for (const [edgeId, edge] of Object.entries(data.edges || {})) {
  const edgeStr = JSON.stringify(edge);
  if (edgeStr.includes(updocNodeId) || edgeStr.includes(nextNodeId)) {
    console.log(`Edge ${edgeId}:`, edgeStr.substring(0, 300));
  }
}

// Check routing masks for updoc node and its parent
console.log('\n=== Routing masks ===');
for (const [nodeId, mask] of Object.entries(data.routing_masks || {})) {
  const maskStr = JSON.stringify(mask);
  if (maskStr.includes(updocNodeId) || maskStr.includes(nextNodeId)) {
    console.log(`Routing mask for ${nodes[nodeId]?.name} (${nodeId}):`);
    console.log(maskStr.substring(0, 500));
  }
}

// Check child adjacency chain for the updated path
console.log('\n=== Updated path chain (child adjacency) ===');
let currentId = updocNodeId;
for (let i = 0; i < 10; i++) {
  const children = data.child_adjacency?.[currentId] || [];
  const node = nodes[currentId];
  console.log(`${node?.name} → children: ${children.map(c => nodes[c]?.name).join(', ') || 'NONE'}`);
  if (children.length === 0) break;
  currentId = children[0];
}
