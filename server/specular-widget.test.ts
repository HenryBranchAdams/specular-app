import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Specular widget source', () => {
  it('uses text-only rendering and the standard MCP result bridge with additive ChatGPT compatibility', async () => {
    const source = await readFile(resolve(process.cwd(), 'public/specular-widget.html'), 'utf8');

    expect(source).toContain('ui/notifications/tool-result');
    expect(source).toContain('event.source !== window.parent');
    expect(source).toContain("message.jsonrpc !== '2.0'");
    expect(source).toContain("typeof message !== 'object'");
    expect(source).toContain('message === null');
    expect(source).toContain('textContent');
    expect(source).not.toContain('innerHTML');
    expect(source).toContain('window.openai?.toolInput');
    expect(source).toContain('window.openai?.toolOutput');
    expect(source).toContain('window.openai?.callTool');
    expect(source).toContain('window.openai?.setWidgetState');
    expect(source).toContain('structuredClone');
    expect(source).toContain("next_question");
    expect(source).toContain("challenge");
    expect(source).toContain("draft_conclusion");
    expect(source).not.toMatch(/clarify|invert|distill/iu);
    expect(source).not.toMatch(/<script[^>]+src=|<iframe|https?:\/\//iu);
  });

  it('provides non-color labels, mobile control floors, and accessibility media behavior', async () => {
    const source = await readFile(resolve(process.cwd(), 'public/specular-widget.html'), 'utf8');

    expect(source).toContain('Question');
    expect(source).toContain('Test this');
    expect(source).toContain('Testing question');
    expect(source).toContain("case 'counter_position':");
    expect(source).toContain('Counter-position');
    expect(source).toContain("case 'immediate_safety':");
    expect(source).toContain('Safety');
    expect(source).toContain('Immediate support');
    expect(source).toContain('Gather this thread');
    expect(source).toContain('Exact words from this thread');
    expect(source).not.toContain('✦');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('min-height: 44px');
    expect(source).toContain('font-size: 16px');
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain('prefers-contrast: more');
    expect(source).toContain('forced-colors: active');
  });

  it('keeps counter-positions distinct from text-only immediate support', async () => {
    const source = await readFile(resolve(process.cwd(), 'public/specular-widget.html'), 'utf8');
    const counterPositionCase = source.slice(
      source.indexOf("case 'counter_position':"),
      source.indexOf("case 'immediate_safety':"),
    );
    const immediateSafetyCase = source.slice(
      source.indexOf("case 'immediate_safety':"),
      source.indexOf("case 'working_conclusion':"),
    );

    expect(counterPositionCase).toContain("setText(operationLabel, 'Test')");
    expect(counterPositionCase).toContain("setText(subtype, 'Counter-position')");
    expect(counterPositionCase).toContain('value.counterPosition');
    expect(counterPositionCase).not.toContain("setText(operationLabel, 'Safety')");
    expect(immediateSafetyCase).toContain("setText(operationLabel, 'Safety')");
    expect(immediateSafetyCase).toContain("setText(subtype, 'Immediate support')");
    expect(immediateSafetyCase).toContain('value.guidance');
    expect(immediateSafetyCase).toContain('value.question');
    expect(immediateSafetyCase).not.toContain('innerHTML');
  });

  it('renders ordinary questions without reading a setup field', async () => {
    const source = await readFile(resolve(process.cwd(), 'public/specular-widget.html'), 'utf8');
    const questionCase = source.slice(
      source.indexOf("case 'question':"),
      source.indexOf("case 'blind_spot':"),
    );

    expect(questionCase).toContain('value.question');
    expect(questionCase).not.toContain('value.setup');
    expect(source).not.toContain('id="setup"');
  });
});
