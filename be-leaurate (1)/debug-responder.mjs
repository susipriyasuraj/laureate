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
const responderNodeId = '0950ad43-382f-4079-9f81-b13da24ba779';
const gdriveSpsNodeId = '037f4d82-b5dc-416d-ba0c-15cbf4679a0f';

// Full child adjacency for updoc
console.log('=== child_adjacency[updoc] ===');
const updocChildren = data.child_adjacency?.[updocNodeId] || [];
console.log('Children:', updocChildren.map(c => `${nodes[c]?.name} (${c})`));

// Full child adjacency for responder
console.log('\n=== child_adjacency[responder] ===');
const responderChildren = data.child_adjacency?.[responderNodeId] || [];
console.log('Children:', responderChildren.map(c => `${nodes[c]?.name} (${c})`));

// All edges from updoc
console.log('\n=== ALL edges FROM updoc ===');
for (const [edgeId, edge] of Object.entries(data.edges || {})) {
  if (edge.from_node_id === updocNodeId) {
    console.log(`  → ${nodes[edge.to_node_id]?.name} (${edge.to_node_id}) [label: ${edge.label}, route: ${edge.route_id}]`);
  }
}

// All edges TO Google Drive sps  
console.log('\n=== ALL edges TO Google Drive sps ===');
for (const [edgeId, edge] of Object.entries(data.edges || {})) {
  if (edge.to_node_id === gdriveSpsNodeId) {
    console.log(`  ← ${nodes[edge.from_node_id]?.name} (${edge.from_node_id}) [label: ${edge.label}, route: ${edge.route_id}]`);
  }
}

// Check Update Case Data Responder input requirements
console.log('\n=== Update Case Data Responder - Full Details ===');
const responder = nodes[responderNodeId];
console.log('Input schema:', JSON.stringify(responder?.input_schema?.schema, null, 2));
console.log('Mappings:', JSON.stringify(responder?.mappings, null, 2));
console.log('Set values:', JSON.stringify(responder?.set_values, null, 2));

// Check if there's a routing_mask blocking it
console.log('\n=== Routing masks for updoc ===');
const updocMask = data.routing_masks?.[updocNodeId];
console.log(JSON.stringify(updocMask, null, 2));

// Is the responder in the node list properly?
console.log('\n=== Node exists check ===');
console.log('Responder exists:', !!nodes[responderNodeId]);
console.log('Responder name:', nodes[responderNodeId]?.name);
console.log('Responder enabled:', nodes[responderNodeId]?.enabled);
console.log('Responder status:', nodes[responderNodeId]?.status);
