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

// What is node 0950ad43?
const originNodeId = '0950ad43-382f-4079-9f81-b13da24ba779';
const originNode = nodes[originNodeId];
console.log('=== Origin node for broken mapping ===');
console.log('Name:', originNode?.name);
console.log('Type:', originNode?.type);
console.log('Output schema:', JSON.stringify(originNode?.output_schema?.schema, null, 2));

// Is this node on the execution path for the updated path?
// Check if it's in the child_adjacency chain
console.log('\n=== Checking if origin node is reachable on updated path ===');
const updocNodeId = '7b7b3f21-5479-4ff5-97da-2e021788b0c9';
const studentIdUpdaterId = '04985a43-aec4-4b4a-a2ac-3dcc284b9ab6';
const booleanEvalId = '9fdf1e52-d0a1-442f-9430-f1bc91285d93';

// Trace who this origin node's parents are
console.log('\nTracing parents of origin node:');
for (const [nId, children] of Object.entries(data.child_adjacency || {})) {
  if (children.includes(originNodeId)) {
    console.log(`  Parent: ${nodes[nId]?.name} (${nId})`);
  }
}

// Check edges TO the origin node
console.log('\nEdges TO origin node:');
for (const [edgeId, edge] of Object.entries(data.edges || {})) {
  if (edge.to_node_id === originNodeId) {
    console.log(`  From: ${nodes[edge.from_node_id]?.name} (${edge.from_node_id})`);
  }
}

// Check edges FROM the origin node
console.log('\nEdges FROM origin node:');
for (const [edgeId, edge] of Object.entries(data.edges || {})) {
  if (edge.from_node_id === originNodeId) {
    console.log(`  To: ${nodes[edge.to_node_id]?.name} (${edge.to_node_id})`);
  }
}

// What is the updoc node's output?
console.log('\n=== Updoc node output ===');
const updocNode = nodes[updocNodeId];
console.log('Output schema:', JSON.stringify(updocNode?.output_schema?.schema, null, 2));

// Check what variable workflow_output_38ledg81w is
console.log('\n=== Searching for workflow_output_38ledg81w in all nodes ===');
for (const [nId, node] of Object.entries(nodes)) {
  const nodeStr = JSON.stringify(node);
  if (nodeStr.includes('workflow_output_38ledg81w')) {
    console.log(`Found in node: ${node.name} (${nId})`);
    // Check output schema
    if (node.output_schema?.schema?.workflow_output_38ledg81w) {
      console.log('  In output_schema:', JSON.stringify(node.output_schema.schema.workflow_output_38ledg81w));
    }
  }
}
