import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Database, FileCheck2, FolderSearch, HardDrive, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { acknowledgeSuccessfulStorageCleanup } from '../persistence/startupStorageRecovery';
import {
  isTauriRecoveryAvailable,
  RECOVERY_DELETE_CONFIRMATION,
  RECOVERY_EXTRACT_COMMAND,
  recoveryClient,
  recoveryErrorMessage,
  type BackupReport,
  type CleanupReport,
  type DestinationReport,
  type ProjectRecoveryReport,
  type RecoveryCandidate,
  type ResumableBackup,
  type ResumeDiscovery,
} from './recoveryClient';

type RecoveryWorkspaceProps = {
  startupBlocked: boolean;
};

type ProgressState = {
  phase?: string;
  message?: string;
  recordsScanned?: number;
  projectsRecovered?: number;
};

const yieldForRecoveryStatusPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});

const formatBytes = (bytes: number | null | undefined) => {
  if (!Number.isFinite(bytes) || !bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** exponent)).toFixed(exponent > 2 ? 2 : 1)} ${units[exponent]}`;
};

const recoveryJobId = (kind: string) => `${kind}-${Date.now()}-${crypto.randomUUID()}`;

const Step: React.FC<{ number: number; title: string; complete?: boolean; children: React.ReactNode }> = ({ number, title, complete, children }) => (
  <section className="rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-4" data-testid={`recovery-step-${number}`}>
    <div className="flex items-center gap-3">
      <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${complete ? 'bg-emerald-600 text-white' : 'bg-[color:var(--ui-surface-strong)] text-[color:var(--brand-primary)]'}`}>
        {complete ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : number}
      </span>
      <h3 className="font-semibold text-[color:var(--ui-text)]">{title}</h3>
    </div>
    <div className="mt-3 text-sm leading-6 text-[color:var(--ui-panel-text)]">{children}</div>
  </section>
);

export const RecoveryWorkspace: React.FC<RecoveryWorkspaceProps> = ({ startupBlocked }) => {
  const desktopAvailable = isTauriRecoveryAvailable();
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [backupDestination, setBackupDestination] = useState('~/Design-Space-Recovery');
  const [exportDestination, setExportDestination] = useState('~/Design-Space-Recovery');
  const [destination, setDestination] = useState<DestinationReport | null>(null);
  const [backup, setBackup] = useState<BackupReport | null>(null);
  const [report, setReport] = useState<ProjectRecoveryReport | null>(null);
  const [cleanup, setCleanup] = useState<CleanupReport | null>(null);
  const [resumableBackups, setResumableBackups] = useState<ResumableBackup[]>([]);
  const [selectedBackupManifest, setSelectedBackupManifest] = useState('');
  const [resumeSessionPath, setResumeSessionPath] = useState('');
  const [resumeStatus, setResumeStatus] = useState('Searching for existing verified backups…');
  const [deletionSafetyCurrent, setDeletionSafetyCurrent] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [applicationAuditPath, setApplicationAuditPath] = useState('');
  const [progress, setProgress] = useState<ProgressState>({});
  const [busy, setBusy] = useState<'detect' | 'resume' | 'backup' | 'extract' | 'delete' | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recoveryInFlight = useRef(false);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0] ?? null,
    [candidates, selectedId]
  );

  const applyResumeDiscovery = (result: ResumeDiscovery) => {
    setResumableBackups(result.backups);
    setResumeSessionPath(result.sessionPath);
    const selectedBackup = result.backups.find(
      (candidate) => candidate.manifestPath === result.selectedManifestPath
    );
    setSelectedBackupManifest(selectedBackup?.manifestPath ?? '');
    if (!selectedBackup) {
      setBackup(null);
      setReport(null);
      setDeletionSafetyCurrent(false);
      setResumeStatus(result.backups.some((candidate) => candidate.status.includes('.partial'))
        ? 'Incomplete .partial backup found. No reusable backup found.'
        : 'No reusable backup found.');
      return;
    }
    if (selectedBackup.fastValidationPassed) {
      setBackup(selectedBackup);
      setReport(selectedBackup.report);
      setDeletionSafetyCurrent(Boolean(selectedBackup.report));
      setResumeStatus(selectedBackup.report
        ? 'Recovery report found. Recovery can resume.'
        : 'Existing verified backup found. Reusing without copying source data.');
      setProgress({
        phase: selectedBackup.report ? 'report-resumed' : 'backup-resumed',
        message: selectedBackup.report
          ? 'Recovery report found. Recovery can resume.'
          : 'Fast validation passed. Existing verified backup found.',
        recordsScanned: selectedBackup.report?.recordsScanned,
        projectsRecovered: selectedBackup.report?.projectsRecovered,
      });
      if (selectedBackup.lastFailure && !selectedBackup.report) {
        setError(`Previous recovery attempt failed: ${selectedBackup.lastFailure} Audit log: ${selectedBackup.auditLogPath}`);
      }
    } else {
      setBackup(selectedBackup);
      setReport(null);
      setDeletionSafetyCurrent(false);
      setResumeStatus('Backup changed since verification. Full re-verification is required.');
    }
  };

  const discoverExistingBackups = async (
    candidate: RecoveryCandidate,
    preferredManifest?: string | null
  ) => {
    setResumeStatus('Searching for existing verified backups…');
    setBusy('resume');
    try {
      const result = await recoveryClient.discoverBackups(
        candidate.id,
        [backupDestination, exportDestination],
        preferredManifest
      );
      applyResumeDiscovery(result);
    } catch (caught) {
      setBackup(null);
      setReport(null);
      setDeletionSafetyCurrent(false);
      setResumeStatus('No reusable backup found.');
      setError(recoveryErrorMessage(caught, 'Existing backup discovery failed.'));
    } finally {
      setBusy(null);
    }
  };

  const detect = async () => {
    if (!desktopAvailable) return;
    setBusy('detect');
    setError(null);
    try {
      const result = await recoveryClient.detect();
      setApplicationAuditPath(result.auditLogPath);
      setCandidates(result.candidates);
      const detected = result.candidates.find((candidate) => candidate.id === selectedId)
        ?? result.candidates[0]
        ?? null;
      setSelectedId(detected?.id ?? '');
      if (detected) {
        await discoverExistingBackups(detected, selectedBackupManifest || null);
      }
      if (result.candidates.length === 0 && !cleanup) {
        setError('No localhost:5174 Design Space IndexedDB directory was detected in supported Chrome or Chromium profiles.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Browser storage detection failed.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void detect();
    // Detection intentionally runs once; Refresh handles browser closure/profile changes.
  }, [desktopAvailable]);

  useEffect(() => {
    if (!desktopAvailable) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const removeListener = await listen<ProgressState>('design-space-recovery-progress', (event) => {
        setProgress(event.payload);
      });
      if (disposed) removeListener();
      else unlisten = removeListener;
    }).catch((caught) => {
      const message = recoveryErrorMessage(caught, 'Recovery progress events could not be attached.');
      console.error('[Design Space recovery] progress listener failed', caught);
      if (!disposed) setError(message);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktopAvailable]);

  const inspectDestination = async () => {
    if (!selected) return;
    setError(null);
    try {
      setDestination(await recoveryClient.inspectDestination(selected.id, backupDestination));
      await discoverExistingBackups(selected, selectedBackupManifest || null);
    } catch (caught) {
      setDestination(null);
      setError(caught instanceof Error ? caught.message : 'Destination inspection failed.');
    }
  };

  const createBackup = async () => {
    if (!selected || !destination?.sufficientSpace) return;
    const jobId = recoveryJobId('backup');
    setActiveJobId(jobId);
    setBusy('backup');
    setError(null);
    setProgress({ phase: 'backup', message: 'Copying and hashing the exact origin database…' });
    try {
      const result = await recoveryClient.createBackup(selected.id, destination.destinationPath, jobId);
      const verification = await recoveryClient.verifyBackup(result.manifestPath);
      if (!verification.valid) throw new Error('The copied database did not pass integrity verification.');
      setBackup(result);
      setResumableBackups([]);
      setSelectedBackupManifest(result.manifestPath);
      setResumeStatus('Backup verified byte-for-byte. Recovery can continue.');
      setDeletionSafetyCurrent(false);
      setProgress({ phase: 'backup-complete', message: 'Backup verified byte-for-byte.' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backup failed. The original database was not changed.');
    } finally {
      setActiveJobId(null);
      setBusy(null);
    }
  };

  const selectExistingBackup = async () => {
    if (!selected || !selectedBackupManifest) {
      setError('Choose a valid existing backup before continuing.');
      return;
    }
    setError(null);
    await discoverExistingBackups(selected, selectedBackupManifest);
  };

  const reverifyBackup = async () => {
    if (!backup?.manifestPath) return;
    setBusy('resume');
    setError(null);
    setProgress({ phase: 'reverify-backup', message: 'Re-verifying every backup file with SHA-256…' });
    try {
      await yieldForRecoveryStatusPaint();
      const verification = await recoveryClient.verifyBackup(backup.manifestPath);
      if (!verification.valid) throw new Error('The backup failed full SHA-256 verification.');
      const verified = { ...backup, verified: true };
      setBackup(verified);
      setResumableBackups((current) => current.map((candidate) => (
        candidate.manifestPath === backup.manifestPath
          ? {
              ...candidate,
              verified: true,
              fastValidationPassed: true,
              requiresFullVerification: false,
              status: 'Full SHA-256 re-verification passed',
            }
          : candidate
      )));
      setResumeStatus('Full SHA-256 re-verification passed. Recovery can resume.');
      setProgress({ phase: 'reverify-complete', message: 'Full SHA-256 re-verification passed.' });
      setDeletionSafetyCurrent(Boolean(report));
    } catch (caught) {
      setReport(null);
      setDeletionSafetyCurrent(false);
      setError(recoveryErrorMessage(caught, 'Backup re-verification failed.'));
    } finally {
      setBusy(null);
    }
  };

  const recoverProjects = async () => {
    console.info('[Design Space recovery] recover button handler started', {
      command: RECOVERY_EXTRACT_COMMAND,
    });
    if (recoveryInFlight.current) {
      console.info('[Design Space recovery] duplicate recover click ignored');
      return;
    }
    if (!backup?.verified || !backup.manifestPath) {
      setError('A verified backup is required before project recovery can start.');
      setReport(null);
      return;
    }
    recoveryInFlight.current = true;
    const jobId = recoveryJobId('extract');
    setActiveJobId(jobId);
    setBusy('extract');
    setError(null);
    setReport(null);
    setDeletionSafetyCurrent(false);
    setProgress({ phase: 'validate-backup', message: 'Validating the verified backup…' });
    try {
      // Yield one frame so WebKit paints the running state before IPC begins.
      await yieldForRecoveryStatusPaint();
      const recovered = await recoveryClient.extract(backup.manifestPath, exportDestination, jobId);
      if (!recovered.reportPath || !Number.isFinite(recovered.projectsRecovered)) {
        throw new Error('The extractor returned an invalid recovery report. Cleanup remains locked.');
      }
      setReport(recovered);
      setDeletionSafetyCurrent(true);
      setProgress({
        phase: 'complete',
        message: `Recovery complete: ${recovered.projectsRecovered} portable project${recovered.projectsRecovered === 1 ? '' : 's'} exported.`,
        recordsScanned: recovered.recordsScanned,
        projectsRecovered: recovered.projectsRecovered,
      });
    } catch (caught) {
      const auditPath = backup.auditLogPath || applicationAuditPath;
      const detail = recoveryErrorMessage(caught, 'Recovery failed. The verified backup remains intact.');
      setError(`${detail}${auditPath && !detail.includes(auditPath) ? ` Detailed audit log: ${auditPath}` : ''}`);
      setProgress({ phase: 'failed', message: 'Recovery failed. Review the error and retry when ready.' });
    } finally {
      recoveryInFlight.current = false;
      setActiveJobId(null);
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!activeJobId) return;
    try {
      await recoveryClient.cancel(activeJobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cancellation could not be requested.');
    }
  };

  const deleteOriginal = async () => {
    if (!selected || !backup || !report || !deletionSafetyCurrent || confirmation !== RECOVERY_DELETE_CONFIRMATION) return;
    setBusy('delete');
    setError(null);
    try {
      const result = await recoveryClient.deleteOriginal(selected.id, backup.manifestPath, confirmation);
      setCleanup(result);
      acknowledgeSuccessfulStorageCleanup();
      setCandidates((current) => current.filter((candidate) => candidate.id !== selected.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cleanup failed. Recovery mode remains active.');
    } finally {
      setBusy(null);
    }
  };

  if (!desktopAvailable && !startupBlocked) return null;

  if (!desktopAvailable) {
    return (
      <div className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-100/10 p-5" data-testid="recovery-desktop-required">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <strong className="text-[color:var(--ui-text)]">Open the Design Space desktop recovery workspace</strong>
            <p className="mt-1 text-sm leading-6">
              Browser JavaScript is deliberately not allowed to copy or delete profile files. The desktop application provides the constrained recovery backend; this Chrome tab will continue to avoid the oversized database.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!startupBlocked && busy !== 'detect' && candidates.length === 0 && !cleanup) return null;

  return (
    <div className="mt-4 grid gap-4" data-testid="recovery-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-100/10 p-4">
        <div>
          <strong className="text-[color:var(--ui-text)]">Design Space browser-library recovery</strong>
          <p className="mt-1 text-sm">The original database remains read-only until the final typed-confirmation step.</p>
        </div>
        <button type="button" onClick={() => void detect()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--ui-border)] px-3 py-2 font-semibold" data-testid="recovery-refresh">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh detection
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/35 bg-red-100/10 px-4 py-3 text-sm text-[color:var(--ui-text)]" role="alert" data-testid="recovery-error">
          <XCircle className="mr-2 inline h-4 w-4 text-red-600" aria-hidden="true" />{error}
        </div>
      )}

      <Step number={1} title="Inspect browser storage" complete={Boolean(selected)}>
        {selected ? (
          <div className="grid gap-2">
            <label className="font-semibold text-[color:var(--ui-text)]" htmlFor="recovery-database">Detected browser profile</label>
            <select id="recovery-database" value={selected.id} onChange={(event) => {
              const next = candidates.find((candidate) => candidate.id === event.target.value) ?? null;
              setSelectedId(event.target.value);
              setDestination(null);
              setBackup(null);
              setReport(null);
              setResumableBackups([]);
              setDeletionSafetyCurrent(false);
              if (next) void discoverExistingBackups(next);
            }} className="rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-3 py-2" data-testid="recovery-candidate-select">
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.browser} — {candidate.profile} — {formatBytes(candidate.sizeBytes)}</option>)}
            </select>
            <dl className="grid gap-1 rounded-xl bg-[color:var(--ui-surface-soft)] p-3 text-xs">
              <div><dt className="inline font-semibold">Origin: </dt><dd className="inline">{selected.origin}</dd></div>
              <div><dt className="inline font-semibold">LevelDB: </dt><dd className="inline break-all" data-testid="recovery-database-path">{selected.databasePath}</dd></div>
              {selected.blobPath && <div><dt className="inline font-semibold">Blob data: </dt><dd className="inline break-all">{selected.blobPath}</dd></div>}
              <div><dt className="inline font-semibold">Measured size: </dt><dd className="inline">{formatBytes(selected.sizeBytes)} across {selected.fileCount} files</dd></div>
              <div><dt className="inline font-semibold">Browser status: </dt><dd className={`inline font-semibold ${selected.browserRunning ? 'text-red-600' : 'text-emerald-700'}`}>{selected.browserRunning ? 'Running — backup and deletion are refused' : 'Closed'}</dd></div>
              {applicationAuditPath && <div><dt className="inline font-semibold">Recovery audit: </dt><dd className="inline break-all">{applicationAuditPath}</dd></div>}
            </dl>
          </div>
        ) : <p>{busy === 'detect' ? 'Inspecting supported Chrome and Chromium profiles…' : 'No exact localhost:5174 database selected.'}</p>}
      </Step>

      <Step number={2} title="Choose backup destination" complete={Boolean(destination?.sufficientSpace)}>
        <label htmlFor="recovery-backup-destination" className="font-semibold text-[color:var(--ui-text)]">Absolute destination folder</label>
        <div className="mt-2 flex flex-col gap-2 md:flex-row">
          <input id="recovery-backup-destination" value={backupDestination} onChange={(event) => { setBackupDestination(event.target.value); setDestination(null); }} className="min-w-0 flex-1 rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-3 py-2" data-testid="recovery-backup-destination" />
          <button type="button" onClick={() => void inspectDestination()} disabled={!selected || busy !== null} className="rounded-xl bg-[color:var(--brand-primary)] px-4 py-2 font-semibold text-white" data-testid="recovery-check-space">Check space</button>
        </div>
        {destination && (
          <p className={`mt-2 font-semibold ${destination.sufficientSpace ? 'text-emerald-700' : 'text-red-600'}`} data-testid="recovery-space-status">
            {formatBytes(destination.availableBytes)} available; {formatBytes(destination.requiredBytes)} required including verification headroom.
          </p>
        )}
      </Step>

      <Step number={3} title="Close the selected browser profile" complete={Boolean(selected && !selected.browserRunning)}>
        <p>Recovery checks both Linux process command lines and the browser profile lock PID. Refresh detection after closing Chrome or Chromium.</p>
      </Step>

      <Step number={4} title="Create and verify backup" complete={Boolean(backup?.verified)}>
        <p className="mb-3 font-semibold" aria-live="polite" data-testid="recovery-resume-status">
          {busy === 'resume' ? 'Searching for existing verified backups…' : resumeStatus}
        </p>
        {resumableBackups.length > 0 && (
          <div className="mb-3 grid gap-2 rounded-xl bg-[color:var(--ui-surface-soft)] p-3">
            <label htmlFor="recovery-existing-backup" className="font-semibold text-[color:var(--ui-text)]">Existing recovery backups</label>
            <select
              id="recovery-existing-backup"
              value={selectedBackupManifest}
              onChange={(event) => setSelectedBackupManifest(event.target.value)}
              className="rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] px-3 py-2"
              data-testid="recovery-existing-backup"
            >
              {resumableBackups.map((candidate) => (
                <option
                  key={candidate.id}
                  value={candidate.fastValidationPassed || candidate.requiresFullVerification ? candidate.manifestPath : ''}
                  disabled={!candidate.fastValidationPassed && !candidate.requiresFullVerification}
                >
                  {candidate.createdAt ?? 'Unknown date'} — {formatBytes(candidate.totalBytes)} — {candidate.status}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void selectExistingBackup()} disabled={!selectedBackupManifest || busy !== null} className="rounded-xl bg-[color:var(--brand-primary)] px-4 py-2 font-semibold text-white disabled:opacity-45" data-testid="recovery-use-backup">
                Use this verified backup
              </button>
              {backup?.requiresFullVerification && (
                <button type="button" onClick={() => void reverifyBackup()} disabled={busy !== null} className="rounded-xl border border-[color:var(--ui-border)] px-4 py-2 font-semibold" data-testid="recovery-reverify-backup">
                  Re-verify backup
                </button>
              )}
            </div>
            {resumableBackups.filter((candidate) => candidate.rejectionReason).map((candidate) => (
              <p key={`${candidate.id}-rejection`} className="text-xs text-red-700">
                {candidate.status}: {candidate.rejectionReason}
              </p>
            ))}
            {resumeSessionPath && <p className="break-all text-xs"><strong>Recovery session:</strong> {resumeSessionPath}</p>}
          </div>
        )}
        {!resumableBackups.some((candidate) => candidate.fastValidationPassed) && (
          <button type="button" onClick={() => void createBackup()} disabled={!selected || selected.browserRunning || !destination?.sufficientSpace || busy !== null} className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand-primary)] px-4 py-2 font-semibold text-white disabled:opacity-45" data-testid="recovery-create-backup">
            <Archive className="h-4 w-4" aria-hidden="true" /> {busy === 'backup' ? 'Backing up and verifying…' : 'Create verified backup'}
          </button>
        )}
        {backup && <div className="mt-3 rounded-xl bg-[color:var(--ui-surface-soft)] p-3 text-xs"><p><strong>Verified backup:</strong> <span className="break-all">{backup.backupPath}</span></p><p><strong>Integrity:</strong> {backup.fileCount} files, {formatBytes(backup.totalBytes)}, SHA-256 verified</p><p><strong>Audit log:</strong> <span className="break-all">{backup.auditLogPath}</span></p></div>}
      </Step>

      <Step number={5} title="Recover projects from the verified copy" complete={Boolean(report)}>
        {!backup?.verified && (
          <p className="mb-3 font-semibold text-amber-700" role="status" data-testid="recovery-extract-precondition">
            A verified backup is required before project recovery can start.
          </p>
        )}
        <label htmlFor="recovery-export-destination" className="font-semibold text-[color:var(--ui-text)]">Portable export destination</label>
        <input id="recovery-export-destination" value={exportDestination} onChange={(event) => setExportDestination(event.target.value)} className="mt-2 w-full rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-3 py-2" data-testid="recovery-export-destination" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void recoverProjects()} disabled={!backup?.verified || busy !== null} className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand-primary)] px-4 py-2 font-semibold text-white disabled:opacity-45" data-testid="recovery-extract">
            <FolderSearch className="h-4 w-4" aria-hidden="true" /> {busy === 'extract' ? 'Recovering…' : 'Recover portable projects'}
          </button>
          {activeJobId && <button type="button" onClick={() => void cancel()} className="rounded-xl border border-[color:var(--ui-border)] px-4 py-2 font-semibold" data-testid="recovery-cancel">Cancel safely</button>}
        </div>
        {(busy === 'extract' || progress.message) && <p className="mt-3" aria-live="polite" data-testid="recovery-progress">{progress.message || progress.phase} {progress.recordsScanned !== undefined ? `— ${progress.recordsScanned} records scanned` : ''}</p>}
      </Step>

      <Step number={6} title="Review recovery report" complete={Boolean(report)}>
        {report ? (
          <div data-testid="recovery-report">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ['Records scanned', report.recordsScanned], ['Projects found', report.projectsFound],
                ['Recovered', report.projectsRecovered], ['Skipped', report.projectsSkipped],
                ['Corrupt records', report.corruptRecords], ['Duplicate revisions', report.duplicateRevisionsRemoved],
                ['Assets deduplicated', report.assetsDeduplicated], ['Export size', formatBytes(report.recoveredExportBytes)],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[color:var(--ui-surface-soft)] p-3"><span className="block text-xs uppercase tracking-wide">{label}</span><strong className="text-lg text-[color:var(--ui-text)]">{value}</strong></div>)}
            </div>
            <p className="mt-3"><strong>Original backup:</strong> {formatBytes(report.originalBackupBytes)} · <strong>Recovered exports:</strong> {formatBytes(report.recoveredExportBytes)}</p>
            <p><strong>Full report:</strong> <span className="break-all">{report.reportPath}</span></p>
            <div className="mt-3 max-h-60 overflow-auto rounded-xl border border-[color:var(--ui-border)]">
              {report.projects.map((project) => (
                <div key={project.path} className="border-b border-[color:var(--ui-border)] p-3 last:border-b-0">
                  <strong className="text-[color:var(--ui-text)]">{project.name}</strong>
                  <p className="break-all text-xs">{project.path}</p>
                  <p className="text-xs">{project.complete ? 'Complete portable export' : 'Partial export'} · {formatBytes(project.bytes)} · {project.assetsDeduplicated} duplicate assets removed</p>
                  {project.usedOlderRevisionBecauseNewerWasCorrupt && <p className="text-xs font-semibold text-amber-700">Recovered an older valid revision because a newer revision was corrupt.</p>}
                </div>
              ))}
            </div>
          </div>
        ) : <p>The report will list every recovered export, corrupt record, skipped project, duplicate revision, and asset reduction.</p>}
      </Step>

      <Step number={7} title="Test recovered project files" complete={Boolean(report && report.projectsRecovered > 0)}>
        <p><FileCheck2 className="mr-2 inline h-4 w-4" aria-hidden="true" />Every export passed current schema migration and validation. Use the existing <strong>Open Product Project</strong> action to perform an editor import test before cleanup. The verified backup remains unchanged.</p>
      </Step>

      <Step number={8} title="Delete only the original origin database" complete={Boolean(cleanup?.sourceAbsent)}>
        <div className="rounded-xl border-2 border-red-600/60 bg-red-100/10 p-4">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" /><p><strong className="text-red-700">Destructive cleanup.</strong> This removes only the exact LevelDB and blob paths displayed in step 1. The verified backup and recovered exports are preserved.</p></div>
          <label htmlFor="recovery-delete-confirmation" className="mt-3 block font-semibold text-[color:var(--ui-text)]">Type <code>{RECOVERY_DELETE_CONFIRMATION}</code></label>
          <input id="recovery-delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border-2 border-red-500 bg-[color:var(--ui-panel)] px-3 py-2" autoComplete="off" data-testid="recovery-delete-confirmation" />
          <button type="button" onClick={() => void deleteOriginal()} disabled={!report || !backup?.verified || !deletionSafetyCurrent || confirmation !== RECOVERY_DELETE_CONFIRMATION || busy !== null || selected?.browserRunning} className="mt-3 rounded-xl bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-40" data-testid="recovery-delete-original">
            {busy === 'delete' ? 'Verifying backup and deleting exact origin…' : 'Delete original localhost:5174 database'}
          </button>
        </div>
      </Step>

      <Step number={9} title="Confirm normal storage mode" complete={Boolean(cleanup?.sourceAbsent)}>
        {cleanup ? (
          <div data-testid="recovery-cleanup-complete">
            <p><HardDrive className="mr-2 inline h-4 w-4" aria-hidden="true" />Removed {formatBytes(cleanup.logicalBytesReclaimed)} of selected origin data. Filesystem free space changed from {formatBytes(cleanup.freeBytesBefore)} to {formatBytes(cleanup.freeBytesAfter)}.</p>
            <p><strong>Backup preserved:</strong> <span className="break-all">{cleanup.backupPreservedAt}</span></p>
            <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white" data-testid="recovery-reload">Reload Design Space and create a fresh library</button>
          </div>
        ) : <p>The backend will recheck that the exact origin paths are absent, report reclaimed space, retain the backup, and only then allow recovery mode to be cleared.</p>}
      </Step>

      {!startupBlocked && !selected && cleanup && <p className="rounded-xl bg-emerald-100/20 p-3 font-semibold text-emerald-700"><Database className="mr-2 inline h-4 w-4" />No oversized legacy origin remains.</p>}
    </div>
  );
};
