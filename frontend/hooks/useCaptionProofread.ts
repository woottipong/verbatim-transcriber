import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyProofreadResult,
  createProofreadBatch,
  getAppendedSuffix,
  PROOFREAD_HARD_FLUSH_MS,
  PROOFREAD_IDLE_MS,
  shouldFlushProofread,
  type ProofreadBatch,
} from '../lib/captionProofread.ts';
import {
  loadPersistedAiAutoEnabled,
  requestAiProofread,
  savePersistedAiAutoEnabled,
} from '../lib/aiProofread.ts';

export type ProofreadAvailability = 'enabled' | 'disabled' | 'unknown';

export interface ProofreadNotice {
  id: string;
  tone: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  message: string;
}

interface UseCaptionProofreadOptions {
  backendUrl: string;
  availability: ProofreadAvailability;
  reviewText: string;
  sourceSegmentIds: string[];
  previousPublishedText?: string;
  onApply: (text: string) => void;
}

export function useCaptionProofread({
  backendUrl,
  availability,
  reviewText,
  sourceSegmentIds,
  previousPublishedText = '',
  onApply,
}: UseCaptionProofreadOptions) {
  const persistedEnabledRef = useRef(loadPersistedAiAutoEnabled());
  const [autoEnabled, setAutoEnabled] = useState(() => availability === 'enabled' && persistedEnabledRef.current);
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState<ProofreadNotice | null>(null);

  const reviewTextRef = useRef(reviewText);
  const backendUrlRef = useRef(backendUrl);
  const onApplyRef = useRef(onApply);
  const previousPublishedTextRef = useRef(previousPublishedText);
  const sourceKeyRef = useRef(sourceSegmentIds.join('\u0000'));
  const baselineTextRef = useRef(reviewText);
  const pendingStartRef = useRef<number | null>(null);
  const pendingStartedAtRef = useRef<number | null>(null);
  const pendingLastAppendedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<ProofreadBatch | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scheduleRef = useRef<(() => void) | null>(null);
  const revisionRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);

  reviewTextRef.current = reviewText;
  backendUrlRef.current = backendUrl;
  onApplyRef.current = onApply;
  previousPublishedTextRef.current = previousPublishedText;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const resetPending = useCallback(() => {
    clearTimer();
    pendingStartRef.current = null;
    pendingStartedAtRef.current = null;
    pendingLastAppendedAtRef.current = null;
  }, [clearTimer]);

  const cancelActiveWork = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = null;
    setIsProcessing(false);
    resetPending();
  }, [resetPending]);

  const flush = useCallback(async () => {
    if (availability !== 'enabled' || !autoEnabled || inFlightRef.current !== null) return;
    const start = pendingStartRef.current;
    if (start === null) return;

    const batch = createProofreadBatch(
      reviewTextRef.current,
      start,
      ++revisionRef.current,
      crypto.randomUUID(),
      previousPublishedTextRef.current,
    );
    resetPending();
    if (!batch) return;

    inFlightRef.current = batch;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);

    try {
      const result = await requestAiProofread(backendUrlRef.current, {
        requestId: batch.requestId,
        revision: batch.revision,
        targetText: batch.targetText,
        contextText: batch.contextText,
      }, controller.signal);
      consecutiveFailuresRef.current = 0;

      if (
        controller.signal.aborted
        || inFlightRef.current !== batch
        || result.requestId !== batch.requestId
        || result.revision !== batch.revision
      ) {
        reportStaleDiscard(batch, 'request_invalidated');
        return;
      }
      const currentText = reviewTextRef.current;
      const applied = applyProofreadResult(currentText, batch, result.suggestedText);
      if (applied === null) {
        reportStaleDiscard(batch, 'editor_changed');
        return;
      }

      reviewTextRef.current = applied;
      baselineTextRef.current = applied;
      onApplyRef.current(applied);

      const processedEnd = batch.start + result.suggestedText.length;
      if (processedEnd < applied.length) {
        pendingStartRef.current = processedEnd;
        pendingStartedAtRef.current = Date.now();
        pendingLastAppendedAtRef.current = pendingStartedAtRef.current;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current === 3) {
        setNotice({
          id: `proofread-warning-${Date.now()}`,
          tone: 'warning',
          message: 'AI Auto พักชั่วคราว ข้อความเดิมยังอยู่ครบ',
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (inFlightRef.current === batch) {
        inFlightRef.current = null;
        setIsProcessing(false);
      }
      scheduleRef.current?.();
    }
  }, [autoEnabled, availability, resetPending]);

  const schedule = useCallback(() => {
    if (timerRef.current !== null || pendingStartRef.current === null || inFlightRef.current !== null) return;
    const now = Date.now();
    const startedAt = pendingStartedAtRef.current ?? now;
    const lastAppendedAt = pendingLastAppendedAtRef.current ?? startedAt;
    pendingStartedAtRef.current = startedAt;
    pendingLastAppendedAtRef.current = lastAppendedAt;
    const hardElapsed = now - startedAt;
    const idleElapsed = now - lastAppendedAt;
    const pendingText = reviewTextRef.current.slice(pendingStartRef.current);
    const delay = shouldFlushProofread(pendingText, idleElapsed, hardElapsed)
      ? 0
      : Math.max(25, Math.min(
        PROOFREAD_IDLE_MS - idleElapsed,
        PROOFREAD_HARD_FLUSH_MS - hardElapsed,
      ));
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, delay);
  }, [flush]);
  scheduleRef.current = schedule;

  useEffect(() => {
    const sourceKey = sourceSegmentIds.join('\u0000');
    const previousKey = sourceKeyRef.current;
    const previousText = baselineTextRef.current;
    sourceKeyRef.current = sourceKey;

    if (sourceKey !== previousKey) {
      const appended = getAppendedSuffix(previousText, reviewText);
      if (appended !== null && availability === 'enabled' && autoEnabled) {
        const now = Date.now();
        if (pendingStartRef.current === null) pendingStartRef.current = previousText.length;
        if (pendingStartedAtRef.current === null) pendingStartedAtRef.current = now;
        pendingLastAppendedAtRef.current = now;
        clearTimer();
      } else {
        cancelActiveWork();
      }
      baselineTextRef.current = reviewText;
    } else if (!reviewText.startsWith(previousText)) {
      cancelActiveWork();
      baselineTextRef.current = reviewText;
    } else if (pendingStartRef.current === null && inFlightRef.current === null) {
      baselineTextRef.current = reviewText;
    }

    schedule();
  }, [autoEnabled, availability, cancelActiveWork, clearTimer, reviewText, schedule, sourceSegmentIds]);

  useEffect(() => {
    if (availability === 'enabled') {
      if (!autoEnabled && persistedEnabledRef.current) setAutoEnabled(true);
      return;
    }
    if (autoEnabled) {
      setAutoEnabled(false);
    }
    cancelActiveWork();
  }, [autoEnabled, availability, cancelActiveWork]);

  useEffect(() => () => {
    clearTimer();
    abortRef.current?.abort();
  }, [clearTimer]);

  const toggleAuto = useCallback(() => {
    if (availability !== 'enabled') return;
    const next = !autoEnabled;
    setAutoEnabled(next);
    persistedEnabledRef.current = next;
    savePersistedAiAutoEnabled(next);
    if (!next) {
      cancelActiveWork();
    }
  }, [autoEnabled, availability, cancelActiveWork]);

  return {
    autoEnabled,
    toggleAuto,
    isProcessing,
    notice,
    dismissNotice: () => setNotice(null),
  };
}

function reportStaleDiscard(batch: ProofreadBatch, reason: 'request_invalidated' | 'editor_changed'): void {
  console.info('[CaptionProofread] stale_discard', {
    requestId: batch.requestId,
    revision: batch.revision,
    reason,
  });
}
