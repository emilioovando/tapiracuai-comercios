(function () {
  'use strict';

  var CACHE_PREFIXES = ['tapiracuai', 'workbox'];
  var INSTALL_SELECTORS = [
    '[data-install-app]',
    '[data-pwa-install]',
    '#installApp',
    '#installButton',
    '#downloadApp',
    '.install-app',
    '.pwa-install',
    '.download-app'
  ];

  window.TAPIRACUAI_PWA_INSTALL_DISABLED = true;

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    window.deferredPrompt = null;
  });

  function hideInstallControls() {
    INSTALL_SELECTORS.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (element) {
        element.setAttribute('hidden', 'hidden');
        element.setAttribute('aria-hidden', 'true');
        element.style.display = 'none';
      });
    });
  }

  function cleanupOldPwaState() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(function (registrations) {
          return Promise.all(registrations
            .filter(function (registration) {
              return String(registration.scope || '').indexOf(window.location.origin + '/') === 0;
            })
            .map(function (registration) {
              return registration.unregister();
            }));
        })
        .catch(function (error) {
          console.warn('Tapiracuai PWA cleanup: no se pudo limpiar service workers antiguos.', error && error.message ? error.message : error);
        });
    }

    if ('caches' in window) {
      caches.keys()
        .then(function (keys) {
          return Promise.all(keys
            .filter(function (key) {
              var normalized = String(key || '').toLowerCase();
              return CACHE_PREFIXES.some(function (prefix) {
                return normalized.indexOf(prefix) !== -1;
              });
            })
            .map(function (key) {
              return caches.delete(key);
            }));
        })
        .catch(function (error) {
          console.warn('Tapiracuai PWA cleanup: no se pudo limpiar cache antigua.', error && error.message ? error.message : error);
        });
    }
  }

  window.addEventListener('error', function (event) {
    console.error('Tapiracuai runtime error', {
      message: event.message || 'Error no especificado',
      source: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    console.error('Tapiracuai promise rejection', reason && reason.message ? reason.message : String(reason || 'Error no especificado'));
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideInstallControls);
  } else {
    hideInstallControls();
  }

  window.addEventListener('load', function () {
    hideInstallControls();
    cleanupOldPwaState();
  });
})();
