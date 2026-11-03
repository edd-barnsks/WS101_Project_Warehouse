import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import './landing.css';

/* ─── Lenis smooth scrolling ─── */
const lenis = new Lenis({
  duration: 1.2,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
  touchMultiplier: 2,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

/* ─── Nav scroll effect ─── */
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });


/* ─── Mobile nav toggle ─── */
window.toggleNav = function () {
  const links = document.getElementById('navLinks');
  const actions = document.getElementById('navActions') || document.querySelector('.nav-actions');
  links?.classList.toggle('mobile-open');
  actions?.classList.toggle('mobile-open');
};

/* ─── Modal helpers ─── */
window.openModal = function (which) {
  const id = which === 'login' ? 'loginModal' : 'signupModal';
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
  lenis.stop();
};

window.closeModal = function (id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
  lenis.start();
};

window.overlayClose = function (e, id) {
  if (e.target === e.currentTarget) window.closeModal(id);
};

window.switchModal = function (fromId, toId) {
  window.closeModal(fromId);
  setTimeout(() => document.getElementById(toId)?.classList.add('open'), 150);
};

/* Close on Escape */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(el => {
      el.classList.remove('open');
      document.body.style.overflow = '';
    });
    lenis.start();
  }
});

/* ─── Password show / hide ─── */
window.togglePw = function (inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn?.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
};

/* ─── Password strength ─── */
window.checkStrength = function (val) {
  const fill  = document.getElementById('strengthFill');
  const label = document.getElementById('strengthLabel');
  if (!fill || !label) return;

  let score = 0;
  if (val.length >= 8)  score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const levels = [
    { pct: '0%',   color: 'transparent', text: '' },
    { pct: '25%',  color: '#ff7a59',     text: 'Weak' },
    { pct: '50%',  color: '#fb923c',     text: 'Fair' },
    { pct: '75%',  color: '#6ea8ff',     text: 'Good' },
    { pct: '100%', color: '#3ecf8e',     text: 'Strong' },
  ];
  const lv = levels[score];
  fill.style.width = lv.pct;
  fill.style.background = lv.color;
  label.textContent = lv.text;
  label.style.color = lv.color;
};

/* ─── Auth handlers (localStorage mock) ─── */
function setMsg(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'auth-msg ' + (isError ? 'err' : 'ok');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  const span = btn.querySelector('span');
  if (span) span.textContent = loading ? 'Please wait…' : btn.dataset.label || '';
}

function fakeDelay(ms) { return new Promise(r => setTimeout(r, ms)); }

window.handleLogin = async function (e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail')?.value.trim();
  const pw    = document.getElementById('loginPassword')?.value;
  setMsg('loginMsg', '', false);

  const users = JSON.parse(localStorage.getItem('wh-users') || '[]');
  const user  = users.find(u => u.email === email);

  const btn = document.getElementById('loginSubmit');
  if (btn) btn.dataset.label = btn.querySelector('span')?.textContent || 'Log in';
  setLoading('loginSubmit', true);
  await fakeDelay(700);
  setLoading('loginSubmit', false);

  if (!user || user.pw !== btoa(pw)) {
    setMsg('loginMsg', 'Invalid email or password.', true);
    return;
  }

  localStorage.setItem('wh-session', JSON.stringify({ email: user.email, name: user.name }));
  setMsg('loginMsg', `Welcome back, ${user.name}! Redirecting…`, false);
  setTimeout(() => { window.location.href = 'app.html'; }, 900);
};

window.handleSignup = async function (e) {
  e.preventDefault();
  const first   = document.getElementById('signupFirst')?.value.trim();
  const last    = document.getElementById('signupLast')?.value.trim();
  const email   = document.getElementById('signupEmail')?.value.trim();
  const pw      = document.getElementById('signupPassword')?.value;
  const confirm = document.getElementById('signupConfirm')?.value;

  setMsg('signupMsg', '', false);

  if (pw.length < 8)  { setMsg('signupMsg', 'Password must be at least 8 characters.', true); return; }
  if (pw !== confirm)  { setMsg('signupMsg', 'Passwords do not match.', true); return; }

  const btn = document.getElementById('signupSubmit');
  if (btn) btn.dataset.label = btn.querySelector('span')?.textContent || 'Create account';
  setLoading('signupSubmit', true);
  await fakeDelay(900);
  setLoading('signupSubmit', false);

  const users = JSON.parse(localStorage.getItem('wh-users') || '[]');
  if (users.find(u => u.email === email)) {
    setMsg('signupMsg', 'An account with this email already exists.', true);
    return;
  }

  const name = `${first} ${last}`;
  users.push({ email, name, pw: btoa(pw) });
  localStorage.setItem('wh-users', JSON.stringify(users));
  localStorage.setItem('wh-session', JSON.stringify({ email, name }));

  setMsg('signupMsg', `Account created! Welcome, ${name}. Redirecting…`, false);
  setTimeout(() => { window.location.href = 'app.html'; }, 1000);
};

/* ─── Stat counter animation ─── */
function animateCounter(el) {
  const target = parseInt(el.dataset.target || '0', 10);
  const suffix = el.dataset.suffix || '';
  const duration = 1800;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(ease * target) + suffix;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── Intersection Observer for reveal + counters ─── */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('.feature-card, .step, .section-header, .stat-block, .hero-content, .hero-visual').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});

document.querySelectorAll('.stat-num').forEach(el => counterObserver.observe(el));

/* ─── Auto-reveal elements already in viewport ─── */
document.querySelectorAll('.reveal').forEach(el => {
  const rect = el.getBoundingClientRect();
  if (rect.top < window.innerHeight) el.classList.add('visible');
});
