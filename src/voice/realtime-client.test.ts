import { describe, expect, it } from 'vitest';
import {
  ACTIVE_THREAD_ID,
  NOW,
  OTHER_THREAD_ID,
  FakeTrack,
  connect,
  createHarness,
  emitProviderEvent,
  makeTurn,
  startContext,
} from './realtime-client.test-support';

async function flushVoiceQueue(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('createRealtimeVoiceController', () => {
  it('requests a Specular credential before microphone access and posts SDP with only the ephemeral secret', async () => {
    const harness = createHarness();

    await harness.controller.start(startContext());

    expect(harness.order).toEqual(['credential', 'microphone', 'peer', 'sdp']);
    expect(harness.fetchCalls).toHaveLength(2);
    expect(harness.fetchCalls[0]).toMatchObject({
      input: '/api/realtime/session',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    });
    expect(harness.fetchCalls[1]).toMatchObject({
      input: 'https://api.openai.com/v1/realtime/calls',
      init: {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-secret',
          'Content-Type': 'application/sdp',
        },
        body: 'local-offer-sdp',
      },
    });
    expect(harness.fetchCalls[0]?.init?.signal).toBe(harness.abortControllers[0]?.signal);
    expect(harness.fetchCalls[1]?.init?.signal).toBe(harness.abortControllers[0]?.signal);
    expect(harness.peer.localDescription).toEqual({ sdp: 'local-offer-sdp', type: 'offer' });
    expect(harness.peer.remoteDescription).toEqual({ sdp: 'remote-answer-sdp', type: 'answer' });
    expect(harness.peer.addedTracks).toEqual([
      { stream: harness.localStream, track: harness.localTrack },
    ]);
    expect(harness.statuses).toEqual(['connecting']);

    harness.peer.dataChannel.emit('open');

    expect(harness.statuses).toEqual(['connecting', 'listening']);
    expect(JSON.stringify(harness.fetchCalls)).not.toContain('OPENAI_API_KEY');
  });

  it('seeds only bounded accepted user and assistant turns from the active thread', async () => {
    const harness = createHarness();
    const manyAccepted = Array.from({ length: 205 }, (_, index) => makeTurn({
      id: `turn-${String(index)}`,
      position: index,
      role: index % 2 === 0 ? 'user' : 'specular',
    }));
    const ignoredTurns = [
      makeTurn({ id: 'turn-pending', position: 300, role: 'user', deliveryState: 'pending' }),
      makeTurn({ id: 'turn-failed', position: 301, role: 'specular', deliveryState: 'failed' }),
      makeTurn({
        id: 'turn-other',
        position: 302,
        role: 'user',
        threadId: OTHER_THREAD_ID,
      }),
      makeTurn({ id: 'turn-system', position: 303, role: 'system' }),
    ];

    await connect(harness, {
      threadId: ACTIVE_THREAD_ID,
      turns: [...manyAccepted, ...ignoredTurns],
    });

    const sent = harness.peer.dataChannel.sent.map((value) => JSON.parse(value) as {
      item: { content: { text: string; type: string }[]; role: string };
      type: string;
    });
    expect(sent).toHaveLength(200);
    expect(sent.every((event) => event.type === 'conversation.item.create')).toBe(true);
    expect(sent[0]?.item.content[0]?.text).toBe('specular content 5');
    expect(sent.at(-1)?.item.content[0]?.text).toBe('user content 204');
    expect(sent.map((event) => event.item.role)).toContain('user');
    expect(sent.map((event) => event.item.role)).toContain('assistant');
    const serialized = JSON.stringify(sent);
    expect(serialized).not.toContain('turn-pending');
    expect(serialized).not.toContain('turn-failed');
    expect(serialized).not.toContain('turn-other');
    expect(serialized).not.toContain('turn-system');
  });

  it('mutes unvalidated provider audio and speaks only a persisted completed exchange', async () => {
    const harness = createHarness();
    const remoteTrack = new FakeTrack();
    await connect(harness);

    harness.peer.emit('track', { track: remoteTrack });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'user-item-1', type: 'message', role: 'user' },
      previous_item_id: null,
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'assistant-item-1', type: 'message', role: 'assistant' },
      previous_item_id: 'user-item-1',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'response-1', status: 'completed' },
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_audio_transcript.done',
      response_id: 'response-1',
      item_id: 'assistant-item-1',
      transcript: 'What becomes possible if the handoff is explicit?',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-item-1',
      transcript: 'The handoff keeps getting lost.',
    });
    await flushVoiceQueue();

    expect(harness.audio.playCount).toBe(0);
    expect(harness.audio.srcObject).toBeNull();
    expect(harness.remoteStream.getTracks()).toEqual([]);
    expect(harness.completed).toEqual([{
      threadId: ACTIVE_THREAD_ID,
      userTranscript: 'The handoff keeps getting lost.',
      assistantTranscript: 'What becomes possible if the handoff is explicit?',
    }]);
    expect(harness.spoken).toEqual(['What becomes possible if the handoff is explicit?']);

    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-item-1',
      transcript: 'The handoff keeps getting lost.',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_text.done',
      response_id: 'response-1',
      item_id: 'assistant-item-1',
      text: 'Duplicate alternate output?',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'response-1', status: 'completed' },
    });

    expect(harness.completed).toHaveLength(1);
  });

  it('deduplicates one assistant item even when it is replayed under another response id', async () => {
    const harness = createHarness();
    await connect(harness);

    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'user-item-1', type: 'message', role: 'user' },
      previous_item_id: null,
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'shared-assistant-item', type: 'message', role: 'assistant' },
      previous_item_id: 'user-item-1',
    });

    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-item-1',
      transcript: 'First user transcript.',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-item-2',
      transcript: 'Second user transcript.',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_text.done',
      response_id: 'response-1',
      item_id: 'shared-assistant-item',
      text: 'What changes if the handoff has one owner?',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'response-1', status: 'completed' },
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_audio_transcript.done',
      response_id: 'response-2',
      item_id: 'shared-assistant-item',
      transcript: 'What changes if the handoff has one owner?',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'response-2', status: 'completed' },
    });
    await flushVoiceQueue();

    expect(harness.completed).toHaveLength(1);
  });

  it('correlates two scrambled exchanges by conversation item links, never lexical or arrival order', async () => {
    const harness = createHarness();
    await connect(harness);

    const events = [
      {
        type: 'conversation.item.created',
        item: { id: 'z-user-first', type: 'message', role: 'user' },
        previous_item_id: null,
      },
      {
        type: 'conversation.item.created',
        item: { id: 'a-assistant-first', type: 'message', role: 'assistant' },
        previous_item_id: 'z-user-first',
      },
      {
        type: 'conversation.item.created',
        item: { id: 'a-user-second', type: 'message', role: 'user' },
        previous_item_id: 'a-assistant-first',
      },
      {
        type: 'conversation.item.created',
        item: { id: 'z-assistant-second', type: 'message', role: 'assistant' },
        previous_item_id: 'a-user-second',
      },
      {
        type: 'response.output_audio_transcript.done',
        response_id: 'z-response-second',
        item_id: 'z-assistant-second',
        transcript: 'Which second boundary would make ownership concrete?',
      },
      {
        type: 'response.done',
        response: {
          id: 'z-response-second',
          status: 'completed',
          output: [{ id: 'z-assistant-second' }],
        },
      },
      {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'a-user-second',
        transcript: 'Second user statement.',
      },
      {
        type: 'response.done',
        response: {
          id: 'a-response-first',
          status: 'completed',
          output: [{ id: 'a-assistant-first' }],
        },
      },
      {
        type: 'response.output_text.done',
        response_id: 'a-response-first',
        item_id: 'a-assistant-first',
        text: 'Which first signal would reveal the ownership gap?',
      },
      {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'z-user-first',
        transcript: 'First user statement.',
      },
    ];
    events.forEach((event) => { emitProviderEvent(harness.peer.dataChannel, event); });
    await flushVoiceQueue();

    expect(harness.completed).toEqual([
      {
        threadId: ACTIVE_THREAD_ID,
        userTranscript: 'Second user statement.',
        assistantTranscript: 'Which second boundary would make ownership concrete?',
      },
      {
        threadId: ACTIVE_THREAD_ID,
        userTranscript: 'First user statement.',
        assistantTranscript: 'Which first signal would reveal the ownership gap?',
      },
    ]);
  });

  it('serializes completed exchange persistence callbacks', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const harness = createHarness({
      completedHandler: async () => {
        calls += 1;
        if (calls === 1) {
          await firstPending;
        }
      },
    });
    await connect(harness);

    for (const suffix of ['first', 'second']) {
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'conversation.item.created',
        item: { id: `user-${suffix}`, type: 'message', role: 'user' },
        previous_item_id: suffix === 'first' ? null : 'assistant-first',
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'conversation.item.created',
        item: { id: `assistant-${suffix}`, type: 'message', role: 'assistant' },
        previous_item_id: `user-${suffix}`,
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: `user-${suffix}`,
        transcript: `${suffix} user`,
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'response.output_text.done',
        response_id: `response-${suffix}`,
        item_id: `assistant-${suffix}`,
        text: `Which ${suffix} question matters?`,
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'response.done',
        response: {
          id: `response-${suffix}`,
          status: 'completed',
          output: [{ id: `assistant-${suffix}` }],
        },
      });
    }

    await flushVoiceQueue();
    expect(calls).toBe(1);
    releaseFirst?.();
    await firstPending;
    await flushVoiceQueue();
    expect(calls).toBe(2);
  });

  it('persists an emitted exchange even when the session stops before its queued callback begins', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const persisted: string[] = [];
    const harness = createHarness({
      completedHandler: async (exchange) => {
        persisted.push(exchange.userTranscript);
        if (persisted.length === 1) await firstPending;
      },
    });
    await connect(harness);

    for (const suffix of ['first', 'second']) {
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'conversation.item.created',
        item: { id: `queued-user-${suffix}`, type: 'message', role: 'user' },
        previous_item_id: suffix === 'first' ? null : 'queued-assistant-first',
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'conversation.item.created',
        item: { id: `queued-assistant-${suffix}`, type: 'message', role: 'assistant' },
        previous_item_id: `queued-user-${suffix}`,
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: `queued-user-${suffix}`,
        transcript: `${suffix} queued user`,
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'response.output_text.done',
        response_id: `queued-response-${suffix}`,
        item_id: `queued-assistant-${suffix}`,
        text: `Which ${suffix} queued boundary matters?`,
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'response.done',
        response: {
          id: `queued-response-${suffix}`,
          status: 'completed',
          output: [{ id: `queued-assistant-${suffix}` }],
        },
      });
    }

    await flushVoiceQueue();
    expect(persisted).toEqual(['first queued user']);
    expect(harness.spoken).toEqual([]);
    harness.controller.stop();
    releaseFirst?.();
    await firstPending;
    await flushVoiceQueue();
    expect(persisted).toEqual(['first queued user', 'second queued user']);
    expect(harness.spoken).toEqual([]);
  });

  it('reports a queued persistence failure after Stop without replaying unvalidated speech', async () => {
    let releaseFirst: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const harness = createHarness({
      completedHandler: async () => {
        await pending;
        throw new Error('storage rejected');
      },
    });
    await connect(harness);
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'failure-user', type: 'message', role: 'user' },
      previous_item_id: null,
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'failure-assistant', type: 'message', role: 'assistant' },
      previous_item_id: 'failure-user',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'failure-user', transcript: 'Rejected transcript.',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_text.done', response_id: 'failure-response',
      item_id: 'failure-assistant', text: 'Why would this invalid output be spoken?',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'failure-response', status: 'completed', output: [{ id: 'failure-assistant' }] },
    });
    await flushVoiceQueue();
    harness.controller.stop();
    releaseFirst?.();
    await pending;
    await flushVoiceQueue();

    expect(harness.spoken).toEqual([]);
    expect(harness.inactiveCompletionFailures).toEqual([{
      code: 'completion_failed',
      message: 'The completed voice exchange could not be saved.',
    }]);
    expect(harness.peer.closeCount).toBe(1);
  });

  it('reports speech output failure as a connection fallback after persistence succeeds', async () => {
    const harness = createHarness({ speakReject: new Error('speech unavailable') });
    await connect(harness);
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'speech-user', type: 'message', role: 'user' },
      previous_item_id: null,
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'speech-assistant', type: 'message', role: 'assistant' },
      previous_item_id: 'speech-user',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'speech-user', transcript: 'Persist this first.',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_text.done', response_id: 'speech-response',
      item_id: 'speech-assistant', text: 'Which persisted boundary matters?',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'speech-response', status: 'completed', output: [{ id: 'speech-assistant' }] },
    });
    await flushVoiceQueue();

    expect(harness.completed).toHaveLength(1);
    expect(harness.failures).toEqual([{
      code: 'connection_failed',
      message: 'The voice connection could not be established.',
    }]);
    expect(harness.failures[0]?.code).not.toBe('completion_failed');
  });

  it.each(['cancelled', 'failed', 'incomplete'] as const)(
    'persists nothing when response.done is %s',
    async (status) => {
      const harness = createHarness();
      await connect(harness);

      emitProviderEvent(harness.peer.dataChannel, {
        type: 'response.output_text.done',
        response_id: `response-${status}`,
        item_id: `assistant-${status}`,
        text: 'This must not persist?',
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: `user-${status}`,
        transcript: 'This must also not persist.',
      });
      emitProviderEvent(harness.peer.dataChannel, {
        type: 'response.done',
        response: { id: `response-${status}`, status },
      });

      expect(harness.completed).toEqual([]);
      expect(harness.failures).toEqual([]);
    },
  );

  it('ignores unknown future events without disturbing the active session', async () => {
    const harness = createHarness();
    await connect(harness);

    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.future.delta',
      anything: { nested: true },
    });

    expect(harness.failures).toEqual([]);
    expect(harness.statuses).toEqual(['connecting', 'listening']);
    expect(harness.peer.closeCount).toBe(0);
  });

  it('fails safely and cleans up when a supported provider event is malformed', async () => {
    const harness = createHarness();
    await connect(harness);

    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_text.done',
      response_id: 'response-1',
      text: 'Missing item id?',
    });

    expect(harness.failures).toEqual([{
      code: 'protocol_error',
      message: 'The voice session returned an invalid event.',
    }]);
    expect(harness.statuses).toEqual(['connecting', 'listening', 'idle']);
    expect(harness.peer.closeCount).toBe(1);
    expect(harness.peer.dataChannel.closeCount).toBe(1);
    expect(harness.localTrack.stopCount).toBe(1);
  });

  it('rejects conflicting response output ids and replayed conversation links', async () => {
    const outputMismatch = createHarness();
    await connect(outputMismatch);
    emitProviderEvent(outputMismatch.peer.dataChannel, {
      type: 'response.output_text.done',
      response_id: 'response-1',
      item_id: 'assistant-transcript',
      text: 'Which ownership signal matters?',
    });
    emitProviderEvent(outputMismatch.peer.dataChannel, {
      type: 'response.done',
      response: {
        id: 'response-1',
        status: 'completed',
        output: [{ id: 'assistant-different' }],
      },
    });
    expect(outputMismatch.failures[0]?.code).toBe('protocol_error');

    const replay = createHarness();
    await connect(replay);
    emitProviderEvent(replay.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'assistant-1', type: 'message', role: 'assistant' },
      previous_item_id: 'user-1',
    });
    emitProviderEvent(replay.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'assistant-1', type: 'message', role: 'user' },
      previous_item_id: 'user-2',
    });
    expect(replay.failures[0]?.code).toBe('protocol_error');
  });

  it('rejects conflicting transcript and response-status replays', async () => {
    const userReplay = createHarness();
    await connect(userReplay);
    emitProviderEvent(userReplay.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-replay',
      transcript: 'Original user transcript.',
    });
    emitProviderEvent(userReplay.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'user-replay',
      transcript: 'Conflicting user transcript.',
    });
    expect(userReplay.failures[0]?.code).toBe('protocol_error');

    const assistantReplay = createHarness();
    await connect(assistantReplay);
    emitProviderEvent(assistantReplay.peer.dataChannel, {
      type: 'response.output_text.done',
      response_id: 'response-replay',
      item_id: 'assistant-replay',
      text: 'Which original boundary matters?',
    });
    emitProviderEvent(assistantReplay.peer.dataChannel, {
      type: 'response.output_text.done',
      response_id: 'response-replay',
      item_id: 'assistant-replay',
      text: 'Which conflicting boundary matters?',
    });
    expect(assistantReplay.failures[0]?.code).toBe('protocol_error');

    const statusReplay = createHarness();
    await connect(statusReplay);
    emitProviderEvent(statusReplay.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'response-status', status: 'completed' },
    });
    emitProviderEvent(statusReplay.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'response-status', status: 'failed' },
    });
    expect(statusReplay.failures[0]?.code).toBe('protocol_error');
  });

  it('reports a content-safe failure and cleans up on a Realtime error event', async () => {
    const harness = createHarness();
    await connect(harness);

    emitProviderEvent(harness.peer.dataChannel, {
      type: 'error',
      error: { code: 'provider_secret', message: 'raw provider detail' },
    });

    expect(harness.failures).toEqual([{
      code: 'realtime_error',
      message: 'The voice session ended unexpectedly.',
    }]);
    expect(JSON.stringify(harness.failures)).not.toContain('raw provider detail');
    expect(JSON.stringify(harness.failures)).not.toContain('provider_secret');
    expect(harness.peer.closeCount).toBe(1);
  });

  it('removes listeners and releases every resource exactly once on repeated stop', async () => {
    const harness = createHarness();
    const remoteTrack = new FakeTrack();
    await connect(harness);
    harness.peer.emit('track', { track: remoteTrack });

    harness.controller.stop();
    harness.controller.stop();

    expect(harness.abortControllers[0]?.abortCount).toBe(1);
    expect(harness.peer.dataChannel.closeCount).toBe(1);
    expect(harness.localTrack.stopCount).toBe(1);
    expect(remoteTrack.stopCount).toBe(1);
    expect(harness.audio.pauseCount).toBe(0);
    expect(harness.audio.currentTime).toBe(12);
    expect(harness.audio.srcObject).toBeNull();
    expect(harness.peer.closeCount).toBe(1);
    expect(harness.peer.listenerCount()).toBe(0);
    expect(harness.peer.dataChannel.listenerCount()).toBe(0);
    expect(harness.peer.removed).toHaveLength(harness.peer.added.length);
    expect(harness.peer.dataChannel.removed).toHaveLength(harness.peer.dataChannel.added.length);
    expect(harness.statuses).toEqual(['connecting', 'listening', 'idle']);
    expect(harness.speechCancelCount()).toBe(1);
  });

  it('cancels validated speech exactly once when Stop supersedes an active utterance', async () => {
    const harness = createHarness();
    await connect(harness);
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'spoken-user', type: 'message', role: 'user' },
      previous_item_id: null,
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.created',
      item: { id: 'spoken-assistant', type: 'message', role: 'assistant' },
      previous_item_id: 'spoken-user',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'spoken-user', transcript: 'Speak this validated exchange.',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.output_text.done', response_id: 'spoken-response',
      item_id: 'spoken-assistant', text: 'Which validated signal matters?',
    });
    emitProviderEvent(harness.peer.dataChannel, {
      type: 'response.done',
      response: { id: 'spoken-response', status: 'completed', output: [{ id: 'spoken-assistant' }] },
    });
    await flushVoiceQueue();
    expect(harness.spoken).toEqual(['Which validated signal matters?']);

    harness.controller.stop();
    harness.controller.stop();
    expect(harness.speechCancelCount()).toBe(1);
  });

  it('does not request the microphone when credential acquisition fails', async () => {
    const harness = createHarness({ credentialReject: new Error('secret provider body') });

    await harness.controller.start(startContext());

    expect(harness.mediaRequestCount()).toBe(0);
    expect(harness.failures).toEqual([{
      code: 'credential_unavailable',
      message: 'Voice is temporarily unavailable.',
    }]);
    expect(JSON.stringify(harness.failures)).not.toContain('secret provider body');
    expect(harness.abortControllers[0]?.abortCount).toBe(1);
    expect(harness.statuses).toEqual(['connecting', 'idle']);
  });

  it('cleans acquired resources when microphone or SDP setup fails', async () => {
    const microphone = createHarness({ getUserMediaReject: new Error('permission denied') });
    await microphone.controller.start(startContext());
    expect(microphone.failures).toEqual([{
      code: 'microphone_unavailable',
      message: 'Microphone access is unavailable.',
    }]);
    expect(microphone.peer.closeCount).toBe(0);
    expect(microphone.abortControllers[0]?.abortCount).toBe(1);

    const sdp = createHarness({ sdpReject: new Error('raw SDP provider body') });
    await sdp.controller.start(startContext());
    expect(sdp.failures).toEqual([{
      code: 'connection_failed',
      message: 'The voice connection could not be established.',
    }]);
    expect(JSON.stringify(sdp.failures)).not.toContain('raw SDP provider body');
    expect(sdp.localTrack.stopCount).toBe(1);
    expect(sdp.peer.dataChannel.closeCount).toBe(1);
    expect(sdp.audio.pauseCount).toBe(0);
    expect(sdp.peer.closeCount).toBe(1);
    expect(sdp.abortControllers[0]?.abortCount).toBe(1);
  });

  it('stops a microphone stream that resolves after stop or timeout cleanup', async () => {
    const harness = createHarness({ deferUserMedia: true });
    const pendingStart = harness.controller.start(startContext());
    await flushVoiceQueue();
    expect(harness.mediaRequestCount()).toBe(1);

    harness.controller.stop();
    harness.resolveUserMedia();
    await pendingStart;

    expect(harness.localTrack.stopCount).toBe(1);
    expect(harness.peer.closeCount).toBe(0);
    expect(harness.statuses).toEqual(['connecting', 'idle']);
  });

  it('cleans up on data-channel and peer-connection failures', async () => {
    const channelFailure = createHarness();
    await connect(channelFailure);
    channelFailure.peer.dataChannel.emit('error');
    expect(channelFailure.failures).toEqual([{
      code: 'connection_failed',
      message: 'The voice connection could not be established.',
    }]);
    expect(channelFailure.peer.closeCount).toBe(1);

    const peerFailure = createHarness();
    await connect(peerFailure);
    peerFailure.peer.connectionState = 'failed';
    peerFailure.peer.emit('connectionstatechange');
    expect(peerFailure.failures).toEqual([{
      code: 'connection_failed',
      message: 'The voice connection could not be established.',
    }]);
    expect(peerFailure.peer.dataChannel.closeCount).toBe(1);
  });

  it('rejects expired or overlong credential payloads before microphone access', async () => {
    const expired = createHarness({
      credentialBody: {
        value: 'ephemeral-secret',
        expiresAt: Math.floor(NOW / 1_000) - 1,
      },
    });
    await expired.controller.start(startContext());
    expect(expired.mediaRequestCount()).toBe(0);
    expect(expired.failures[0]?.code).toBe('credential_unavailable');

    const overlong = createHarness({
      credentialBody: {
        value: 'x'.repeat(4_097),
        expiresAt: Math.floor(NOW / 1_000) + 60,
      },
    });
    await overlong.controller.start(startContext());
    expect(overlong.mediaRequestCount()).toBe(0);
    expect(overlong.failures[0]?.code).toBe('credential_unavailable');
  });

  it('cleans the old session before an explicit retry starts a fresh session', async () => {
    const first = createHarness();
    await connect(first);

    await first.controller.start(startContext());

    expect(first.abortControllers).toHaveLength(2);
    expect(first.abortControllers[0]?.abortCount).toBe(1);
    expect(first.localTrack.stopCount).toBe(1);
    expect(first.peer.dataChannel.closeCount).toBe(1);
    expect(first.peer.closeCount).toBe(1);
    expect(first.statuses).toEqual(['connecting', 'listening', 'idle', 'connecting']);
  });

  it('times out a connection that never opens and ignores late events', async () => {
    const harness = createHarness();
    await harness.controller.start(startContext());

    expect(harness.timeoutDelays).toEqual([15_000]);
    harness.expireConnection();
    harness.peer.dataChannel.emit('open');

    expect(harness.failures).toEqual([{
      code: 'connection_failed',
      message: 'The voice connection could not be established.',
    }]);
    expect(harness.statuses).toEqual(['connecting', 'idle']);
    expect(harness.peer.closeCount).toBe(1);
    expect(harness.localTrack.stopCount).toBe(1);
  });
});
