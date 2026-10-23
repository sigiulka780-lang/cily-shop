// Cily Shop - Main JavaScript

document.addEventListener('DOMContentLoaded', () => {
  initBuyButtons();
  initSmoothScroll();
  initAnimations();
});

function initBuyButtons() {
  const buttons = document.querySelectorAll('.btn-buy');
  const modal = document.getElementById('payment-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const payBtn = document.getElementById('pay-btn');
  const payAmount = document.getElementById('pay-amount');
  const emailInput = document.getElementById('email');
  
  let currentPlan = null;
  
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      currentPlan = {
        id: btn.dataset.planId,
        name: btn.dataset.planName,
        price: btn.dataset.planPrice
      };
      modalTitle.textContent = `Оплата: ${currentPlan.name}`;
      modalSubtitle.textContent = `${currentPlan.price.toLocaleString('ru-RU')} ₽ за ${getPlanDuration(currentPlan.id)}`;
      payAmount.textContent = currentPlan.price.toLocaleString('ru-RU');
      emailInput.value = '';
      modal.showModal();
    });
  });
  
  modal.addEventListener('close', () => {
    currentPlan = null;
  });
  
  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentPlan) return;
    
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      showToast('Введите корректный email');
      return;
    }
    
    payBtn.disabled = true;
    payBtn.textContent = 'Перенаправление...';
    
    try {
      const res = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: currentPlan.id, email })
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Payment failed');
      
      // Redirect to YooKassa
      window.location.href = data.paymentUrl;
    } catch (err) {
      showToast(err.message);
      payBtn.disabled = false;
      payBtn.innerHTML = `Оплатить <span id="pay-amount">${currentPlan.price.toLocaleString('ru-RU')}</span> ₽`;
    }
  });
  
  // Close modal on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
}

function getPlanDuration(id) {
  const map = { week: '7 дней', month: '30 дней', quarter: '90 дней' };
  return map[id] || '';
}

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerOffset = 72;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
    });
  });
}

function initAnimations() {
  // Intersection Observer for fade-in
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
  
  document.querySelectorAll('.feature-card, .pricing-card, .step, .faq-item').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 600ms ease, transform 600ms ease';
    observer.observe(el);
  });
}

function showToast(message) {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 1000;
    background: var(--bg-card); border: 1px solid var(--border);
    color: var(--fg); padding: 14px 20px; border-radius: var(--radius);
    box-shadow: var(--shadow); animation: slideIn 300ms ease;
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideOut { to { opacity: 0; transform: translateX(100px); } }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 300ms ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Expose for potential use
window.CilyShop = { showToast };