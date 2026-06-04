import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const api = axios.create({ baseURL });

export const getInbox = () => api.get('/inbox').then(r => r.data);

export const triggerScreening = (studentId) =>
  api.post(`/trigger-screening/${studentId}`).then(r => r.data);

export const submitHumanDecision = (threadId, decision) =>
  api.post(`/human-decision/${threadId}`, { human_decision: decision }).then(r => r.data);

export const getCaseStatus = (studentId) =>
  api.get(`/case-status/${studentId}`).then(r => r.data);

export const getJobAudit = (jobId) =>
  api.get(`/jobs/${jobId}/audit`).then(r => r.data?.result ?? r.data);

export const resetExcel = () => api.post('/reset').then(r => r.data);
