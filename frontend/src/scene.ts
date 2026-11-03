import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* The 3-D rack on the dashboard. Moved out of main.ts unchanged in look and behaviour;
   it now just asks for the current items instead of owning them. */

export const COLS = 4, LEVELS = 3, SLOTS = COLS * LEVELS, CAP = 200;

/** `reorder` is the product's own low-stock level: a box glows red when its quantity is below it. */
export type SceneItem = { sku: string; name: string; qty: number; slot: number | null; reorder: number };

type Box = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> & { cur: number; glow: number };

export function createScene(host: HTMLDivElement, tip: HTMLDivElement, getItems: () => SceneItem[], onPick: (sku: string) => void) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    // No WebGL (very old browser, remote desktop, graphics blocked): the rest of the app keeps working without the rack.
    host.classList.add('scene-unavailable');
    host.textContent = '3D rack view is unavailable because WebGL is turned off or not supported in this browser.';
    return { sync() {}, flash() {}, resize() {} };
  }
  renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 2), 3));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(6, 5, 9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 5; controls.maxDistance = 20;

  scene.background = new THREE.Color(0xeae7e3);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e5e0, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 30;
  sun.shadow.bias = -0.0002;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(-5, 3, -6);
  scene.add(fill);

  const floor = new THREE.GridHelper(16, 16, 0xc0bdb8, 0xd4d0cb);
  scene.add(floor);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0xeae7e3, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);

  const W = 1.2, GAP = 1.5;
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 });
  for (let l = 0; l <= LEVELS; l++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(COLS * W + 0.2, 0.1, W), rackMat);
    plank.position.y = l * GAP - 0.05;
    plank.castShadow = true;
    plank.receiveShadow = true;
    scene.add(plank);
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, LEVELS * GAP, 0.1), rackMat);
    post.position.set(x * (COLS * W) / 2, (LEVELS * GAP) / 2 - 0.05, z * (W / 2 - 0.05));
    post.castShadow = true;
    post.receiveShadow = true;
    scene.add(post);
  }

  const slotXZ = (slot: number) => ({
    x: ((slot % COLS) - (COLS - 1) / 2) * W,
    base: Math.floor(slot / COLS) * GAP,
  });
  const height = (qty: number) => 0.15 + Math.min(qty, CAP) / CAP * 1.1;
  const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) / 360;
  const boxSaturation = 0.3;
  const boxLightness = 0.45;

  const boxes = new Map<string, Box>();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  /** Makes the boxes match the current items: adds new ones, resizes existing ones, removes the ones that are gone. */
  function sync() {
    const items = getItems().filter((it) => it.slot !== null && it.slot >= 0 && it.slot < SLOTS);
    const live = new Set(items.map((it) => it.sku));
    for (const [sku, b] of boxes) {
      if (!live.has(sku)) { scene.remove(b); b.material.dispose(); boxes.delete(sku); }
    }
    for (const it of items) {
      let b = boxes.get(it.sku);
      if (!b) {
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue(it.sku), boxSaturation, boxLightness), roughness: 0.4, metalness: 0.3 });
        b = Object.assign(new THREE.Mesh(boxGeo, mat), { cur: 0.01, glow: 1 }) as Box;
        b.userData.sku = it.sku;
        b.castShadow = true;
        b.receiveShadow = true;
        scene.add(b);
        boxes.set(it.sku, b);
      }
      b.userData.target = height(it.qty);
      b.material.emissive.set(it.qty < it.reorder ? 0xc43e2a : 0x000000);
    }
  }

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  function pick(e: PointerEvent): Box | undefined {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    return ray.intersectObjects([...boxes.values()])[0]?.object as Box | undefined;
  }
  renderer.domElement.addEventListener('pointermove', (e) => {
    const b = pick(e), it = getItems().find((i) => i.sku === b?.userData.sku);
    tip.style.opacity = it ? '1' : '0';
    if (it) {
      // textContent, not innerHTML: product names come from the database and are never treated as HTML
      tip.textContent = `${it.sku} · ${it.name} · ${it.qty} units`;
      tip.style.left = e.offsetX + 14 + 'px'; tip.style.top = e.offsetY + 14 + 'px';
    }
  });
  renderer.domElement.addEventListener('click', (e) => {
    const b = pick(e);
    if (b) onPick(b.userData.sku);
  });

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flashColor = new THREE.Color();
  (function loop() {
    requestAnimationFrame(loop);
    for (const it of getItems()) {
      const b = boxes.get(it.sku);
      if (!b || it.slot === null) continue;
      const t = b.userData.target as number;
      b.cur += (t - b.cur) * (still ? 1 : 0.12);
      const { x, base } = slotXZ(it.slot);
      b.scale.set(0.95, b.cur, 0.95);
      b.position.set(x, base + b.cur / 2, 0);
      b.glow *= 0.92;
      b.material.emissiveIntensity = it.qty < it.reorder ? 0.5 : 0;
      if (b.glow > 0.02) b.material.emissive.lerp(flashColor.set(b.userData.flash ?? 0x000000), b.glow * 0.3);
    }
    controls.update();
    renderer.render(scene, camera);
  })();

  /** Briefly lights up a box: green for stock in, orange for stock out. */
  function flash(sku: string, type: 'IN' | 'OUT') {
    const b = boxes.get(sku);
    if (b) { b.glow = 1; b.userData.flash = type === 'IN' ? 0x3ecf8e : 0xff7a59; }
  }

  return { sync, flash, resize };
}
