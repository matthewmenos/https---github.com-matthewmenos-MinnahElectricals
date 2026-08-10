/**
 * Scene Factory Module
 * Creates modular 3D object collections for different use cases
 */

// Floating geometric shapes with electrical theme
export function createElectricalScene(scene, objects) {
  // Create floating torus knots (representing electrical currents)
  const torusGeometry = new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16);
  const torusMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b, // Amber
    metalness: 0.7,
    roughness: 0.2,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.3
  });
  const torus = new THREE.Mesh(torusGeometry, torusMaterial);
  torus.position.set(2, 0, 0);
  scene.add(torus);
  objects.push({
    mesh: torus,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.1 : 0.3;
      torus.rotation.x += 0.01 * speed;
      torus.rotation.y += 0.015 * speed;
      torus.position.y = Math.sin(Date.now() * 0.001) * 0.3;
      torus.position.x = 2 + mouse.x * 0.5;
    }
  });

  // Create icosahedron (representing energy nodes)
  const icoGeometry = new THREE.IcosahedronGeometry(0.6, 0);
  const icoMaterial = new THREE.MeshStandardMaterial({
    color: 0x0F172A, // Navy
    metalness: 0.8,
    roughness: 0.3,
    flatShading: true
  });
  const icosahedron = new THREE.Mesh(icoGeometry, icoMaterial);
  icosahedron.position.set(-2, 1, -1);
  scene.add(icosahedron);
  objects.push({
    mesh: icosahedron,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.1 : 0.5;
      icosahedron.rotation.x += 0.008 * speed;
      icosahedron.rotation.y += 0.01 * speed;
      icosahedron.position.y = 1 + Math.cos(Date.now() * 0.0012) * 0.4;
      icosahedron.position.x = -2 + mouse.x * 0.3;
    }
  });

  // Create octahedron (representing power)
  const octGeometry = new THREE.OctahedronGeometry(0.5, 0);
  const octMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.6,
    roughness: 0.4,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.2
  });
  const octahedron = new THREE.Mesh(octGeometry, octMaterial);
  octahedron.position.set(0, -1.5, 0);
  scene.add(octahedron);
  objects.push({
    mesh: octahedron,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.1 : 0.4;
      octahedron.rotation.x += 0.012 * speed;
      octahedron.rotation.z += 0.008 * speed;
      octahedron.position.y = -1.5 + Math.sin(Date.now() * 0.0015) * 0.35;
      octahedron.position.x = mouse.x * 0.4;
    }
  });

  // Create small floating particles
  const particleCount = 20;
  const particleGeometry = new THREE.SphereGeometry(0.05, 8, 8);
  const particleMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.5
  });

  for (let i = 0; i < particleCount; i++) {
    const particle = new THREE.Mesh(particleGeometry, particleMaterial);
    particle.position.set(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 4
    );
    scene.add(particle);
    objects.push({
      mesh: particle,
      update: (mouse, prefersReducedMotion) => {
        const speed = prefersReducedMotion ? 0.05 : 0.2;
        particle.position.y += Math.sin(Date.now() * 0.002 + i) * 0.002 * speed;
        particle.position.x += Math.cos(Date.now() * 0.0015 + i) * 0.001 * speed;
      }
    });
  }
}

// Minimal floating shapes for subtle background
export function createMinimalScene(scene, objects) {
  // Single large torus
  const torusGeometry = new THREE.TorusGeometry(1.2, 0.3, 16, 100);
  const torusMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.7,
    roughness: 0.3,
    transparent: true,
    opacity: 0.8
  });
  const torus = new THREE.Mesh(torusGeometry, torusMaterial);
  scene.add(torus);
  objects.push({
    mesh: torus,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.1 : 0.2;
      torus.rotation.x += 0.005 * speed;
      torus.rotation.y += 0.008 * speed;
      torus.position.x = mouse.x * 0.3;
      torus.position.y = mouse.y * 0.3;
    }
  });

  // Small accent sphere
  const sphereGeometry = new THREE.SphereGeometry(0.4, 32, 32);
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: 0x0F172A,
    metalness: 0.8,
    roughness: 0.2
  });
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphere.position.set(-2, -1, -1);
  scene.add(sphere);
  objects.push({
    mesh: sphere,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.1 : 0.3;
      sphere.position.y = -1 + Math.sin(Date.now() * 0.001) * 0.3;
      sphere.position.x = -2 + mouse.x * 0.2;
    }
  });
}

// Interactive button-style 3D element
export function createButtonScene(scene, objects) {
  // Central glowing sphere
  const sphereGeometry = new THREE.SphereGeometry(0.8, 32, 32);
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.6,
    roughness: 0.2,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.4
  });
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  scene.add(sphere);
  objects.push({
    mesh: sphere,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.1 : 0.4;
      sphere.rotation.y += 0.01 * speed;
      sphere.scale.setScalar(1 + Math.sin(Date.now() * 0.002) * 0.05);
      sphere.position.x = mouse.x * 0.5;
      sphere.position.y = mouse.y * 0.5;
    }
  });

  // Orbiting ring
  const ringGeometry = new THREE.TorusGeometry(1.3, 0.05, 16, 100);
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x0F172A,
    metalness: 0.9,
    roughness: 0.1
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  scene.add(ring);
  objects.push({
    mesh: ring,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.1 : 0.6;
      ring.rotation.x = Math.PI / 2 + Math.sin(Date.now() * 0.001 * speed) * 0.3;
      ring.rotation.y += 0.02 * speed;
    }
  });
}

// Particle field background
export function createParticleField(scene, objects) {
  const particleCount = 50;
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 10;
    positions[i + 1] = (Math.random() - 0.5) * 10;
    positions[i + 2] = (Math.random() - 0.5) * 10;
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const particleMaterial = new THREE.PointsMaterial({
    color: 0xf59e0b,
    size: 0.05,
    transparent: true,
    opacity: 0.6
  });

  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);
  objects.push({
    mesh: particles,
    update: (mouse, prefersReducedMotion) => {
      const speed = prefersReducedMotion ? 0.05 : 0.15;
      particles.rotation.y += 0.001 * speed;
      particles.rotation.x += 0.0005 * speed;
      particles.position.x = mouse.x * 0.2;
      particles.position.y = mouse.y * 0.2;
    }
  });
}