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

    // Start animation loop
    this.animate();
  }

  createScene() {
    this.scene = new THREE.Scene();
  }

  createCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.camera.position.z = 5;
  }

  createRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.options.antialias,
      alpha: this.options.alpha
    });

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(this.options.pixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    this.container.appendChild(this.renderer.domElement);
  }

  addLights() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    // Directional light
    const directionalLight = new THREE.DirectionalLight(0xf59e0b, 1);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);

    // Point light for accent
    const pointLight = new THREE.PointLight(0xf59e0b, 0.5);
    pointLight.position.set(-5, -5, 5);
    this.scene.add(pointLight);
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

    // Smooth mouse follow
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.05;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.05;

    // Update objects
    this.objects.forEach(obj => {
      if (obj.update) {
        obj.update(this.mouse, this.prefersReducedMotion);
      }
    });

    // Auto-rotate camera slightly
    if (this.options.autoRotate && !this.prefersReducedMotion) {
      this.camera.position.x = Math.sin(Date.now() * 0.0001 * this.options.rotateSpeed) * 0.5;
      this.camera.position.y = Math.cos(Date.now() * 0.0001 * this.options.rotateSpeed) * 0.5;
      this.camera.lookAt(this.scene.position);
    }

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

    // Dispose geometries and materials
    this.objects.forEach(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
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