/**
 * Three.js WebGL Loader Module
 * Performance-optimized 3D scene initialization with IntersectionObserver
 * and mobile/reduced-motion safeguards
 */

class WebGLScene {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      antialias: true,
      alpha: true,
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      enableDamping: true,
      dampingFactor: 0.05,
      autoRotate: true,
      rotateSpeed: 0.5,
      ...options
    };

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.animationId = null;
    this.isVisible = false;
    this.objects = [];
    this.mouse = { x: 0, y: 0 };
    this.targetMouse = { x: 0, y: 0 };

    this.init();
  }

  init() {
    // Check for reduced motion preference
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Mobile detection
    this.isMobile = window.innerWidth <= 768;

    // Adjust settings for mobile
    if (this.isMobile) {
      this.options.pixelRatio = Math.min(window.devicePixelRatio, 1.5);
      this.options.autoRotate = false;
    }

    // Disable animations if reduced motion is preferred
    if (this.prefersReducedMotion) {
      this.options.autoRotate = false;
      this.options.enableDamping = false;
    }

    this.createScene();
    this.createCamera();
    this.createRenderer();
    this.addLights();
    this.createObjects();

    this.setupEventListeners();
    this.setupIntersectionObserver();

    // Animation clock (seconds since creation)
    this.startTime = performance.now();
    this.elapsed = 0;

    // Start animation loop
    this.animate();
  }

  createScene() {
    this.scene = new THREE.Scene();

    // Subtle fog for depth (blends distant objects toward deep navy)
    if (THREE.Fog) {
      this.scene.fog = new THREE.Fog(0x0b1220, 9, 17);
    }
  }

  createCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.camera.position.z = 5;
  }

  createRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.options.antialias,
      alpha: this.options.alpha,
      powerPreference: 'high-performance',
      stencil: false
    });

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(this.options.pixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    // Cinematic color grading
    if (THREE.SRGBColorSpace !== undefined) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    if (THREE.ACESFilmicToneMapping !== undefined) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);
  }

  addLights() {
    // Hemisphere light for gentle ambient color from above/sky
    const hemiLight = new THREE.HemisphereLight(0xfef3c7, 0x0b1220, 0.55);
    this.scene.add(hemiLight);

    // Soft base fill
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambientLight);

    // Warm key light
    const directionalLight = new THREE.DirectionalLight(0xf59e0b, 1.2);
    directionalLight.position.set(5, 6, 4);
    this.scene.add(directionalLight);

    // Central glow light (pulsed in animate())
    this.keyLight = new THREE.PointLight(0xf59e0b, 1.0, 22);
    this.keyLight.position.set(0, 2, 4);
    this.scene.add(this.keyLight);

    // Cool accent light (pulsed in animate())
    this.accentLight = new THREE.PointLight(0x8b5cf6, 0.6, 18);
    this.accentLight.position.set(-4, -2, 3);
    this.scene.add(this.accentLight);
  }

  createObjects() {
    // Override this method in subclasses or pass custom object factory
    if (this.options.objectFactory) {
      this.options.objectFactory(this.scene, this.objects);
    }
  }

  setupEventListeners() {
    // Mouse movement for parallax effect
    this.container.addEventListener('mousemove', (e) => {
      const rect = this.container.getBoundingClientRect();
      this.targetMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.targetMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    });

    // Touch movement for mobile
    this.container.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        const rect = this.container.getBoundingClientRect();
        this.targetMouse.x = ((e.touches[0].clientX - rect.left) / rect.width) * 2 - 1;
        this.targetMouse.y = -((e.touches[0].clientY - rect.top) / rect.height) * 2 + 1;
      }
    }, { passive: true });

    // Resize handler with debounce
    let resizeTimeout;
    this.resizeHandler = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this.onResize(), 100);
    };
    window.addEventListener('resize', this.resizeHandler);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => this.dispose());
  }

  setupIntersectionObserver() {
    const options = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        this.isVisible = entry.isIntersecting;
        if (this.isVisible) {
          this.animate();
        } else {
          this.stopAnimation();
        }
      });
    }, options);

    this.observer.observe(this.container);
  }

  onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.options.pixelRatio);
  }

  animate() {
    if (!this.isVisible) return;

    this.animationId = requestAnimationFrame(() => this.animate());

    // Elapsed clock (seconds since start) for smooth, frame-rate independent motion
    const t = (performance.now() - this.startTime) / 1000;
    this.elapsed = t;

    // Smooth mouse follow (damped)
    const damp = this.options.enableDamping ? this.options.dampingFactor : 1;
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * damp;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * damp;

    const reduced = this.prefersReducedMotion;
    const active = !reduced;

    // Update objects (pass elapsed time as a third argument)
    this.objects.forEach(obj => {
      if (obj.update) {
        obj.update(this.mouse, reduced, t);
      }
    });

    // Pulsing accent lights for a "live" glow
    if (this.keyLight) {
      this.keyLight.intensity = active ? 1.0 + Math.sin(t * 2.2) * 0.3 : 0.8;
    }
    if (this.accentLight) {
      this.accentLight.intensity = active ? 0.6 + Math.sin(t * 3.0 + 1.2) * 0.25 : 0.4;
    }

    // Camera: gentle auto-drift + mouse parallax, smoothly damped
    const auto = this.options.autoRotate && active;
    const bx = auto ? Math.sin(t * 0.3) * 0.45 : 0;
    const by = auto ? Math.sin(t * 0.22 + 1.7) * 0.3 : 0;
    const bz = auto ? Math.sin(t * 0.16) * 0.25 : 0;

    const mx = reduced ? 0.12 : 0.6;
    const my = reduced ? 0.12 : 0.42;

    const tx = bx + this.mouse.x * mx;
    const ty = by + this.mouse.y * my;
    const tz = 5 + bz;

    this.camera.position.x += (tx - this.camera.position.x) * damp;
    this.camera.position.y += (ty - this.camera.position.y) * damp;
    this.camera.position.z += (tz - this.camera.position.z) * damp;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  dispose() {
    this.stopAnimation();

    if (this.observer) {
      this.observer.disconnect();
    }

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }

    // Dispose geometries, materials and their textures
    this.objects.forEach(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }

    console.log('✓ WebGL scene disposed');
  }
}

// Export for use in Node/CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebGLScene;
}

// Expose as a global for classic (non-module) browser scripts
if (typeof window !== 'undefined') {
  window.WebGLScene = WebGLScene;
}