(function () {
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('[data-nav]').forEach((el) => {
    if (el.getAttribute('href') === currentPath) {
      el.classList.add('active');
    }
  });

  window.showToast = function showToast(message, type) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove('success', 'error', 'show');
    if (type) {
      toast.classList.add(type);
    }

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  };

  const waButton = document.getElementById('waButton');
  if (waButton && window.APP_CONFIG && window.APP_CONFIG.WHATSAPP_NUMBER) {
    waButton.href = `https://wa.me/${window.APP_CONFIG.WHATSAPP_NUMBER}`;
  }
})();
