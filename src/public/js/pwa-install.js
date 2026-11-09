(() => {
  const installButton = document.querySelector('[data-pwa-install]');
  const helpDialog = document.querySelector('[data-pwa-help]');

  if (!installButton) return;

  let installPrompt = null;
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isInstalled) {
    installButton.hidden = true;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButton.hidden = true;
  });

  installButton.addEventListener('click', async () => {
    if (!installPrompt) {
      if (helpDialog && typeof helpDialog.showModal === 'function') {
        helpDialog.showModal();
      }
      return;
    }

    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installPrompt = null;

    if (choice.outcome === 'accepted') {
      installButton.hidden = true;
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.error('Unable to register the app service worker:', error);
    });
  }
})();
