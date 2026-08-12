/**
 * Shared WebGL bootstrapper.
 *
 * Load this module on any page that needs a 3D scene. It imports Three.js
 * and the WebGLScene loader, then exposes both as globals so the small inline
 * page scripts (which poll for `WebGLScene`) can construct scenes directly.
 *
 * Prerequisite: the document must contain an <script type="importmap">
 * mapping the specifier "three" to the Three.js ES module build — see the
 * <head> of each page.
 *
 * Usage:
 *   <script type="module" src="/js/webgl/webgl-boot.js"></script>
 */
import * as THREE from 'three';
import WebGLScene from './three-loader.js';

window.THREE = THREE;
window.WebGLScene = WebGLScene;

console.log('✓ WebGL boot: THREE and WebGLScene are ready');