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

// Find the Google Drive updated node
const nodes = data.nodes;
let updatedDriveNodeId = null;
for (const [id, node] of Object.entries(nodes)) {
  if (node.name && node.name.includes('updoc')) {
    updatedDriveNodeId = id;
    console.log('=== Google Drive Updated Node ===');
    console.log('ID:', id);
    console.log('Name:', node.name);
    console.log('Output schema keys:', Object.keys(node.output_schema?.schema || {}));
    break;
  }
}

if (!updatedDriveNodeId) {
  console.log('Updated Drive node not found');
  process.exit(1);
}

// Check what nodes come after this one (children)
const children = data.child_adjacency?.[updatedDriveNodeId] || [];
console.log('\n=== Children of updated Drive node ===');
console.log('Child node IDs:', children);
for (const childId of children) {
  const child = nodes[childId];
  console.log(`  ${childId}: "${child?.name}" (type: ${child?.type})`);
}

// Check routing masks
const routingMasks = data.routing_masks;
console.log('\n=== Routing masks for updated Drive node ===');
if (routingMasks?.[updatedDriveNodeId]) {
  console.log(JSON.stringify(routingMasks[updatedDriveNodeId], null, 2));
}

// Check the edges from this node
const edges = data.edges;
console.log('\n=== Edges from updated Drive node ===');
for (const [edgeId, edge] of Object.entries(edges || {})) {
  if (edge.source === updatedDriveNodeId || edge.from === updatedDriveNodeId) {
    console.log(`Edge ${edgeId}:`, JSON.stringify(edge));
  }
}

// Also check the "New Request Boolean Evaluator" routing
let boolEvalId = null;
for (const [id, node] of Object.entries(nodes)) {
  if (node.name && node.name.includes('Boolean Evaluator')) {
    boolEvalId = id;
    break;
  }
}
if (boolEvalId) {
  console.log('\n=== Boolean Evaluator children ===');
  const boolChildren = data.child_adjacency?.[boolEvalId] || [];
  for (const childId of boolChildren) {
    const child = nodes[childId];
    console.log(`  ${childId}: "${child?.name}"`);
  }
  console.log('\n=== Boolean Evaluator routing masks ===');
  if (routingMasks?.[boolEvalId]) {
    console.log(JSON.stringify(routingMasks[boolEvalId], null, 2).substring(0, 2000));
  }
}

// List all nodes in the workflow
console.log('\n=== ALL NODES ===');
for (const [id, node] of Object.entries(nodes)) {
  console.log(`  ${id}: "${node.name}" (type: ${node.type})`);
}
