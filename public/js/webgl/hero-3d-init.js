/**
 * Hero 3D Scene Initialization
 * Loads Three.js via ES Module import map and initializes the hero section 3D canvas
 * 
 * Integration: Add this script BEFORE the closing </body> tag in your HTML
 * <script type="module" src="/js/webgl/hero-3d-init.js"></script>
 */

// Import map for Three.js CDN (no npm install required)
const importMap = {
  imports: {
    'three': 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
  }
};

// Create and inject import map
if (!document.querySelector('script[type="importmap"]')) {
  const script = document.createElement('script');
  script.type = 'importmap';
  script.textContent = JSON.stringify(importMap);
  document.head.appendChild(script);
}

// Import Three.js and scene factory
import * as THREE from 'three';
import { createElectricalScene } from './scene-factory.js';

// Make THREE globally available for the WebGLScene class
window.THREE = THREE;

// Initialize 3D scene when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Wait for THREE to be available
  const initScene = () => {
    const container = document.getElementById('hero-3d-container');
    
    if (!container) {
      console.warn('⚠ 3D container #hero-3d-container not found');
      return;
    }

    if (!window.THREE) {
      console.warn('⚠ Three.js not loaded yet, retrying...');
      setTimeout(initScene, 100);
      return;
    }

    try {
      // Create WebGL scene with electrical theme
      const scene = new WebGLScene(container, {
        objectFactory: createElectricalScene,
        pixelRatio: Math.min(window.devicePixelRatio, 2)
      });

      // Store reference for debugging (optional)
      window.hero3DScene = scene;

      console.log('✓ Hero 3D scene initialized');
    } catch (error) {
      console.error('✗ Failed to initialize 3D scene:', error);
    }
  };

  // Small delay to ensure all scripts are loaded
  setTimeout(initScene, 50);
});

// Export for potential reuse
export { };