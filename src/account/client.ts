import type { WorkspaceState } from '../thinking/model';

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadAccountArchive(): Promise<void> {
  const response = await fetch('/api/archive');
  if (!response.ok) throw new Error('Specular could not prepare your archive.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `specular-archive-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadDeviceRecovery(workspace: WorkspaceState): void {
  downloadJson(`specular-device-recovery-${new Date().toISOString().slice(0, 10)}.json`, {
    format: 'specular-device-recovery',
    version: 1,
    createdAt: Date.now(),
    workspace: { ...workspace, annotations: [] },
  });
}

export async function deleteHostedAccount(): Promise<void> {
  const response = await fetch('/api/account', {
    method: 'DELETE',
    headers: { 'x-specular-intent': 'mutate' },
  });
  if (!response.ok) throw new Error('Specular could not delete this account workspace.');
}
