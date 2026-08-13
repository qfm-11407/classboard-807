if ('serviceWorker' in navigator) {
  let registration;
  let refreshing = false;
  const checkForUpdate = () => registration?.update().catch(() => {});

  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' });
      await registration.update();
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (_) {}
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}
