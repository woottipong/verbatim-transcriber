import { getControlAuthHeaders, toHttpUrl } from './runtime.ts';

export interface AiProofreadRequest {
  requestId: string;
  revision: number;
  targetText: string;
  contextText?: string;
}

export interface AiProofreadResponse {
  requestId: string;
  revision: number;
  suggestedText: string;
  changed: boolean;
}

const AI_AUTO_STORAGE_KEY = 'captionlive.caption-desk.ai-auto-enabled';

export function loadPersistedAiAutoEnabled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const val = window.localStorage.getItem(AI_AUTO_STORAGE_KEY);
    return val === null ? false : val === 'true';
  } catch {
    return false;
  }
}

export function savePersistedAiAutoEnabled(enabled: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(AI_AUTO_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

export async function requestAiProofread(
  backendUrl: string,
  request: AiProofreadRequest,
  signal?: AbortSignal,
): Promise<AiProofreadResponse> {
  if (!request.targetText.trim()) {
    return {
      requestId: request.requestId,
      revision: request.revision,
      suggestedText: request.targetText,
      changed: false,
    };
  }

  const endpoint = `${toHttpUrl(backendUrl).replace(/\/$/, '')}/api/caption-desk/ai-proofread`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getControlAuthHeaders(),
    },
    body: JSON.stringify(request),
    signal,
  });

  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === 'string'
      ? data.error
      : `AI proofreading failed (${response.status})`;
    throw new Error(message);
  }
  if (!isAiProofreadResponse(data)) {
    throw new Error('AI proofreading returned an invalid response');
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAiProofreadResponse(value: unknown): value is AiProofreadResponse {
  return isRecord(value)
    && typeof value.requestId === 'string'
    && typeof value.revision === 'number'
    && Number.isFinite(value.revision)
    && typeof value.suggestedText === 'string'
    && typeof value.changed === 'boolean';
}
