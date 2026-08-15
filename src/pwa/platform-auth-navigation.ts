export async function releaseServiceWorkersForPlatformAuth(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  let registrations: readonly ServiceWorkerRegistration[];
  try {
    registrations = await navigator.serviceWorker.getRegistrations();
  } catch {
    return;
  }
  await Promise.all(registrations.map(async (registration) => {
    try {
      await registration.unregister();
    } catch {
      // Navigation must still be attempted when a browser cannot remove a stale registration.
    }
  }));
}
