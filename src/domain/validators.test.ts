import { describe, expect, it } from 'vitest';
import {
  containsFiller,
  containsProhibitedQuestion,
  questionMarkCount,
  validateOperationResult,
  wordCount,
} from './validators';

describe('validateOperationResult', () => {
  it('accepts one concise normal question', () => {
    expect(validateOperationResult('next_question', {
      kind: 'question',
      setup: 'Let us make the boundary concrete.',
      question: 'Which customer would notice the difference first?',
      understanding: { claims: [], observations: [], stakeholders: ['customer'], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    }).kind).toBe('question');
  });

  it.each([
    'Why does that matter?',
    'What makes you think that is true?',
    'What led you to believe the launch failed?',
    'How come nobody objected?',
  ])('rejects prohibited justification question: %s', (question) => {
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      question,
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/prohibited_question/);
  });

  it('rejects multiple normal questions', () => {
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      question: 'Who noticed first? What changed next?',
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/question_count/);
  });

  it('rejects unsolicited conclusion content as a normal turn', () => {
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      setup: 'The answer is that you should leave.',
      question: 'Which detail supports that decision?',
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/unsolicited_synthesis/);
  });

  it('rejects malformed, overlong, and filler normal turns with stable codes', () => {
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      question: 'What concrete detail changed?',
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
      extra: 'not allowed',
    })).toThrow(/schema_invalid/);
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      setup: Array.from({ length: 42 }, () => 'context').join(' '),
      question: 'What concrete detail changed first?',
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/word_limit/);
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      setup: 'That is a great point.',
      question: 'What concrete detail changed first?',
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/filler/);
  });

  it('accepts both Challenge shapes and bounded conclusions', () => {
    expect(validateOperationResult('challenge', {
      kind: 'blind_spot',
      question: 'Which person bears the cost if this assumption is wrong?',
    }).kind).toBe('blind_spot');
    expect(validateOperationResult('challenge', {
      kind: 'counter_position',
      counterPosition: 'A credible alternative is that speed protects the team from polishing the wrong idea.',
      question: 'What evidence would distinguish haste from useful compression?',
    }).kind).toBe('counter_position');
    expect(validateOperationResult('conclusion', {
      kind: 'working_conclusion',
      thesis: 'My current read is that the team needs a smaller reversible launch.',
      insights: ['The risk is coordination, not demand.', 'A reversible launch preserves learning.', 'The user values a clear decision boundary.'],
      observations: ['Two prior launches stalled during handoff.'],
      tensions: ['Speed may reduce stakeholder confidence.'],
      caveats: ['The thread contains no customer interview evidence.'],
      provenance: [{ turnId: 'turn-1', excerpt: 'The handoff is where it gets stuck.' }],
    }).kind).toBe('working_conclusion');
  });

  it('rejects malformed Challenge and conclusion shapes', () => {
    expect(() => validateOperationResult('challenge', {
      kind: 'counter_position',
      question: 'What evidence would change the decision?',
    })).toThrow(/challenge_shape/);
    expect(() => validateOperationResult('conclusion', {
      kind: 'working_conclusion',
      thesis: 'My current read is that the boundary remains unclear.',
      insights: ['Only one insight is present.'],
      observations: [],
      tensions: [],
      caveats: [],
      provenance: [{ turnId: 'turn-1', excerpt: 'The boundary remains unclear.' }],
    })).toThrow(/conclusion_shape/);
  });

  it('rejects operation-specific word and question-count limits', () => {
    expect(() => validateOperationResult('challenge', {
      kind: 'blind_spot',
      question: 'Who carries the risk? What happens next?',
    })).toThrow(/question_count/);
    expect(() => validateOperationResult('conclusion', {
      kind: 'working_conclusion',
      thesis: Array.from({ length: 151 }, () => 'word').join(' '),
      insights: ['First grounded insight.', 'Second grounded insight.', 'Third grounded insight.'],
      observations: [],
      tensions: [],
      caveats: [],
      provenance: [{ turnId: 'turn-1', excerpt: 'The source observation.' }],
    })).toThrow(/word_limit/);
  });

  it('exposes deterministic text counters and detectors', () => {
    expect(wordCount('  one\n two   three ')).toBe(3);
    expect(questionMarkCount('One? Two？')).toBe(2);
    expect(containsProhibitedQuestion('HOW COME nobody objected?')).toBe(true);
    expect(containsFiller('Thanks for sharing. What changed?')).toBe(true);
  });
});
