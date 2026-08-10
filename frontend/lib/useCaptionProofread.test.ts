import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCaptionProofread } from '../hooks/useCaptionProofread.ts';

interface HarnessProps {
  reviewText: string;
  sourceSegmentIds: string[];
  onApply: (text: string) => void;
  onState?: (state: ReturnType<typeof useCaptionProofread>) => void;
}

function installBrowserGlobals() {
  const storage = new Map<string, string>([['captionlive.caption-desk.ai-auto-enabled', 'true']]);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

function Harness(props: HarnessProps) {
  const state = useCaptionProofread({
    backendUrl: 'http://backend.test',
    availability: 'enabled',
    reviewText: props.reviewText,
    sourceSegmentIds: props.sourceSegmentIds,
    onApply: props.onApply,
  });
  props.onState?.(state);
  return null;
}

function suppressRendererDeprecation(t: { after: (fn: () => void) => void }) {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated')) return;
    originalError(...args);
  };
  t.after(() => { console.error = originalError; });
}

test('resets the idle timer when another final is appended', async t => {
  suppressRendererDeprecation(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  installBrowserGlobals();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = JSON.parse(String(init?.body)) as { requestId: string; revision: number; targetText: string };
    return new Response(JSON.stringify({
      requestId: request.requestId,
      revision: request.revision,
      suggestedText: request.targetText,
      changed: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  let renderer: ReactTestRenderer;
  const onApply = () => undefined;
  try {
    await act(async () => {
      renderer = create(createElement(Harness, { reviewText: '', sourceSegmentIds: [], onApply }));
    });
    await act(async () => {
      renderer.update(createElement(Harness, { reviewText: 'หนึ่ง', sourceSegmentIds: ['s1'], onApply }));
    });
    await act(async () => t.mock.timers.tick(600));
    await act(async () => {
      renderer.update(createElement(Harness, { reviewText: 'หนึ่งสอง', sourceSegmentIds: ['s1', 's2'], onApply }));
    });
    await act(async () => t.mock.timers.tick(1_199));
    assert.equal(requests, 0);
    await act(async () => t.mock.timers.tick(1));
    assert.equal(requests, 1);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('flushes at the hard ceiling while finals keep arriving', async t => {
  suppressRendererDeprecation(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  installBrowserGlobals();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = JSON.parse(String(init?.body)) as { requestId: string; revision: number; targetText: string };
    return new Response(JSON.stringify({
      requestId: request.requestId, revision: request.revision,
      suggestedText: request.targetText, changed: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  let renderer: ReactTestRenderer;
  const onApply = () => undefined;
  try {
    await act(async () => {
      renderer = create(createElement(Harness, { reviewText: '', sourceSegmentIds: [], onApply }));
    });
    await act(async () => {
      renderer.update(createElement(Harness, { reviewText: 'หนึ่ง', sourceSegmentIds: ['s1'], onApply }));
    });
    for (let index = 2; index <= 5; index += 1) {
      await act(async () => t.mock.timers.tick(500));
      await act(async () => {
        renderer.update(createElement(Harness, {
          reviewText: 'หนึ่ง'.repeat(index),
          sourceSegmentIds: Array.from({ length: index }, (_, item) => `s${item + 1}`),
          onApply,
        }));
      });
    }
    await act(async () => t.mock.timers.tick(499));
    assert.equal(requests, 0);
    await act(async () => t.mock.timers.tick(1));
    assert.equal(requests, 1);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('flushes immediately when pending text reaches 320 graphemes', async t => {
  suppressRendererDeprecation(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  installBrowserGlobals();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const request = JSON.parse(String(init?.body)) as { requestId: string; revision: number; targetText: string };
    return new Response(JSON.stringify({
      requestId: request.requestId, revision: request.revision,
      suggestedText: request.targetText, changed: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  let renderer: ReactTestRenderer;
  const onApply = () => undefined;
  try {
    await act(async () => {
      renderer = create(createElement(Harness, { reviewText: '', sourceSegmentIds: [], onApply }));
    });
    await act(async () => {
      renderer.update(createElement(Harness, {
        reviewText: 'ก'.repeat(320), sourceSegmentIds: ['s1'], onApply,
      }));
    });
    await act(async () => t.mock.timers.tick(0));
    assert.equal(requests, 1);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('publishing aborts in-flight work and records a safe stale discard', async t => {
  suppressRendererDeprecation(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  installBrowserGlobals();
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const logs: unknown[][] = [];
  console.info = (...args: unknown[]) => logs.push(args);
  let requestSignal: AbortSignal | undefined;
  let resolveRequest: ((response: Response) => void) | undefined;
  globalThis.fetch = async (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(resolve => { resolveRequest = resolve; });
  };

  let renderer: ReactTestRenderer;
  const applied: string[] = [];
  const onApply = (text: string) => applied.push(text);
  try {
    await act(async () => {
      renderer = create(createElement(Harness, { reviewText: '', sourceSegmentIds: [], onApply }));
    });
    await act(async () => {
      renderer.update(createElement(Harness, { reviewText: 'ข้อความเดิม', sourceSegmentIds: ['s1'], onApply }));
    });
    await act(async () => t.mock.timers.tick(1_200));
    assert.ok(requestSignal);

    await act(async () => {
      renderer.update(createElement(Harness, { reviewText: '', sourceSegmentIds: ['s1'], onApply }));
    });
    assert.equal(requestSignal.aborted, true);

    await act(async () => {
      resolveRequest?.(new Response(JSON.stringify({
        requestId: 'stale', revision: 1, suggestedText: 'ข้อความที่ไม่ควรกลับมา', changed: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
    });
    assert.deepEqual(applied, []);
    assert.equal(logs.some(args => String(args[0]).includes('stale_discard')), true);
    assert.equal(logs.some(args => args.some(value => String(value).includes('ข้อความเดิม'))), false);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  }
});

test('keeps one transient AI failure quiet without changing text', async t => {
  suppressRendererDeprecation(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  installBrowserGlobals();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'Too many proofreading requests. Try again shortly.' }),
    { status: 429, headers: { 'Content-Type': 'application/json' } },
  );

  let renderer: ReactTestRenderer;
  let latestState: ReturnType<typeof useCaptionProofread> | undefined;
  const applied: string[] = [];
  try {
    await act(async () => {
      renderer = create(createElement(Harness, {
        reviewText: '', sourceSegmentIds: [], onApply: text => applied.push(text),
        onState: state => { latestState = state; },
      }));
    });
    await act(async () => {
      renderer.update(createElement(Harness, {
        reviewText: 'ข้อความ', sourceSegmentIds: ['s1'], onApply: text => applied.push(text),
        onState: state => { latestState = state; },
      }));
    });
    await act(async () => {
      t.mock.timers.tick(1_200);
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.deepEqual(applied, []);
    assert.equal(latestState?.notice, null);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('shows one calm warning after three consecutive AI failures', async t => {
  suppressRendererDeprecation(t);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
  installBrowserGlobals();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response('{}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  let renderer: ReactTestRenderer;
  let latestState: ReturnType<typeof useCaptionProofread> | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(Harness, {
        reviewText: '', sourceSegmentIds: [], onApply: () => undefined,
        onState: state => { latestState = state; },
      }));
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await act(async () => {
        renderer.update(createElement(Harness, {
          reviewText: 'ข้อความ'.repeat(attempt),
          sourceSegmentIds: Array.from({ length: attempt }, (_, index) => `s${index}`),
          onApply: () => undefined,
          onState: state => { latestState = state; },
        }));
      });
      await act(async () => {
        t.mock.timers.tick(1_200);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    assert.equal(latestState?.notice?.tone, 'warning');
    assert.equal(latestState?.notice?.message, 'AI ตรวจแก้คำหยุดทำงานชั่วคราว ข้อความเดิมยังอยู่ครบ');
    assert.equal(latestState?.autoEnabled, false);
    assert.equal(requests, 3);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
  }
});
