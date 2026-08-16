import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ArduinoNiclaSenseMeQuat } from '../values';

/**
 * three.js orientation view for the Nicla Sense ME. The rotation pipeline is
 * verbatim from Arduino's official dashboard (ArduinoAI repo): the raw
 * rotation-vector quaternion applied via setRotationFromQuaternion in
 * (x, y, z, w) order, same lights. Two things are ours:
 *  - a constant world-frame bridge (BHY2 world is z-up ENU, three.js is
 *    y-up) so a flat spin turns about the screen-vertical axis, and an
 *    elevated 3/4 camera so a board lying flat reads as horizontal;
 *  - a hand-built board mesh laid out from the ABX00050 datasheet and the
 *    official pinout art (top view with the USB edge nearest the viewer:
 *    ANNA-B112 upper left, RGB LED + reset in the top-left corner, charger
 *    and flash on the right, silkscreen-style XYZ axes; underside: micro
 *    USB, ESLOV and battery connectors, SAMD11 bridge).
 *
 * Mesh construction frame (calibrated on hardware): board plane XZ, +Y is
 * the component side, +Z points at the USB edge — mapped to the BHY2 body
 * frame by the rotation at the end of buildBoardMesh (component side and
 * USB edge both hardware-calibrated with the physical board).
 */

const CANVAS_SIZE_PX = 120;

// Axis colors match the sparkline legend (X blue, Y amber, Z green).
const AXIS_COLOR_X = 0x2a78d6;
const AXIS_COLOR_Y = 0xeda100;
const AXIS_COLOR_Z = 0x1baf7a;

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color });
}

function textSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 32, 34);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
  );
  sprite.scale.set(2.2, 2.2, 1);
  return sprite;
}

function buildBoardMesh(): THREE.Group {
  const mesh = new THREE.Group();
  const box = (
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    part.position.set(x, y, z);
    mesh.add(part);
    return part;
  };

  // PCB: 22.86 mm square, black solder mask -> 18x18 units, 1.2 thick.
  box(18, 1.2, 18, 0x16181d, 0, 0, 0);

  // Castellated gold pads: J1 (left) / J2 (right) columns, plus J3 top-right.
  for (let i = 0; i < 9; i++) {
    const z = -6.4 + i * 1.6;
    box(1.0, 1.3, 0.8, 0xc9a227, -8.6, 0, z);
    box(1.0, 1.3, 0.8, 0xc9a227, 8.6, 0, z);
  }
  box(0.8, 1.3, 1.0, 0xc9a227, 2.4, 0, -8.6);
  box(0.8, 1.3, 1.0, 0xc9a227, 4.0, 0, -8.6);

  // --- Top side (component side, +Y), laid out to the board-front photo
  // (top view, USB edge at the bottom; image-left = construction -x). ---
  // ANNA-B112 module, upper center-left: metal shield + antenna strip.
  box(4.8, 1.2, 5.4, 0xcfd4da, -2.6, 1.15, -4.8);
  box(1.4, 1.25, 5.4, 0x30343b, 0.6, 1.16, -4.8);
  // Reset button (top-left) on a silver base + RGB LED at the very corner.
  box(2.0, 0.5, 2.0, 0x9aa2ab, -6.5, 0.8, -6.3);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.9, 16), material(0x1c1f24));
  button.position.set(-6.5, 1.3, -6.3);
  mesh.add(button);
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.6, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xd9f2ff, emissive: 0x3ca6d0 }),
  );
  led.position.set(-8.0, 0.9, -8.0);
  mesh.add(led);
  // Dark ICs: upper right, mid right (BHI260AP) and bottom right pair.
  box(2.4, 0.8, 2.4, 0x22262c, 4.6, 0.95, -5.0);
  box(3.0, 0.85, 3.0, 0x22262c, 3.6, 0.98, 1.0);
  box(2.4, 0.8, 2.4, 0x22262c, 4.4, 0.95, 4.6);
  box(2.0, 0.8, 2.0, 0x2a2e35, 5.4, 0.95, 6.9);
  // BMP390 (small metallic, lower center-left).
  box(1.8, 0.8, 1.8, 0xb8bec6, -2.4, 0.95, 3.0);
  // BME688 (larger metallic, bottom-left corner, with its vent).
  box(3.0, 1.0, 3.0, 0x9aa2ab, -6.0, 1.05, 5.8);
  box(0.7, 0.2, 0.7, 0x1c1f24, -6.0, 1.62, 5.8);
  // Y1 oscillator + a few passives for texture.
  box(0.9, 0.7, 1.6, 0x30343b, -4.2, 0.9, -0.8);
  box(0.7, 0.4, 0.35, 0x4a4f57, -3.6, 0.75, 1.6);
  box(0.35, 0.4, 0.7, 0x4a4f57, 1.6, 0.75, 5.4);
  box(0.7, 0.4, 0.35, 0x4a4f57, 2.4, 0.75, -1.6);

  // Silkscreen-style sensor axes (as printed on the real board): X to the
  // right, Y away from the USB edge, Z out of the component side.
  const axesOrigin = new THREE.Vector3(-0.8, 0.85, 0.6);
  const arrow = (dir: THREE.Vector3, length: number, color: number, label: string) => {
    mesh.add(new THREE.ArrowHelper(dir, axesOrigin, length, color, 1.1, 0.6));
    const tip = axesOrigin.clone().addScaledVector(dir, length + 1.1);
    const sprite = textSprite(label, `#${color.toString(16).padStart(6, '0')}`);
    sprite.position.copy(tip);
    mesh.add(sprite);
  };
  arrow(new THREE.Vector3(1, 0, 0), 3.4, AXIS_COLOR_X, 'X');
  arrow(new THREE.Vector3(0, 0, -1), 3.4, AXIS_COLOR_Y, 'Y');
  arrow(new THREE.Vector3(0, 1, 0), 2.4, AXIS_COLOR_Z, 'Z');

  // --- Underside (-Y), laid out to the board-back photo. When the physical
  // board is flipped over (about the USB edge axis), image-left maps to
  // construction +x. Bottom edge: ESLOV left, micro-USB right; battery JST
  // at the top edge next to the two J3 gold pads.
  // Micro-USB on the USB edge (+Z), right of center in the flipped view:
  // wide flat metal shell protruding past the edge, dark opening slot at
  // the front, two anchor tabs on the shell.
  box(6.0, 1.9, 4.6, 0xc4cad2, -1.5, -1.55, 7.6);
  box(4.6, 1.1, 0.5, 0x2a2e33, -1.5, -1.55, 9.75);
  box(1.1, 0.3, 1.8, 0x9aa2ab, -3.2, -2.55, 7.3);
  box(1.1, 0.3, 1.8, 0x9aa2ab, 0.2, -2.55, 7.3);
  // ESLOV connector (SM05B, white latched housing), bottom-left in the
  // flipped view: opening faces outward, five gold pins in a row behind.
  box(4.6, 1.6, 2.6, 0xf2f0e8, 5.6, -1.4, 7.2);
  box(3.6, 0.9, 0.4, 0x4a4238, 5.6, -1.4, 8.45);
  for (let i = 0; i < 5; i++) {
    box(0.35, 0.35, 0.8, 0xc9a227, 4.3 + i * 0.65, -0.8, 5.4);
  }
  // Battery JST connector (white), top edge, adjacent to the J3 pads.
  box(3.4, 2.0, 4.2, 0xe8e6df, 5.0, -1.6, -6.2);
  // U1 SAMD11 USB bridge (dark QFN, right of center in the flipped view).
  box(2.8, 0.9, 2.8, 0x22262c, -2.6, -1.05, -0.8);
  // LDO / small SOT chip, mid-left in the flipped view.
  box(1.4, 0.8, 1.4, 0x30343b, 2.0, -1.0, -0.5);

  // Single Rx(+90) alignment (hardware-calibrated through iterative checks
  // with the physical board): keeps the component-side/underside assignment
  // and puts the USB connector on the correct edge.
  mesh.rotation.set(Math.PI / 2, 0, 0);
  return mesh;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  board: THREE.Group;
}

export interface NiclaBoardSceneProps {
  quat: ArduinoNiclaSenseMeQuat | null;
}

function NiclaBoardScene({ quat }: NiclaBoardSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<SceneState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(CANVAS_SIZE_PX, CANVAS_SIZE_PX);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // BHY2's world frame is z-up (ENU); three.js is y-up. This constant
    // parent rotation bridges the two so a physical flat spin turns about
    // the screen-vertical axis (turntable), not a horizontal one.
    const world = new THREE.Group();
    world.rotation.x = -Math.PI / 2;
    scene.add(world);

    const board = new THREE.Group();
    board.add(buildBoardMesh());
    world.add(board);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(-20, 100, -10);
    light.target.position.set(0, 0, 0);
    scene.add(light);
    scene.add(light.target);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 1));

    // Elevated 3/4 view: a board lying flat on the table renders as a
    // horizontal slab in perspective.
    // Frustum sized so the board's full bounding sphere (incl. the USB
    // overhang, ~14 units) fits at every orientation without clipping.
    const camera = new THREE.PerspectiveCamera(55, 1, 1, 10000);
    camera.position.set(0, 20, 17);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    renderer.render(scene, camera);
    stateRef.current = { renderer, scene, camera, board };

    return () => {
      stateRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) {
      return;
    }
    if (quat) {
      // Verbatim Arduino dashboard: raw quaternion, (x, y, z, w) order.
      const rotation = new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w).normalize();
      state.board.setRotationFromQuaternion(rotation);
    }
    state.renderer.render(state.scene, state.camera);
  }, [quat]);

  return <div ref={containerRef} style={{ width: CANVAS_SIZE_PX, height: CANVAS_SIZE_PX }} className="mx-auto" />;
}

export default NiclaBoardScene;
