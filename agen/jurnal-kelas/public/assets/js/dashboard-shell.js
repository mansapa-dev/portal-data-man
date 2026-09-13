(() => {
  const trigger = document.getElementById('mobile-account-trigger');
  const sheet = document.getElementById('mobile-account-sheet');
  if (!trigger || !sheet) return;

  const closeButton = sheet.querySelector('.account-sheet-close');
  trigger.addEventListener('click', () => {
    if (sheet.open) sheet.close();
    else {
      sheet.showModal();
      trigger.setAttribute('aria-expanded', 'true');
      closeButton?.focus();
    }
  });
  closeButton?.addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  });
  sheet.addEventListener('click', event => {
    if (event.target === sheet) sheet.close();
  });
})();
