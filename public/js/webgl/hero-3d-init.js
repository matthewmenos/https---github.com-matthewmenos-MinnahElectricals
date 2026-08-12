/**
 * Hero 3D Scene Initialization (classic script)
 *
 * Load this script BEFORE the closing </body> tag in your HTML, AFTER:
 *   <script src=".../three.min.js"></script>
 *   <script src="/js/webgl/three-loader.js"></script>
 *   <script src="/js/webgl/scene-factory.js"></script>
 */

// Loaded as a classic script. Load the following BEFORE this file:
//   three.min.js      -> window.THREE
//   three-loader.js   -> window.WebGLScene
//   scene-factory.js  -> window.createElectricalScene

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
      const scene = new window.WebGLScene(container, {
        objectFactory: window.createElectricalScene,
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