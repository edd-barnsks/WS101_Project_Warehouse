import './login.css';
import * as THREE from 'three';
import { enablePasswordToggles } from './password-toggle';
import { ApiError, api, getSession, pageUrl, removeLegacyCredentials, roleLabel, setSession, toRole, type Role } from './api';

enablePasswordToggles();
removeLegacyCredentials();   // older versions of this app stored plain-text passwords in localStorage

function showLoader(text: string) {
  const loader = document.getElementById('loadingOverlay');
  if (loader) {
    const textEl = loader.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
    loader.classList.remove('hidden');
  }
}

function hideLoader() {
  document.getElementById('loadingOverlay')?.classList.add('hidden');
}

function showError(msgId: string, text: string) {
  const msgEl = document.getElementById(msgId);
  if (msgEl) {
    msgEl.textContent = text;
    msgEl.classList.add('error');

    // Add a little shake effect (defined in CSS if needed, or just visual)
    msgEl.style.animation = 'none';
    msgEl.offsetHeight; // trigger reflow
    msgEl.style.animation = 'shake 0.4s ease';
  }
}

function clearError(msgId: string) {
  const msgEl = document.getElementById(msgId);
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.classList.remove('error');
  }
}

/* ── Already signed in on this tab? Go straight to the app. ── */
if (getSession()) window.location.replace(pageUrl('app.html'));

if (new URLSearchParams(window.location.search).get('expired') === '1') {
  const msg = 'Your session has ended. Please sign in again.';
  showError('empMsg', msg);
  showError('adminMsg', msg);
  history.replaceState(null, '', window.location.pathname);
}

type LoginReply = {
  token: string; expires_in: number;
  staff: { StaffID: number; StaffName: string; Username: string; Role: string };
};

function friendlyLoginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const mins = err.retryAfter ? Math.max(1, Math.ceil(err.retryAfter / 60)) : 15;
      return `Too many failed attempts. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`;
    }
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

/** Signs in through the API. The tab (Cashier / Admin) must match the account's role. */
async function signIn(role: Role, form: { user: string; pass: string; msg: string; btn: string; btnText: string }) {
  const username = (document.getElementById(form.user) as HTMLInputElement).value.trim();
  const password = (document.getElementById(form.pass) as HTMLInputElement).value;
  const button = document.getElementById(form.btn) as HTMLButtonElement;
  const label = document.getElementById(form.btnText);

  if (!username || !password) {
    showError(form.msg, 'Please enter both username and password.');
    return;
  }
  clearError(form.msg);
  button.disabled = true;
  if (label) label.textContent = 'Signing in…';

  try {
    const reply = await api<LoginReply>('POST', '/auth/login', { Username: username, Password: password }, { auth: false });
    const accountRole = toRole(reply.staff.Role);

    if (accountRole !== role) {
      // Right password, wrong tab: end that login straight away and point to the right tab.
      await api('POST', '/auth/logout', undefined, { token: reply.token }).catch(() => undefined);
      showError(form.msg, role === 'admin'
        ? 'This account is a Cashier. Use the Cashier tab to sign in.'
        : 'This account is an Admin. Use the Admin tab to sign in.');
      return;
    }

    setSession({
      token: reply.token,
      expiresAt: Date.now() + reply.expires_in * 1000,
      staffId: reply.staff.StaffID,
      username: reply.staff.Username,
      name: reply.staff.StaffName,
      role: accountRole,
    });
    (document.getElementById(form.pass) as HTMLInputElement).value = '';
    showLoader(`Authenticating as ${roleLabel(accountRole)}...`);
    setTimeout(() => { window.location.href = pageUrl('app.html'); }, 600);
  } catch (err) {
    showError(form.msg, friendlyLoginError(err));
  } finally {
    button.disabled = false;
    if (label) label.textContent = 'Login';
  }
}

document.getElementById('employeeForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  void signIn('employee', { user: 'empUsername', pass: 'empPassword', msg: 'empMsg', btn: 'empBtn', btnText: 'empBtnText' });
});

document.getElementById('adminForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  void signIn('admin', { user: 'adminUsername', pass: 'adminPassword', msg: 'adminMsg', btn: 'adminBtn', btnText: 'adminBtnText' });
});

/* ── loading overlay ── */
window.addEventListener('load', () => {
  setTimeout(() => {
    if (!document.getElementById('loadingOverlay')?.classList.contains('hidden') && !getSession()) hideLoader();
  }, 500);
});

/* ── "Forgot password?" ──
   Passwords are stored as one-way hashes on the server and nobody can look them up or reset them from this screen.
   An administrator resets them from Users > edit the account > New password. */
const resetOverlay = document.getElementById('resetModal') as HTMLElement;
const resetDesc = document.getElementById('resetDesc') as HTMLElement;

function openResetModal(role: Role) {
  resetDesc.innerHTML = role === 'admin'
    ? `For security, passwords can't be reset from this screen.<br><br>Ask <strong>another administrator</strong> to reset it for you in <strong>Users</strong>. If you are the only administrator, whoever runs the server can create a new admin with <strong>php create_admin.php</strong>.`
    : `For security, passwords can't be reset from this screen.<br><br>Ask an <strong>administrator</strong> to set a new password for you in <strong>Users</strong>.`;
  resetOverlay.classList.add('open');
  requestAnimationFrame(() => document.getElementById('closeResetSuccess')?.focus());
}

function closeResetModal() {
  resetOverlay.classList.remove('open');
}

document.getElementById('forgotCashier')?.addEventListener('click', () => openResetModal('employee'));
document.getElementById('forgotAdmin')?.addEventListener('click', () => openResetModal('admin'));
document.getElementById('closeResetModal')?.addEventListener('click', closeResetModal);
document.getElementById('closeResetSuccess')?.addEventListener('click', closeResetModal);

// Close on backdrop click
resetOverlay.addEventListener('click', (e) => {
  if (e.target === resetOverlay) closeResetModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && resetOverlay.classList.contains('open')) closeResetModal();
});


// --- 3D Background Mosaic Tiles ---
function init3DBackground() {
  const canvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  
  const scene = new THREE.Scene();

  // Create an isometric camera
  const aspect = window.innerWidth / window.innerHeight;
  const d = 25;
  const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
  camera.position.set(30, 30, 30);
  camera.lookAt(scene.position);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Blue accent point light
  const pointLight = new THREE.PointLight(0x3b82f6, 500, 150);
  pointLight.position.set(0, 15, 0);
  scene.add(pointLight);

  // Instanced mesh for tiles
  const gridSize = 35; // 35x35 grid
  const boxSize = 1.95;
  const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
  
  // Metallic material with #999999 color
  const material = new THREE.MeshStandardMaterial({ 
    color: 0x999999, 
    roughness: 0.1, 
    metalness: 0.8 
  });
  
  const mesh = new THREE.InstancedMesh(geometry, material, gridSize * gridSize);
  
  const dummy = new THREE.Object3D();
  let idx = 0;
  const offset = (gridSize * 2) / 2;
  
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      const posX = x * 2 - offset;
      const posZ = z * 2 - offset;
      dummy.position.set(posX, 0, posZ);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
  }
  scene.add(mesh);

  // Animation loop
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    
    // Animate tiles in a gentle wave pattern
    let i = 0;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const posX = x * 2 - offset;
        const posZ = z * 2 - offset;
        
        // sine wave math
        const y = Math.sin(posX * 0.15 + time * 0.8) * Math.cos(posZ * 0.15 + time * 0.8) * 2;
        
        dummy.position.set(posX, y, posZ);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    
    // Slow rotation of the scene for a dynamic feel
    scene.rotation.y = time * 0.03;

    renderer.render(scene, camera);
  }
  
  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

try { init3DBackground(); } catch { /* no WebGL: the page just keeps its plain background */ }

