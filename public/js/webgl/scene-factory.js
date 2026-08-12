/**
 * Scene Factory - first-class header 3D scenes
 *
 * Builds rich, gently-animated 3D object collections for the page headers.
 * Functions are attached to `window` so they can run as classic scripts.
 *
 * Each object's `update(mouse, reduced, t)` is called every frame by
 * WebGLScene with:
 *   mouse   - {x, y} normalized (-1..1), smoothed
 *   reduced - true when the user prefers reduced motion
 *   t       - elapsed seconds since the scene started (smooth clock)
 */

// Shared brand palette
const WEBGL_PALETTE = {
  amber: 0xf59e0b,      // primary brand gold
  amberLight: 0xfbbf24, // soft gold
  navy: 0x0f172a,       // slate navy
  navyDeep: 0x0b1220,   // deep navy (background)
  violet: 0x8b5cf6,     // electric violet accent
  cyan: 0x22d3ee        // cyan accent
};

const WEBGL_TAU = Math.PI * 2;

// Add a mesh to the scene and register it with the animation loop
function webglRegister(scene, objects, mesh, update) {
  scene.add(mesh);
  objects.push({ mesh, update });
  return mesh;
}

// Build an additive radial "glow" billboard (softer than raw point sprites)
function webglMakeGlow(color, size, opacity) {
  const d = 128;
  const canvas = document.createElement('canvas');
  canvas.width = d;
  canvas.height = d;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, d, d);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: color,
    transparent: true,
    opacity: opacity == null ? 0.6 : opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// Build a drifting, twinkling particle field
function webglMakeField(scene, objects, count, spread, size, opacity) {
  const P = WEBGL_PALETTE;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const ca = new THREE.Color(P.amber);
  const cv = new THREE.Color(P.violet);
  const cc = new THREE.Color(P.cyan);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread[0];
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread[1];
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread[2];
    const c = Math.random() < 0.5 ? ca : (Math.random() < 0.5 ? cv : cc);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: size,
    vertexColors: true,
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });

  const points = new THREE.Points(geo, material);
  scene.add(points);
  objects.push({
    mesh: points,
    update(mouse, reduced, t) {
      const s = reduced ? 0.15 : 1;
      points.rotation.y = t * 0.02 * s;
      points.rotation.x = t * 0.01 * s;
      points.position.set(mouse.x * 0.4, mouse.y * 0.28, 0);
      material.opacity = opacity * (0.8 + (Math.sin(t * 2.4) + 1) / 2 * 0.3);
    }
  });
  return points;
}

// ---------------------------------------------------------------------------
// Hero — rich, layered energy scene (index page)
// ---------------------------------------------------------------------------
window.createElectricalScene = function createElectricalScene(scene, objects) {
  const P = WEBGL_PALETTE;

  // Central energy core
  const coreMat = new THREE.MeshStandardMaterial({
    color: P.navyDeep,
    metalness: 0.85,
    roughness: 0.18,
    emissive: P.amber,
    emissiveIntensity: 0.4
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), coreMat);
  webglRegister(scene, objects, core, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    core.rotation.x += 0.0035 * s;
    core.rotation.y += 0.005 * s;
    const pulse = (Math.sin(t * 2.4) + 1) / 2;
    coreMat.emissiveIntensity = 0.35 + pulse * 0.5;
    core.scale.setScalar(1 + Math.sin(t * 1.7 + 1.3) * 0.025);
    core.position.set(mouse.x * 0.45, mouse.y * 0.32, 0);
  });

  // Wireframe energy shell
  const shellMat = new THREE.MeshBasicMaterial({
    color: P.violet,
    wireframe: true,
    transparent: true,
    opacity: 0.26
  });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), shellMat);
  webglRegister(scene, objects, shell, (mouse, reduced, t) => {
    const s = reduced ? 0.15 : 1;
    shell.rotation.x = t * 0.14 * s;
    shell.rotation.y = -t * 0.2 * s;
    shell.position.set(mouse.x * 0.3, mouse.y * 0.22, 0);
  });

  // Soft glow behind the core
  const glow = webglMakeGlow(P.amber, 3.4, 0.5);
  webglRegister(scene, objects, glow, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    const size = 3.4 + Math.sin(t * 2.0) * 0.4 * s;
    glow.scale.set(size, size, 1);
    glow.position.set(mouse.x * 0.45, mouse.y * 0.32, -0.5);
  });

  // Orbiting rings
  const rings = [
    { r: 2.3, tube: 0.035, tilt: 1.35, color: P.amberLight, solid: false, alpha: 0.5, speed: 0.28, phase: 0.0 },
    { r: 2.8, tube: 0.045, tilt: 1.72, color: P.cyan, solid: false, alpha: 0.4, speed: -0.2, phase: 2.1 },
    { r: 3.4, tube: 0.02, tilt: 2.2, color: P.violet, solid: true, alpha: 0.9, speed: 0.34, phase: 4.2 }
  ];
  rings.forEach((d) => {
    const mat = d.solid
      ? new THREE.MeshStandardMaterial({
          color: P.navy,
          metalness: 0.92,
          roughness: 0.12,
          emissive: d.color,
          emissiveIntensity: 0.35,
          transparent: true,
          opacity: d.alpha
        })
      : new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: d.alpha });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, d.tube, 14, 140), mat);
    webglRegister(scene, objects, ring, (mouse, reduced, t) => {
      const s = reduced ? 0.2 : 1;
      ring.rotation.y = t * d.speed * s + d.phase;
      ring.rotation.x = d.tilt + Math.sin(t * 0.25 * s + d.phase) * 0.12;
      ring.rotation.z = Math.cos(t * 0.2 * s + d.phase) * 0.14;
      ring.position.set(mouse.x * 0.15, mouse.y * 0.1, 0);
    });
  });

  // Energy mote field
  webglMakeField(scene, objects, 80, [16, 10, 8], 0.06, 0.7);

  // Floating accent shapes
  const accents = Array.from({ length: 6 }, (_, i) => ({
    radius: 2.6 + (i % 3) * 0.55,
    angle: (i / 6) * WEBGL_TAU + i * 1.9,
    y: (Math.random() - 0.5) * 4.2,
    z: (Math.random() - 0.5) * 1.6,
    geo: i % 2 === 0 ? new THREE.OctahedronGeometry(0.26, 0) : new THREE.TetrahedronGeometry(0.3, 0),
    color: i % 3 === 0 ? P.cyan : (i % 2 === 1 ? P.violet : P.amberLight),
    phase: i * 1.37
  }));

  accents.forEach((d) => {
    const mat = new THREE.MeshStandardMaterial({
      color: P.navy,
      metalness: 0.85,
      roughness: 0.22,
      emissive: d.color,
      emissiveIntensity: 0.5
    });
    const m = new THREE.Mesh(d.geo, mat);
    m.position.set(Math.cos(d.angle) * d.radius, d.y, Math.sin(d.angle) * d.radius * 0.4);
    webglRegister(scene, objects, m, (mouse, reduced, t) => {
      const s = reduced ? 0.2 : 1;
      const a = d.angle + t * (0.12 + d.radius * 0.02) * s;
      m.rotation.x += 0.01 * s;
      m.rotation.y += 0.013 * s;
      m.position.x = Math.cos(a) * d.radius + mouse.x * 0.25;
      m.position.z = Math.sin(a) * d.radius * 0.42;
      m.position.y = d.y + Math.sin(t * (0.7 + d.radius * 0.12) + d.phase) * 0.35 + mouse.y * 0.18;
      mat.emissiveIntensity = 0.35 + (Math.sin(t * 3.2 + d.phase) + 1) / 2 * 0.55;
    });
  });
};

// ---------------------------------------------------------------------------
// Minimal — lighter layered scene (portfolio, gallery, and other page headers)
// ---------------------------------------------------------------------------
window.createMinimalScene = function createMinimalScene(scene, objects) {
  const P = WEBGL_PALETTE;

  // Central energy core
  const coreMat = new THREE.MeshStandardMaterial({
    color: P.navyDeep,
    metalness: 0.85,
    roughness: 0.2,
    emissive: P.amber,
    emissiveIntensity: 0.4
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), coreMat);
  webglRegister(scene, objects, core, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    core.rotation.x += 0.004 * s;
    core.rotation.y += 0.006 * s;
    const pulse = (Math.sin(t * 2.3) + 1) / 2;
    coreMat.emissiveIntensity = 0.35 + pulse * 0.5;
    core.scale.setScalar(1 + Math.sin(t * 1.7) * 0.03);
    core.position.set(mouse.x * 0.5, mouse.y * 0.35, 0);
  });

  // Wireframe shell
  const shellMat = new THREE.MeshBasicMaterial({
    color: P.violet,
    wireframe: true,
    transparent: true,
    opacity: 0.22
  });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), shellMat);
  webglRegister(scene, objects, shell, (mouse, reduced, t) => {
    const s = reduced ? 0.15 : 1;
    shell.rotation.x = t * 0.16 * s;
    shell.rotation.y = -t * 0.22 * s;
    shell.position.set(mouse.x * 0.32, mouse.y * 0.24, 0);
  });

  // Soft glow
  const glow = webglMakeGlow(P.amber, 3.0, 0.5);
  webglRegister(scene, objects, glow, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    const size = 3.0 + Math.sin(t * 2.0) * 0.35 * s;
    glow.scale.set(size, size, 1);
    glow.position.set(mouse.x * 0.5, mouse.y * 0.35, -0.5);
  });

  // Orbiting ring
  const ringMat = new THREE.MeshBasicMaterial({ color: P.cyan, transparent: true, opacity: 0.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.04, 12, 120), ringMat);
  webglRegister(scene, objects, ring, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    ring.rotation.y = t * 0.35 * s;
    ring.rotation.x = 1.45 + Math.sin(t * 0.3 * s) * 0.15;
    ring.position.set(mouse.x * 0.2, mouse.y * 0.15, 0);
  });

  // Mote field
  webglMakeField(scene, objects, 55, [12, 8, 6], 0.06, 0.65);

  // Floating accents
  for (let i = 0; i < 4; i++) {
    const radius = 2.2 + (i % 2) * 0.7;
    const angle = (i / 4) * WEBGL_TAU + i;
    const color = i % 2 === 0 ? P.cyan : P.amberLight;
    const mat = new THREE.MeshStandardMaterial({
      color: P.navy,
      metalness: 0.85,
      roughness: 0.22,
      emissive: color,
      emissiveIntensity: 0.5
    });
    const m = new THREE.Mesh(
      i % 3 === 0 ? new THREE.OctahedronGeometry(0.24, 0) : new THREE.TetrahedronGeometry(0.27, 0),
      mat
    );
    const y = (Math.random() - 0.5) * 3.6;
    m.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius * 0.4);
    webglRegister(scene, objects, m, (mouse, reduced, t) => {
      const s = reduced ? 0.2 : 1;
      const a = angle + t * 0.14 * s;
      m.rotation.x += 0.01 * s;
      m.rotation.y += 0.015 * s;
      m.position.x = Math.cos(a) * radius + mouse.x * 0.28;
      m.position.z = Math.sin(a) * radius * 0.4;
      m.position.y = y + Math.sin(t * (0.7 + i * 0.2) + i) * 0.35 + mouse.y * 0.2;
      mat.emissiveIntensity = 0.35 + (Math.sin(t * 3.0 + i * 1.3) + 1) / 2 * 0.5;
    });
  }
};

// ---------------------------------------------------------------------------
// Button — interactive glowing orb (for CTA-style 3D elements)
// ---------------------------------------------------------------------------
window.createButtonScene = function createButtonScene(scene, objects) {
  const P = WEBGL_PALETTE;

  const sphereMat = new THREE.MeshStandardMaterial({
    color: P.navyDeep,
    metalness: 0.7,
    roughness: 0.15,
    emissive: P.amber,
    emissiveIntensity: 0.5
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 48), sphereMat);
  webglRegister(scene, objects, sphere, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    sphere.rotation.y += 0.008 * s;
    sphere.scale.setScalar(1 + Math.sin(t * 2.2) * 0.05 * s);
    sphere.position.set(mouse.x * 0.5, mouse.y * 0.5, 0);
    sphereMat.emissiveIntensity = 0.4 + (Math.sin(t * 2.6) + 1) / 2 * 0.4;
  });

  const glow = webglMakeGlow(P.amber, 2.6, 0.55);
  webglRegister(scene, objects, glow, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    const size = 2.6 + Math.sin(t * 2.0) * 0.3 * s;
    glow.scale.set(size, size, 1);
    glow.position.set(mouse.x * 0.5, mouse.y * 0.5, -0.4);
  });

  const ringMat = new THREE.MeshStandardMaterial({
    color: P.navy,
    metalness: 0.9,
    roughness: 0.1,
    emissive: P.violet,
    emissiveIntensity: 0.3
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.05, 16, 120), ringMat);
  webglRegister(scene, objects, ring, (mouse, reduced, t) => {
    const s = reduced ? 0.2 : 1;
    ring.rotation.y = t * 0.5 * s;
    ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.4 * s) * 0.3;
  });
};

// ---------------------------------------------------------------------------
// ParticleField — ambient stardust background
// ---------------------------------------------------------------------------
window.createParticleField = function createParticleField(scene, objects) {
  webglMakeField(scene, objects, 120, [16, 12, 10], 0.05, 0.6);
};