import { expect, type Page, type Route } from '@playwright/test';

interface ThreadTurn {
  id: string;
  role: 'specular' | 'system' | 'user';
  content: string;
}

interface ThreadContextBody {
  context: {
    operation: 'challenge' | 'conclusion' | 'next_question';
    turns: ThreadTurn[];
    understanding: Record<string, string[]>;
  };
}

export interface OperationMockController {
  delayNextQuestion(): void;
  releaseNextQuestion(): void;
}

function firstUserTurn(context: ThreadContextBody['context']): ThreadTurn {
  const turn = context.turns.find((candidate) => candidate.role === 'user');
  if (turn === undefined) {
    throw new Error('The deterministic browser provider requires one user turn.');
  }
  return turn;
}

function responseFor(path: string, body: ThreadContextBody): unknown {
  const { context } = body;
  if (path.endsWith('/next-question')) {
    return {
      kind: 'question',
      question: 'Which concrete signal would show the launch handoff is working?',
      understanding: context.understanding,
    };
  }
  if (path.endsWith('/challenge')) {
    return {
      kind: 'blind_spot',
      question: 'Which stakeholder absorbs the cost if the launch assumption fails?',
    };
  }
  if (path.endsWith('/conclusion')) {
    const source = firstUserTurn(context);
    return {
      kind: 'working_conclusion',
      thesis: 'My current read is that the launch handoff needs one observable ownership signal.',
      insights: [
        'The handoff is the current constraint.',
        'Support encounters uncertainty before other stakeholders.',
        'A concrete signal can distinguish ownership from intention.',
      ],
      observations: ['The thread repeatedly returns to the launch handoff.'],
      tensions: ['The useful signal remains provisional until it is tested.'],
      caveats: ['This reading uses only the current local thread.'],
      provenance: [{ turnId: source.id, excerpt: source.content.slice(0, 500) }],
    };
  }
  throw new Error(`Unexpected operation path: ${path}`);
}

async function fulfillOperation(route: Route, waitForRelease: () => Promise<void>): Promise<void> {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const body = request.postDataJSON() as ThreadContextBody;
  if (path.endsWith('/next-question')) {
    await waitForRelease();
  }
  await route.fulfill({
    contentType: 'application/json',
    status: 200,
    body: JSON.stringify({ ok: true, value: responseFor(path, body) }),
  });
}

export async function installOperationMocks(page: Page): Promise<OperationMockController> {
  let delayed = false;
  let release: (() => void) | undefined;
  let pending = Promise.resolve();
  await page.route('**/api/operations/**', async (route) => {
    await fulfillOperation(route, async () => {
      if (delayed) {
        await pending;
        delayed = false;
      }
    });
  });
  return {
    delayNextQuestion(): void {
      delayed = true;
      pending = new Promise<void>((resolve) => { release = resolve; });
    },
    releaseNextQuestion(): void {
      release?.();
      release = undefined;
    },
  };
}

export async function openSpecular(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Specular' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Idea, context, or response' })).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  await dismiss.click({ timeout: 2_000 }).catch(() => undefined);
}

export async function submitThought(page: Page, thought: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Idea, context, or response' }).fill(thought);
  await page.getByRole('button', { name: 'Send input' }).click();
  await expect(page.getByText(thought, { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Which concrete signal would show the launch handoff is working?',
    { exact: true },
  )).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}
