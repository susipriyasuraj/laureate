import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getCaseStatus, getJobAudit, triggerScreening, submitHumanDecision } from '../api/client';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');

function resolveAttachmentPreviewUrl(item) {
  const relativeOrAbsolute = item?.attachment_url;
  if (!relativeOrAbsolute) return null;
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  return `${API_BASE_URL}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`;
}

function PdfPreviewModal({ open, previewUrl, title, onClose }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-white rounded-xl border border-[#E2E8F0] shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 bg-[#002855] text-white flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Application Document Preview</p>
            <p className="text-xs text-[#93c5fd] mt-0.5">{title || 'Applicant document'}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 transition-colors"
          >
            Close
          </button>
        </div>
        <iframe
          src={previewUrl}
          title="Dashboard PDF Preview"
          className="w-full h-[72vh] bg-[#F8FAFC]"
        />
      </div>
    </div>
  );
}
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import AgentResultPanel from '../components/AgentResultPanel';
import DeficiencyAlert from '../components/DeficiencyAlert';
import HumanReviewPanel from '../components/HumanReviewPanel';

/* ── Helper: extract individual attachment chips ── */
function AttachmentChips({ attachmentUrls, onPreview }) {
  if (!attachmentUrls || attachmentUrls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachmentUrls.map((doc) => (
        <button
          key={doc.name}
          onClick={() => onPreview(doc)}
          className="flex items-center gap-1 px-3 py-1 bg-[#E8F0F7] text-[#002855] text-xs font-medium rounded-md border border-[#c3d5e8] hover:bg-[#DBEAFE] hover:border-[#93c5fd] transition-colors cursor-pointer"
          title={`Preview ${doc.name}`}
        >
          <svg className="w-3 h-3 text-[#1D4ED8]" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" /></svg>
          {doc.name}
        </button>
      ))}
    </div>
  );
}

/* ── Decision banner border / bg logic ── */
function getBannerStyle(decision, caseStatus) {
  const d = decision?.toLowerCase() || '';
  const cs = caseStatus?.toLowerCase() || '';
  if (d === 'selected' || cs === 'closed') {
    return 'border-green-400 bg-green-50 text-green-800';
  }
  if (d === 'deny') {
    return 'border-red-400 bg-red-50 text-red-800';
  }
  if (d === 'incomplete application') {
    return 'border-orange-400 bg-orange-50 text-orange-800';
  }
  return 'border-yellow-400 bg-yellow-50 text-yellow-800';
}

function getBannerIcon(decision, caseStatus) {
  const d = decision?.toLowerCase() || '';
  const cs = caseStatus?.toLowerCase() || '';
  if (d === 'selected' || cs === 'closed') return '✅';
  if (d === 'deny') return '❌';
  if (d === 'incomplete application') return '⚠';
  return '🕐';
}

/* ── Decision Summary Card ── */
function DecisionSummaryCard({ result }) {
  return (
    <div className="mt-4 bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-[#002855] flex items-center gap-2">
        <svg className="w-4 h-4 text-[#93c5fd]" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
        <h3 className="text-sm font-semibold text-white tracking-wide">Decision Summary</h3>
      </div>
      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-5">
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Agent Decision</p>
          <StatusBadge value={result.decision} kind="decision" />
        </div>
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Deficiency Status</p>
          <StatusBadge value={result.flagged_or_verified} kind="flagged" />
        </div>
        <div className="bg-[#F5F6F8] rounded-lg p-3">
          <p className="text-xs text-[#6B7280] mb-2 font-medium">Case Status</p>
          <StatusBadge value={result.case_status} kind="application" />
        </div>
      </div>
    </div>
  );
}

/* ══════════════ MAIN PAGE ══════════════ */
export default function CaseDetailPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = location.state?.mode; // 'screen' | 'view' | undefined
  const attachmentUrl = location.state?.attachment_url;

  /* ── State ── */
  const [caseInfo,      setCaseInfo]      = useState(null);
  const [loadingCase,   setLoadingCase]   = useState(true);
  const [caseError,     setCaseError]     = useState(null);

  const [screeningLoading,  setScreeningLoading]  = useState(false);
  const [screeningResult,   setScreeningResult]   = useState(null);
  const [screeningError,    setScreeningError]    = useState(null);
  const [screeningStartTime, setScreeningStartTime] = useState(null);
  const [elapsedTime,        setElapsedTime]        = useState(null);
  const [auditTrail,        setAuditTrail]        = useState([]);

  const [decisionLoading,   setDecisionLoading]   = useState(null); // 'approve' | 'raise' | null
  const [finalResult,       setFinalResult]       = useState(null);
  const [decisionError,     setDecisionError]     = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewTitle, setPreviewTitle] = useState('');

  async function loadJobAudit(threadId) {
    if (!threadId) {
      setAuditTrail([]);
      return;
    }

    try {
      const audit = await getJobAudit(threadId);
      setAuditTrail(audit || []);
    } catch (err) {
      console.error('Failed to fetch audit trail', err);
      setAuditTrail([]);
    }
  }

  /* ── On mount: load case info, then decide based on mode ── */
  useEffect(() => {
    let stale = false; // prevents state updates if studentId changes mid-flight
    async function init() {
      setLoadingCase(true);
      setCaseError(null);
      try {
        const data = await getCaseStatus(studentId);
        if (stale) return;
        setCaseInfo(data);
      } catch (err) {
        if (stale) return;
        setCaseError(err?.response?.data?.detail || err.message || 'Failed to load case.');
        setLoadingCase(false);
        return;
      }
      setLoadingCase(false);

      // VIEW mode: restore from cache, never auto-trigger
      if (mode === 'view') {
        const cached = sessionStorage.getItem(`screening_${studentId}`);
        if (cached) {
          try {
            const { screeningResult: sr, finalResult: fr, elapsedTime: et } = JSON.parse(cached);
            if (stale) return;
            if (sr) {
              setScreeningResult(sr);
              await loadJobAudit(sr.thread_id);
            }
            if (fr) setFinalResult(fr);
            if (et) setElapsedTime(et);
          } catch (err) {
            console.error('Failed to parse cached screening result', err);
          }
        }
        return;
      }

      // SCREEN mode (or direct URL): always trigger screening fresh
      setScreeningLoading(true);
      setScreeningError(null);
      setScreeningResult(null);
      setAuditTrail([]);
      setFinalResult(null);
      setElapsedTime(null);
      const startTime = Date.now();
      setScreeningStartTime(startTime);
      try {
        const result = await triggerScreening(studentId);
        if (stale) return;
        // Double-check the returned result belongs to this student
        if (result.student_id && result.student_id !== studentId) return;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const formatted = result.execution_time ||
          (elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed/60)}m ${elapsed%60}s`);
        setElapsedTime(formatted);
        setScreeningResult(result);
        await loadJobAudit(result.thread_id);
        sessionStorage.setItem(`screening_${studentId}`, JSON.stringify({ screeningResult: result, finalResult: null, elapsedTime: formatted }));
      } catch (err) {
        if (stale) return;
        setScreeningError(err?.response?.data?.detail || err.message || 'Screening failed.');
      } finally {
        if (!stale) setScreeningLoading(false);
      }
    }
    init();
    return () => { stale = true; };
  }, [studentId, mode]);

  /* ── Re-run screening (clears cache and re-triggers) ── */
  async function handleTriggerScreening() {
    sessionStorage.removeItem(`screening_${studentId}`);
    setScreeningLoading(true);
    setScreeningError(null);
    setScreeningResult(null);
    setAuditTrail([]);
    setFinalResult(null);
    setElapsedTime(null);
    const startTime = Date.now();
    setScreeningStartTime(startTime);
    try {
      const result = await triggerScreening(studentId);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const formatted = result.execution_time ||
        (elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed/60)}m ${elapsed%60}s`);
      setElapsedTime(formatted);
      setScreeningResult(result);
      await loadJobAudit(result.thread_id);
      sessionStorage.setItem(`screening_${studentId}`, JSON.stringify({ screeningResult: result, finalResult: null, elapsedTime: formatted }));
    } catch (err) {
      setScreeningError(err?.response?.data?.detail || err.message || 'Screening failed.');
    } finally {
      setScreeningLoading(false);
    }
  }

  /* ── Step 4: human decision ── */
  async function handleDecision(type) {
    if (!screeningResult?.thread_id) return;
    setDecisionLoading(type);
    setDecisionError(null);
    try {
      const apiAction = type === 'raise' ? 'raise_insufficiency' : type;
      const result = await submitHumanDecision(screeningResult.thread_id, apiAction);
      setFinalResult(result);
      sessionStorage.setItem(`screening_${studentId}`, JSON.stringify({ screeningResult, finalResult: result }));
    } catch (err) {
      setDecisionError(err?.response?.data?.detail || err.message || 'Decision submission failed.');
    } finally {
      setDecisionLoading(null);
    }
  }

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-[#F5F6F8]">

      {/* ── Header ── */}
      <header className="bg-[#002855] text-white px-6 py-4 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[#9CA3AF] hover:text-white text-sm transition-colors"
          >
            ← Home
          </button>
          <span className="text-[#6B7280]">|</span>
          <div className="flex items-center gap-2">
            <span className="text-xl">🎓</span>
            <span className="font-semibold text-white">Laureate Application Screening</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Loading case ── */}
        {loadingCase && <LoadingSpinner message="Loading case details…" />}

        {/* ── Case error ── */}
        {caseError && (
          <ErrorBanner
            title="Could not load case"
            message={caseError}
            onRetry={() => {
              setLoadingCase(true);
              getCaseStatus(studentId)
                .then(data => { setCaseInfo(data); setCaseError(null); })
                .catch(e => setCaseError(e?.response?.data?.detail || e.message))
                .finally(() => setLoadingCase(false));
            }}
          />
        )}

        {/* ── Step 1: Case Info Panel ── */}
        {!loadingCase && caseInfo && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            {/* Card header bar */}
            <div className="bg-[#002855] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">{caseInfo.applicant_name}</h2>
                <p className="font-mono text-xs text-[#93c5fd] mt-0.5">{caseInfo.student_id}</p>
              </div>
              {/* Re-run button — always visible after case loads */}
              {!loadingCase && (
                <button
                  onClick={handleTriggerScreening}
                  disabled={screeningLoading}
                  className="
                    flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg
                    bg-white/10 hover:bg-white/20 border border-white/20
                    text-sm text-white font-medium
                    transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                  "
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>
                  {screeningLoading ? 'Running…' : 'Re-run Screening'}
                </button>
              )}
            </div>

            {/* Card body */}
            <div className="px-6 py-4">
              <div className="flex flex-wrap gap-2">
                {screeningLoading ? (
                  <StatusBadge value="Under Review" kind="screening" />
                ) : screeningResult ? (
                  <StatusBadge value={screeningResult.decision || screeningResult.case_status || "Under Review"} kind="application" />
                ) : (
                  <>
                    <StatusBadge value={caseInfo.request_type}       kind="request" />
                    <StatusBadge value={caseInfo.screening_status}   kind="screening" />
                    <StatusBadge value={caseInfo.application_status} kind="application" />
                  </>
                )}
              </div>

              {/* Attachments */}
              {(caseInfo.attachment_urls?.length > 0 || caseInfo.attachments) && (
                <div className="mt-4 pt-4 border-t border-[#F1F5F9]">
                  <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-widest mb-2">
                    Attached Documents
                  </p>
                  <AttachmentChips
                    attachmentUrls={caseInfo.attachment_urls || []}
                    onPreview={(doc) => {
                      const url = doc.url.startsWith('http')
                        ? doc.url
                        : `${API_BASE_URL}${doc.url.startsWith('/') ? '' : '/'}${doc.url}`;
                      setPreviewUrl(url);
                      setPreviewTitle(doc.name);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Screening in progress ── */}
        {screeningLoading && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            <div className="h-1 w-full bg-[#E8F0F7] relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 w-1/2 bg-[#002855] rounded-full"
                style={{ animation: 'progressSlide 1.5s ease-in-out infinite alternate' }} />
            </div>
            <div className="px-8 py-10 flex flex-col items-center gap-5">
              <div className="w-14 h-14 rounded-full bg-[#E8F0F7] flex items-center justify-center">
                <svg className="w-7 h-7 text-[#002855]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-[#002855]">
                  AI agents are reviewing documents
                  <span className="loading-dots ml-1"><span /><span /><span /></span>
                </p>
                <p className="text-sm text-[#6B7280] mt-1.5 max-w-sm">
                  Running OCR → Completeness Check → Screening Rules pipeline.
                </p>
              </div>
              <div className="flex items-center gap-6 text-xs text-[#6B7280]">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a] inline-block" /> OCR
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block" style={{ animation: 'pulse 1s infinite' }} /> Completeness Check
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] inline-block" /> Screening Rules
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Screening error ── */}
        {screeningError && (
          <ErrorBanner
            title="Screening failed"
            message={screeningError}
            onRetry={handleTriggerScreening}
          />
        )}

        {/* ── Step 3: Agent Results ── */}
        {screeningResult && !screeningLoading && (
          <>
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-5 w-1 rounded-full bg-[#002855]" />
                <h2 className="text-lg font-bold text-[#002855]">Evaluation Results</h2>
                {elapsedTime && (
                  <span className="flex items-center gap-1.5 text-xs text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-1 rounded-full font-semibold">
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
                    Completed in {elapsedTime}
                  </span>
                )}
                <span className="ml-auto text-xs text-[#6B7280] bg-white border border-[#E2E8F0] px-2.5 py-1 rounded-full">
                  {screeningResult.flagged_or_verified === 'Flagged' ? '⚑ Flagged for Review' : '✓ Verified'}
                </span>
              </div>
              <AgentResultPanel result={screeningResult} auditTrail={auditTrail} />
              <DecisionSummaryCard result={screeningResult} />
              <DeficiencyAlert deficiencies={screeningResult.deficiency_list} reason={screeningResult.reason} />
            </div>

            {/* ── Step 4: Human Review (only if no final result yet) ── */}
            {!finalResult && (
              <>
                {decisionError && (
                  <ErrorBanner title="Decision submission failed" message={decisionError} />
                )}
                <HumanReviewPanel
                  agentDecision={screeningResult.decision}
                  availableActions={screeningResult.available_actions}
                  loading={decisionLoading}
                  onDecision={handleDecision}
                />
              </>
            )}
          </>
        )}

        {/* ── Step 5: Final Decision Banner ── */}
        {finalResult && (
          <FinalDecisionBanner result={finalResult} onBack={() => navigate('/')} onRerun={handleTriggerScreening} loading={screeningLoading} />
        )}

      </main>

      <PdfPreviewModal
        open={Boolean(previewUrl)}
        previewUrl={previewUrl}
        title={previewTitle}
        onClose={() => { setPreviewUrl(null); setPreviewTitle(''); }}
      />
    </div>
  );
}

/* ── Sub-components local to this page ── */

function ErrorBanner({ title, message, onRetry }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
      <span className="text-red-500 text-lg flex-shrink-0">✕</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-700">{title}</p>
        <p className="text-xs text-red-600 mt-0.5">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs font-medium text-[#1D4ED8] hover:underline flex-shrink-0"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function getAppStatusStyle(val) {
  const v = (val || '').toLowerCase();
  if (v.includes('select') || v.includes('approv') || v.includes('accept'))
    return { tile: 'bg-green-50 border border-green-200', text: 'text-green-700' };
  if (v.includes('reject') || v.includes('deny'))
    return { tile: 'bg-red-50 border border-red-200', text: 'text-red-700' };
  if (v.includes('waitlist'))
    return { tile: 'bg-blue-50 border border-blue-200', text: 'text-blue-700' };
  if (v.includes('insufficien') || v.includes('incomplete') || v.includes('process'))
    return { tile: 'bg-amber-50 border border-amber-200', text: 'text-amber-700' };
  return { tile: 'bg-[#F5F6F8]', text: 'text-[#002855]' };
}

function getCaseStatusStyle(val) {
  const v = (val || '').toLowerCase();
  if (v === 'closed' || v.includes('complet'))
    return { tile: 'bg-green-50 border border-green-200', text: 'text-green-700' };
  if (v === 'open' || v.includes('pending') || v.includes('review'))
    return { tile: 'bg-blue-50 border border-blue-200', text: 'text-blue-700' };
  if (v.includes('reject') || v.includes('denied'))
    return { tile: 'bg-red-50 border border-red-200', text: 'text-red-700' };
  if (v.includes('hold') || v.includes('wait') || v.includes('escalat'))
    return { tile: 'bg-amber-50 border border-amber-200', text: 'text-amber-700' };
  return { tile: 'bg-[#F5F6F8]', text: 'text-[#002855]' };
}

function getBodyBg(val, caseStatus) {
  const v = (val || '').toLowerCase();
  const cs = (caseStatus || '').toLowerCase();
  if (v.includes('select') || v.includes('approv') || v.includes('accept') || cs === 'closed')
    return 'bg-green-50';
  if (v.includes('reject') || v.includes('deny'))
    return 'bg-red-50';
  if (v.includes('waitlist'))
    return 'bg-blue-50';
  if (v.includes('insufficien') || v.includes('incomplete') || v.includes('process'))
    return 'bg-amber-50';
  return 'bg-yellow-50';
}

function FinalDecisionBanner({ result, onBack, onRerun, loading }) {
  const appStyle  = getAppStatusStyle(result.application_status || result.decision);
  const caseStyle = getCaseStatusStyle(result.case_status);
  const bodyBg    = getBodyBg(result.decision || result.application_status, result.case_status);

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-[#002855] flex items-center gap-3">
        <svg className="w-4 h-4 text-[#93c5fd]" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <h2 className="text-sm font-semibold text-white tracking-wide">Case Finalized</h2>
        <div className="ml-2">
          <StatusBadge value={result.decision} kind="decision" />
        </div>
      </div>
      {/* Body */}
      <div className={`p-6 grid grid-cols-2 gap-4 mb-2 ${bodyBg}`}>
        <div className={`${caseStyle.tile} rounded-lg p-3`}>
          <p className="text-xs text-[#6B7280] mb-1 font-medium uppercase tracking-wide">Case Status</p>
          <p className={`font-bold text-sm ${caseStyle.text}`}>{result.case_status || '—'}</p>
        </div>
        <div className={`${appStyle.tile} rounded-lg p-3`}>
          <p className="text-xs text-[#6B7280] mb-1 font-medium uppercase tracking-wide">Application Status</p>
          <p className={`font-bold text-sm ${appStyle.text}`}>{result.application_status || '—'}</p>
        </div>
      </div>
      <div className="px-6 pb-6 flex flex-wrap gap-3">
        <button
          onClick={onBack}
          className="
            inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
            bg-[#002855] text-white text-sm font-semibold
            hover:bg-[#003a7a] transition-all hover:scale-105 active:scale-95
          "
        >
          ← Home
        </button>
        <button
          onClick={onRerun}
          disabled={loading}
          className="
            inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
            bg-white hover:bg-[#F5F6F8] text-[#002855] border border-[#E2E8F0]
            text-sm font-semibold transition-all hover:scale-105 active:scale-95
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>
          {loading ? 'Running…' : 'Re-run Screening'}
        </button>
      </div>
    </div>
  );
}


