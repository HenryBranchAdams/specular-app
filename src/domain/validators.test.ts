import { describe, expect, it } from 'vitest';
import {
  containsFiller,
  containsProhibitedQuestion,
  questionMarkCount,
  validateConclusionAuthorship,
  validateOperationResult,
  wordCount,
} from './validators';
import { turnSchema } from './schemas';

const EMPTY_UNDERSTANDING = {
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
};

function normalResult(question: string, setup?: string) {
  return {
    kind: 'question',
    ...(setup === undefined ? {} : { setup }),
    question,
    understanding: EMPTY_UNDERSTANDING,
  };
}

function questionWithWordCount(count: number, terminal = '?'): string {
  return [
    ...Array.from({ length: count - 1 }, () => 'word'),
    `boundary${terminal}`,
  ].join(' ');
}

function repeatedWords(count: number, word = 'position'): string {
  return Array.from({ length: count }, () => word).join(' ');
}

function conclusionWith(
  insights: string[],
  tensions: string[],
) {
  return {
    kind: 'working_conclusion',
    thesis: 'My current read is that the team needs a smaller reversible launch.',
    insights,
    observations: ['Two prior launches stalled during handoff.'],
    tensions,
    caveats: ['The thread contains no customer interview evidence.'],
    provenance: [{ turnId: 'turn-1', excerpt: 'The handoff is where it gets stuck.' }],
  };
}

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
      insights: [],
      observations: [],
      tensions: [],
      caveats: [],
      provenance: [{ turnId: 'turn-1', excerpt: 'The boundary remains unclear.' }],
    })).toThrow(/conclusion_shape/);
  });

  it('accepts only distinct verbatim fields from accepted user turns', () => {
    const userTurns = [
      turnSchema.parse({
        id: 'turn-user-1',
        ownerScope: 'local',
        threadId: 'thread-1',
        role: 'user',
        content: 'The launch can stay reversible.',
        modality: 'text',
        createdAt: 1,
        position: 0,
        deliveryState: 'accepted',
      }),
      turnSchema.parse({
        id: 'turn-user-2',
        ownerScope: 'local',
        threadId: 'thread-1',
        role: 'user',
        content: 'The handoff has no observable owner.',
        modality: 'text',
        createdAt: 2,
        position: 1,
        deliveryState: 'accepted',
      }),
    ];
    const firstTurn = userTurns[0];
    const secondTurn = userTurns[1];
    if (firstTurn === undefined || secondTurn === undefined) {
      throw new Error('Expected two user turns.');
    }
    const gathered = validateOperationResult('conclusion', {
      kind: 'working_conclusion',
      thesis: firstTurn.content,
      insights: [secondTurn.content],
      observations: [],
      tensions: [],
      caveats: [],
      provenance: userTurns.map((turn) => ({ turnId: turn.id, excerpt: turn.content })),
    });

    expect(validateConclusionAuthorship(gathered, userTurns)).toBe(gathered);
    expect(() => validateConclusionAuthorship({
      ...gathered,
      thesis: 'A reversible launch is the answer.',
    }, userTurns)).toThrow(/conclusion_authorship/);
    expect(() => validateConclusionAuthorship(gathered, [{
      ...firstTurn,
      role: 'specular',
    }, secondTurn])).toThrow(/conclusion_authorship/);
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

  it('accepts an omitted setup and a single-sentence setup', () => {
    expect(validateOperationResult(
      'next_question',
      normalResult('Which customer notices the difference first?'),
    ).kind).toBe('question');
    expect(validateOperationResult(
      'next_question',
      normalResult(
        'Which customer notices the difference first?',
        'Let us make the boundary concrete.',
      ),
    ).kind).toBe('question');
  });

  it('rejects a question mark in setup even when the question has none', () => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult(
        'Which customer notices the difference first.',
        'Could this be the boundary?',
      ),
    )).toThrow(/question_count/);
  });

  it('rejects more than one setup sentence', () => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult(
        'Which customer notices the difference first?',
        'One boundary is visible. Another remains open.',
      ),
    )).toThrow(/schema_invalid/);
  });

  it('rejects adjacent setup sentences without whitespace', () => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult(
        'Which launch constraint matters most?',
        'First sentence.Second sentence.',
      ),
    )).toThrow(/schema_invalid/);
  });

  it('treats an honorific abbreviation as part of one setup sentence', () => {
    expect(validateOperationResult(
      'next_question',
      normalResult(
        'Which launch constraint matters most?',
        'Dr. Patel disagreed.',
      ),
    ).kind).toBe('question');
  });

  it.each([
    'First sentence.second sentence.',
    'We considered speed, cost, etc. Another constraint remains.',
    'First sentence.2nd sentence.',
    'First sentence!!!Second sentence.',
  ])('rejects an explicit second setup sentence boundary: %s', (setup) => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult('Which launch constraint matters most?', setup),
    )).toThrow(/schema_invalid/);
  });

  it.each([
    'A concrete example may help, e.g. a delayed launch.',
    'A concrete distinction may help, i.e. demand versus timing.',
    'One emphatic sentence!!!',
    'Version 2.0 remains stable.',
  ])('accepts one setup sentence with an internal abbreviation or terminator cluster: %s', (setup) => {
    expect(validateOperationResult(
      'next_question',
      normalResult('Which launch constraint matters most?', setup),
    ).kind).toBe('question');
  });

  it('requires the normal question to end in its only question mark', () => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult('Which customer notices first? Compare the result.'),
    )).toThrow(/question_count/);
  });

  it('rejects a normal question that depends on a vague setup reference', () => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult('What does that mean?', 'One boundary is visible.'),
    )).toThrow(/question_independence/);
  });

  it.each([
    'Which part of that matters most?',
    'Who owns this?',
    'What happens if it fails?',
    'Which of these constraints matters most?',
  ])('rejects an unqualified referent with question_independence: %s', (question) => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult(question),
    )).toThrow(/question_independence/);
  });

  it('accepts an independently understandable question with an explicit noun phrase', () => {
    expect(validateOperationResult(
      'next_question',
      normalResult('Which launch constraint matters most?'),
    ).kind).toBe('question');
  });

  it.each([
    'Which evidence shows that demand exists?',
    'Is there a smaller reversible step?',
    'Which customer said they would leave?',
    'Which mechanism fails when it overheats?',
    'Which risk from that launch matters most?',
    'Which team changes its plan when it receives new evidence?',
  ])('accepts a grammatical or locally bound reference: %s', (question) => {
    expect(validateOperationResult(
      'next_question',
      normalResult(question),
    ).kind).toBe('question');
  });

  it.each([
    'Which option works better here?',
    'What happens there?',
    'Which of the former matters most?',
    'Which latter option changes the decision?',
    'Which side of those matters most?',
    'Who owns that one?',
    'Which result proves that?',
  ])('keeps rejecting an unqualified demonstrative or locative reference: %s', (question) => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult(question),
    )).toThrow(/question_independence/);
  });

  it.each([
    'Which result proves that a?',
    'Is there a?',
  ])('rejects a truncated determiner clause with question_independence: %s', (question) => {
    expect(() => validateOperationResult(
      'next_question',
      normalResult(question),
    )).toThrow(/question_independence/);
  });

  it('accepts a normal turn at 45 words and rejects one at 46 words', () => {
    expect(validateOperationResult(
      'next_question',
      normalResult(questionWithWordCount(45)),
    ).kind).toBe('question');
    expect(() => validateOperationResult(
      'next_question',
      normalResult(questionWithWordCount(46)),
    )).toThrow(/word_limit/);
  });

  it('accepts a blind-spot Challenge at 55 words and rejects one at 56 words', () => {
    expect(validateOperationResult('challenge', {
      kind: 'blind_spot',
      question: questionWithWordCount(55),
    }).kind).toBe('blind_spot');
    expect(() => validateOperationResult('challenge', {
      kind: 'blind_spot',
      question: questionWithWordCount(56),
    })).toThrow(/word_limit/);
  });

  it('accepts a counter-position at 100 words and rejects one at 101 words', () => {
    const question = 'Which concrete signal would change course?';
    const atLimit = {
      kind: 'counter_position',
      counterPosition: repeatedWords(94),
      question,
    };
    const overLimit = {
      ...atLimit,
      counterPosition: repeatedWords(95),
    };

    expect(wordCount(`${atLimit.counterPosition} ${question}`)).toBe(100);
    expect(validateOperationResult('challenge', atLimit).kind).toBe('counter_position');
    expect(wordCount(`${overLimit.counterPosition} ${question}`)).toBe(101);
    expect(() => validateOperationResult('challenge', overLimit)).toThrow(/word_limit/);
  });

  it('requires a terminal Challenge question mark and accepts either mark style', () => {
    expect(() => validateOperationResult('challenge', {
      kind: 'counter_position',
      counterPosition: 'A credible alternative is that the boundary is premature.',
      question: 'Which concrete signal changes course? Compare the outcomes.',
    })).toThrow(/challenge_shape/);
    expect(validateOperationResult('challenge', {
      kind: 'counter_position',
      counterPosition: 'A credible alternative is that the boundary is premature.',
      question: 'Which concrete signal changes course？',
    }).kind).toBe('counter_position');
  });

  it('accepts five conclusion insights and rejects six', () => {
    const fiveInsights = Array.from({ length: 5 }, (_, index) => `Insight ${String(index + 1)}.`);
    expect(validateOperationResult(
      'conclusion',
      conclusionWith(fiveInsights, []),
    ).kind).toBe('working_conclusion');
    expect(() => validateOperationResult(
      'conclusion',
      conclusionWith([...fiveInsights, 'Insight 6.'], []),
    )).toThrow(/conclusion_shape/);
  });

  it('accepts three conclusion tensions and rejects four', () => {
    const insights = ['Insight 1.', 'Insight 2.', 'Insight 3.'];
    const threeTensions = ['Tension 1.', 'Tension 2.', 'Tension 3.'];
    expect(validateOperationResult(
      'conclusion',
      conclusionWith(insights, threeTensions),
    ).kind).toBe('working_conclusion');
    expect(() => validateOperationResult(
      'conclusion',
      conclusionWith(insights, [...threeTensions, 'Tension 4.']),
    )).toThrow(/conclusion_shape/);
  });

  it.each([
    {
      field: 'thesis',
      result: {
        ...conclusionWith(['Insight 1.', 'Insight 2.', 'Insight 3.'], []),
        thesis: 'Why the launch stalled remains the central uncertainty.',
      },
    },
    {
      field: 'insights',
      result: conclusionWith([
        'What makes you think the boundary is stable?',
        'Insight 2.',
        'Insight 3.',
      ], []),
    },
    {
      field: 'observations',
      result: {
        ...conclusionWith(['Insight 1.', 'Insight 2.', 'Insight 3.'], []),
        observations: ['What led you to believe the handoff failed?'],
      },
    },
    {
      field: 'tensions',
      result: conclusionWith(
        ['Insight 1.', 'Insight 2.', 'Insight 3.'],
        ['How come nobody objected?'],
      ),
    },
    {
      field: 'caveats',
      result: {
        ...conclusionWith(['Insight 1.', 'Insight 2.', 'Insight 3.'], []),
        caveats: ['The thread does not establish why the launch stalled.'],
      },
    },
  ])('rejects prohibited phrasing in generated conclusion $field', ({ result }) => {
    expect(() => validateOperationResult('conclusion', result)).toThrow(/prohibited_question/);
  });

  it('does not scan user-authored conclusion provenance for prohibited phrasing', () => {
    const result = {
      ...conclusionWith(['Insight 1.', 'Insight 2.', 'Insight 3.'], []),
      provenance: [{
        turnId: 'turn-1',
        excerpt: 'Why did nobody object, and what makes you think the launch failed?',
      }],
    };

    expect(validateOperationResult('conclusion', result).kind).toBe('working_conclusion');
  });
});
