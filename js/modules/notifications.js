/**
 * Arena Royale - Notifications Module
 * Toast notifications and UI feedback
 */

// Show a notification toast
function showNotify(message, type = 'default', icon = null, duration = 3500) {
  // Remove existing notifications if too many
  const existing = document.querySelectorAll('.toast-notification');
  if (existing.length >= 3) {
    existing[0].remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;

  // Determine icon based on type
  let displayIcon = icon;
  if (!displayIcon) {
    switch (type) {
      case 'success': displayIcon = '✅'; break;
      case 'error': displayIcon = '❌'; break;
      case 'warning': displayIcon = '⚠️'; break;
      case 'info': displayIcon = 'ℹ️'; break;
      case 'epic': displayIcon = '⭐'; break;
      case 'legendary': displayIcon = '👑'; break;
      default: displayIcon = '📢';
    }
  }

  toast.innerHTML = `
    <div class="toast-icon">${displayIcon}</div>
    <div class="toast-message">${message.replace(/\n/g, '<br>')}</div>
  `;

  // Add styles if not present
  if (!document.getElementById('notifyStyles')) {
    const style = document.createElement('style');
    style.id = 'notifyStyles';
    style.textContent = `
      .toast-notification {
        position: fixed;
        top: 60px;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        background: linear-gradient(180deg, #2a2a4a, #1a1a2a);
        border: 2px solid #444;
        border-radius: 12px;
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 10000;
        animation: toastIn 0.3s ease forwards;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        max-width: 90%;
      }
      .toast-notification.toast-success { border-color: #2ecc71; background: linear-gradient(180deg, #1a3a2a, #0a2a1a); }
      .toast-notification.toast-error { border-color: #e74c3c; background: linear-gradient(180deg, #3a1a1a, #2a0a0a); }
      .toast-notification.toast-warning { border-color: #f1c40f; background: linear-gradient(180deg, #3a3a1a, #2a2a0a); }
      .toast-notification.toast-info { border-color: #3498db; background: linear-gradient(180deg, #1a2a3a, #0a1a2a); }
      .toast-notification.toast-epic { border-color: #9b59b6; background: linear-gradient(180deg, #2a1a3a, #1a0a2a); }
      .toast-notification.toast-legendary { border-color: #f39c12; background: linear-gradient(180deg, #3a2a1a, #2a1a0a); }
      .toast-icon { font-size: 24px; }
      .toast-message { font-size: 13px; line-height: 1.4; color: #fff; }
      @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-40px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      @keyframes toastOut { from { opacity: 1; transform: translateX(-50%) translateY(0); } to { opacity: 0; transform: translateX(-50%) translateY(-40px); } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  // Auto-remove after duration
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);

  // Play sound based on type
  if (typeof playSound === 'function') {
    if (type === 'success') playSound('success');
    else if (type === 'error') playSound('error');
    else playSound('notification');
  }

  return toast;
}

// Show a confirmation dialog
function showConfirm(title, message, onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-title">${title}</div>
      <div class="confirm-message">${message}</div>
      <div class="confirm-buttons">
        <button class="confirm-btn cancel">Cancel</button>
        <button class="confirm-btn confirm">Confirm</button>
      </div>
    </div>
  `;

  // Add styles if not present
  if (!document.getElementById('confirmStyles')) {
    const style = document.createElement('style');
    style.id = 'confirmStyles';
    style.textContent = `
      .confirm-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
      }
      .confirm-box {
        background: linear-gradient(180deg, #2a2a4a, #1a1a2a);
        border: 2px solid #555;
        border-radius: 16px;
        padding: 24px;
        max-width: 320px;
        text-align: center;
      }
      .confirm-title { font-size: 18px; font-weight: 900; margin-bottom: 12px; color: #fff; }
      .confirm-message { font-size: 14px; color: #aaa; margin-bottom: 20px; line-height: 1.5; }
      .confirm-buttons { display: flex; gap: 12px; justify-content: center; }
      .confirm-btn {
        padding: 12px 24px;
        border: none;
        border-radius: 8px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
      }
      .confirm-btn.cancel { background: #444; color: #fff; }
      .confirm-btn.cancel:hover { background: #555; }
      .confirm-btn.confirm { background: linear-gradient(180deg, #27ae60, #1e8449); color: #fff; }
      .confirm-btn.confirm:hover { background: linear-gradient(180deg, #2ecc71, #27ae60); }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);

  overlay.querySelector('.cancel').onclick = () => {
    overlay.remove();
    if (onCancel) onCancel();
  };

  overlay.querySelector('.confirm').onclick = () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  };

  return overlay;
}

// Export to global scope
window.GameNotify = {
  showNotify,
  showConfirm
};

// Also export directly for backward compatibility
window.showNotify = showNotify;
window.showConfirm = showConfirm;
