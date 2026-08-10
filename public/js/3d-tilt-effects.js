/**
 * 3D Tilt Effects for Buttons and Cards
 * Lightweight CSS 3D transforms with mouse/touch interaction
 * Works on both desktop and mobile devices
 */

class TiltEffect {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      maxTilt: 15,              // Maximum tilt angle in degrees
      perspective: 1000,        // CSS perspective value
      scale: 1.05,              // Scale on hover
      speed: 400,               // Transition speed in ms
      glare: false,             // Add glare effect
      glareMaxOpacity: 0.3,     // Maximum glare opacity
      ...options
    };

    this.tilt = 0;
    this.tiltX = 0;
    this.tiltY = 0;
    this.isHovering = false;
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!this.prefersReducedMotion) {
      this.init();
    }
  }

  init() {
    // Add necessary styles
    this.element.style.transformStyle = 'preserve-3d';
    this.element.style.transition = `transform ${this.options.speed}ms ease-out`;
    this.element.style.willChange = 'transform';

    // Create glare element if enabled
    if (this.options.glare) {
      this.createGlare();
    }

    // Mouse events (desktop)
    this.element.addEventListener('mouseenter', (e) => this.onMouseEnter(e));
    this.element.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.element.addEventListener('mouseleave', () => this.onMouseLeave());

    // Touch events (mobile)
    this.element.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
    this.element.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: true });
    this.element.addEventListener('touchend', () => this.onMouseLeave());
  }

  createGlare() {
    this.glareElement = document.createElement('div');
    this.glareElement.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0) 40%,
        rgba(255, 255, 255, ${this.options.glareMaxOpacity}) 50%,
        rgba(255, 255, 255, 0) 60%,
        rgba(255, 255, 255, 0) 100%
      );
      transform: translateZ(1px);
      opacity: 0;
      transition: opacity ${this.options.speed}ms ease-out;
      border-radius: inherit;
    `;
    this.element.style.position = this.element.style.position || 'relative';
    this.element.appendChild(this.glareElement);
  }

  onMouseEnter(e) {
    this.isHovering = true;
    this.element.style.transition = `transform ${this.options.speed}ms ease-out`;
    if (this.glareElement) {
      this.glareElement.style.opacity = '1';
    }
  }

  onMouseMove(e) {
    if (!this.isHovering) return;

    const rect = this.element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    this.calculateTilt(x, y, rect.width, rect.height);
    this.applyTilt();
  }

  onTouchStart(e) {
    this.isHovering = true;
    this.element.style.transition = `transform ${this.options.speed}ms ease-out`;
  }

  onTouchMove(e) {
    if (!this.isHovering || !e.touches.length) return;

    const rect = this.element.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const y = e.touches[0].clientY - rect.top;
    
    this.calculateTilt(x, y, rect.width, rect.height);
    this.applyTilt();
  }

  onMouseLeave() {
    this.isHovering = false;
    this.element.style.transition = `transform ${this.options.speed}ms ease-out`;
    this.element.style.transform = `perspective(${this.options.perspective}px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
    
    if (this.glareElement) {
      this.glareElement.style.opacity = '0';
    }
  }

  calculateTilt(x, y, width, height) {
    // Calculate tilt based on mouse position
    const centerX = width / 2;
    const centerY = height / 2;
    
    const percentX = (x - centerX) / centerX;
    const percentY = (y - centerY) / centerY;
    
    // Invert Y axis for natural tilt direction
    this.tiltY = percentX * this.options.maxTilt;
    this.tiltX = -percentY * this.options.maxTilt;
  }

  applyTilt() {
    const scale = this.isHovering ? this.options.scale : 1;
    this.element.style.transform = `perspective(${this.options.perspective}px) rotateX(${this.tiltX}deg) rotateY(${this.tiltY}deg) scale3d(${scale}, ${scale}, ${scale})`;

    // Update glare position
    if (this.glareElement && this.isHovering) {
      const glareX = 50 + (this.tiltY / this.options.maxTilt) * 50;
      const glareY = 50 + (this.tiltX / this.options.maxTilt) * 50;
      this.glareElement.style.background = `linear-gradient(
        ${135 + this.tiltY * 2}deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0) 40%,
        rgba(255, 255, 255, ${this.options.glareMaxOpacity}) 50%,
        rgba(255, 255, 255, 0) 60%,
        rgba(255, 255, 255, 0) 100%
      )`;
    }
  }

  destroy() {
    this.element.style.transform = '';
    this.element.style.transition = '';
    this.element.style.transformStyle = '';
    this.element.style.willChange = '';
    
    if (this.glareElement && this.glareElement.parentNode) {
      this.glareElement.parentNode.removeChild(this.glareElement);
    }
  }
}

// Auto-initialize tilt effects on cards and buttons
function initTiltEffects() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    console.log('✓ Tilt effects disabled (prefers-reduced-motion)');
    return;
  }

  // Initialize on cards with .tilt-card class
  const cards = document.querySelectorAll('.tilt-card');
  cards.forEach(card => {
    new TiltEffect(card, {
      maxTilt: 10,
      scale: 1.02,
      speed: 300,
      glare: true,
      glareMaxOpacity: 0.2
    });
  });

  // Initialize on buttons with .tilt-button class
  const buttons = document.querySelectorAll('.tilt-button');
  buttons.forEach(button => {
    new TiltEffect(button, {
      maxTilt: 8,
      scale: 1.05,
      speed: 200,
      glare: false
    });
  });

  console.log(`✓ Initialized ${cards.length} tilt cards and ${buttons.length} tilt buttons`);
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTiltEffects);
} else {
  initTiltEffects();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TiltEffect, initTiltEffects };
}