type ReloadSafetyCheck = () => Promise<void>;

let activeCheck: ReloadSafetyCheck | null = null;

export function registerReloadSafetyCheck(check: ReloadSafetyCheck): () => void {
  activeCheck = check;
  return () => {
    if (activeCheck === check) activeCheck = null;
  };
}

export async function prepareForApplicationReload(): Promise<void> {
  await activeCheck?.();
}
