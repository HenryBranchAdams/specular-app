import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { downloadJsonFile } from './download';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadJsonFile', () => {
  it('creates one JSON object URL, activates one temporary anchor, and revokes afterward', () => {
    const events: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      events.push(`create:${blob.type}`);
      return 'blob:specular-export';
    });
    const revokeObjectURL = vi.fn((url: string) => {
      events.push(`revoke:${url}`);
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      events.push(`click:${this.download}:${this.href}`);
      expect(document.body.contains(this)).toBe(true);
    });

    downloadJsonFile('{"format":"specular-export"}', 'specular-export-2026-07-09.json');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:specular-export');
    expect(events).toEqual([
      'create:application/json;charset=utf-8',
      'click:specular-export-2026-07-09.json:blob:specular-export',
      'revoke:blob:specular-export',
    ]);
    expect(document.querySelector('a[download="specular-export-2026-07-09.json"]')).toBeNull();
  });
});
