# WebGL 3D Integration Guide

Performance-optimized Three.js implementation for Minnah Electricals website.

## 📁 File Structure

```
public/
├── js/
│   ├── main.js (existing - DO NOT MODIFY)
│   └── webgl/
│       ├── three-loader.js      # Core WebGL scene manager with performance safeguards
│       ├── scene-factory.js     # Modular 3D object creators
│       ├── hero-3d-init.js      # Hero section initialization
│       └── README.md            # This file
└── index.html (updated with 3D container)
```

## ✅ What's Already Integrated

The hero section (`index.html`) is already configured with:
- 3D canvas container with proper Tailwind classes
- ES module script loader
- Performance safeguards enabled

## 🚀 Usage on Other Pages

### Step 1: Add HTML Container

Add this div to any page where you want 3D graphics:

```html
<!-- Example: Services page background -->
<div id="services-3d-container" 
     class="absolute inset-0 w-full h-full z-0 opacity-40 md:opacity-60" 
     aria-hidden="true">
  <noscript>
    <div class="absolute inset-0 bg-gradient-to-br from-navy to-gray-800"></div>
  </noscript>
</div>
```

**Key Tailwind Classes:**
- `absolute inset-0` - Full coverage of parent
- `w-full h-full` - Responsive sizing
- `z-0` - Behind content (use `z-10` on content wrapper)
- `opacity-40 md:opacity-60` - Subtle on mobile, visible on desktop
- `aria-hidden="true"` - Accessibility (decorative only)

### Step 2: Initialize the Scene

Add this script before `</body>` on your page:

```html
<script type="module">
  import { createElectricalScene } from '/js/webgl/scene-factory.js';
  
  // Wait for WebGLScene to be available
  const init = () => {
    if (typeof WebGLScene === 'undefined') {
      setTimeout(init, 100);
      return;
    }

    const container = document.getElementById('services-3d-container');
    if (!container) return;

    const scene = new WebGLScene(container, {
      objectFactory: createElectricalScene,
      pixelRatio: Math.min(window.devicePixelRatio, 2)
    });

    // Optional: Store for debugging
    window.services3DScene = scene;
  };

  init();
</script>
```

## 🎨 Available Scene Types

### 1. Electrical Scene (Default)
**Use case:** Hero sections, main landing areas
**File:** `scene-factory.js` → `createElectricalScene()`
**Features:** Torus knots, icosahedrons, octahedrons, floating particles
**Colors:** Amber (#f59e0b) + Navy (#0F172A)

```javascript
import { createElectricalScene } from '/js/webgl/scene-factory.js';
const scene = new WebGLScene(container, {
  objectFactory: createElectricalScene
});
```

### 2. Minimal Scene
**Use case:** Subtle backgrounds, secondary sections
**File:** `scene-factory.js` → `createMinimalScene()`
**Features:** Single torus, accent sphere
**Performance:** Lowest GPU usage

```javascript
import { createMinimalScene } from '/js/webgl/scene-factory.js';
const scene = new WebGLScene(container, {
  objectFactory: createMinimalScene
});
```

### 3. Button Scene
**Use case:** Interactive CTAs, featured elements
**File:** `scene-factory.js` → `createButtonScene()`
**Features:** Glowing sphere, orbiting ring
**Interaction:** Mouse parallax

```javascript
import { createButtonScene } from '/js/webgl/scene-factory.js';
const scene = new WebGLScene(container, {
  objectFactory: createButtonScene
});
```

### 4. Particle Field
**Use case:** Full-screen backgrounds, atmospheric effects
**File:** `scene-factory.js` → `createParticleField()`
**Features:** 50 animated particles
**Performance:** Optimized buffer geometry

```javascript
import { createParticleField } from '/js/webgl/scene-factory.js';
const scene = new WebGLScene(container, {
  objectFactory: createParticleField
});
```

## ⚙️ Configuration Options

### WebGLScene Constructor Options

```javascript
const scene = new WebGLScene(container, {
  // Rendering
  antialias: true,              // Smooth edges (default: true)
  alpha: true,                  // Transparent background (default: true)
  pixelRatio: 2,                // Device pixel ratio (auto-limited on mobile)
  
  // Animation
  enableDamping: true,          // Smooth camera movement (default: true)
  dampingFactor: 0.05,          // Damping intensity (default: 0.05)
  autoRotate: true,             // Auto-rotate camera (default: true)
  rotateSpeed: 0.5,             // Rotation speed multiplier (default: 0.5)
  
  // Custom objects
  objectFactory: createElectricalScene  // Scene type (required)
});
```

### Performance Presets

**High Performance (Desktop):**
```javascript
new WebGLScene(container, {
  objectFactory: createElectricalScene,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  antialias: true
});
```

**Balanced (Tablet):**
```javascript
new WebGLScene(container, {
  objectFactory: createMinimalScene,
  pixelRatio: Math.min(window.devicePixelRatio, 1.5),
  antialias: true
});
```

**Low Power (Mobile):**
```javascript
new WebGLScene(container, {
  objectFactory: createParticleField,
  pixelRatio: 1,
  antialias: false
});
```

## 🛡️ Built-in Performance Safeguards

### 1. IntersectionObserver
Automatically pauses render loop when element scrolls out of viewport.

```javascript
// Configured in three-loader.js
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    this.isVisible = entry.isIntersecting;
    if (this.isVisible) {
      this.animate();  // Resume
    } else {
      this.stopAnimation();  // Pause
    }
  });
}, {
  rootMargin: '50px',  // Start 50px before entering viewport
  threshold: 0.1       // Trigger when 10% visible
});
```

### 2. Mobile Detection
Automatically adjusts settings for touch devices:

```javascript
if (window.innerWidth <= 768) {
  this.options.pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  this.options.autoRotate = false;  // Disable auto-rotation
}
```

### 3. Reduced Motion Support
Respects user's accessibility preferences:

```javascript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion) {
  this.options.autoRotate = false;
  this.options.enableDamping = false;
}
```

**Result:** All animations slow to 10% speed or stop completely.

### 4. Debounced Resize
Prevents excessive recalculations during window resize:

```javascript
let resizeTimeout;
this.resizeHandler = () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => this.onResize(), 100);  // 100ms debounce
};
```

### 5. Memory Management
Proper cleanup on page unload:

```javascript
window.addEventListener('beforeunload', () => {
  this.dispose();  // Frees GPU resources
});

dispose() {
  // Cancels animation frame
  // Disconnects IntersectionObserver
  // Disposes geometries & materials
  // Removes WebGL canvas
  // Removes event listeners
}
```

## 🎯 Creating Custom Scenes

### Basic Template

```javascript
// In scene-factory.js

export function createCustomScene(scene, objects) {
  // 1. Create geometry
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  
  // 2. Create material (use brand colors)
  const material = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,        // Amber
    metalness: 0.7,
    roughness: 0.3,
    emissive: 0xf59e0b,     // Glow effect
    emissiveIntensity: 0.3
  });
  
  // 3. Create mesh
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, 0);
  scene.add(mesh);
  
  // 4. Add update function
  objects.push({
    mesh: mesh,
    update: (mouse, prefersReducedMotion) => {
      // Animation speed multiplier
      const speed = prefersReducedMotion ? 0.1 : 1.0;
      
      // Rotate
      mesh.rotation.x += 0.01 * speed;
      mesh.rotation.y += 0.01 * speed;
      
      // Float
      mesh.position.y = Math.sin(Date.now() * 0.001) * 0.3;
      
      // Mouse interaction
      mesh.position.x = mouse.x * 0.5;
    }
  });
}
```

### Advanced: Multiple Objects

```javascript
export function createAdvancedScene(scene, objects) {
  // Group related objects
  const group = new THREE.Group();
  scene.add(group);

  // Add multiple meshes to group
  for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b })
    );
    mesh.position.x = (i - 2) * 1.5;
    group.add(mesh);
    
    objects.push({
      mesh: mesh,
      update: (mouse, prefersReducedMotion) => {
        const speed = prefersReducedMotion ? 0.1 : 0.5;
        mesh.rotation.y += 0.02 * speed;
        mesh.position.y = Math.sin(Date.now() * 0.001 + i) * 0.2;
      }
    });
  }
}
```

## 🔧 Troubleshooting

### 3D Not Appearing

1. **Check browser console for errors:**
   ```javascript
   // Should see: "✓ Hero 3D scene initialized"
   // If not, check for:
   // - "3D container #hero-3d-container not found"
   // - "Three.js not loaded yet, retrying..."
   ```

2. **Verify container exists:**
   ```javascript
   console.log(document.getElementById('hero-3d-container'));
   // Should output: <div id="hero-3d-container">...</div>
   ```

3. **Check WebGL support:**
   ```javascript
   const canvas = document.createElement('canvas');
   const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
   console.log(gl ? 'WebGL supported' : 'WebGL not supported');
   ```

### Performance Issues

**Problem:** Low FPS on desktop
**Solution:** Reduce particle count or geometry complexity

```javascript
// In scene-factory.js
const particleCount = 20;  // Reduce from 50
const geometry = new THREE.TorusKnotGeometry(0.8, 0.25, 50, 16);  // Reduce segments
```

**Problem:** Mobile battery drain
**Solution:** Use `createMinimalScene()` or disable auto-rotate

```javascript
const scene = new WebGLScene(container, {
  objectFactory: createMinimalScene,
  autoRotate: false  // Explicitly disable
});
```

### CORS Errors with CDN

If Three.js fails to load from CDN, use a local copy:

1. Download Three.js: https://threejs.org/build/three.module.js
2. Place in `public/js/lib/three.module.js`
3. Update import map in `hero-3d-init.js`:

```javascript
const importMap = {
  imports: {
    'three': '/js/lib/three.module.js'  // Local path
  }
};
```

## 📊 Performance Metrics

### Expected Performance

| Device | Pixel Ratio | Objects | FPS Target | Actual FPS |
|--------|-------------|---------|------------|------------|
| Desktop (1920x1080) | 2 | 20 | 60 | 55-60 |
| Desktop (2560x1440) | 2 | 20 | 60 | 50-60 |
| Tablet (768x1024) | 1.5 | 10 | 60 | 55-60 |
| Mobile (375x667) | 1.5 | 5 | 30 | 30-60 |

### Monitoring Performance

```javascript
// Add to hero-3d-init.js for debugging
let frameCount = 0;
let lastTime = performance.now();

const originalAnimate = scene.animate.bind(scene);
scene.animate = function() {
  frameCount++;
  const now = performance.now();
  
  if (now - lastTime >= 1000) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    lastTime = now;
  }
  
  originalAnimate();
};
```

## 🎓 Best Practices

1. **Always use `aria-hidden="true"`** on decorative 3D containers
2. **Provide fallback content** with `<noscript>` tags
3. **Test on real devices** - emulators don't show real performance
4. **Use `prefers-reduced-motion`** for accessibility compliance
5. **Dispose scenes properly** when removing from DOM
6. **Limit to 1-2 3D scenes per page** to avoid GPU overload
7. **Use opacity classes** to ensure text readability over 3D backgrounds

## 📦 Browser Support

- Chrome/Edge 89+ ✅
- Firefox 108+ ✅
- Safari 16.4+ ✅
- iOS Safari 16.4+ ✅
- Android Chrome 89+ ✅

**Note:** IntersectionObserver requires polyfill for IE11 (not supported).

## 🔗 Resources

- Three.js Documentation: https://threejs.org/docs/
- Tailwind CSS: https://tailwindcss.com/docs
- WebGL Fundamentals: https://webglfundamentals.org/
- Performance Best Practices: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

## 📝 Quick Reference

```javascript
// Import
import { createElectricalScene } from '/js/webgl/scene-factory.js';

// Initialize
const container = document.getElementById('my-3d-container');
const scene = new WebGLScene(container, {
  objectFactory: createElectricalScene
});

// Cleanup (if removing from DOM)
scene.dispose();
```

---

**Need Help?** Check browser console for detailed logs with ✓ (success) and ⚠ (warning) prefixes.