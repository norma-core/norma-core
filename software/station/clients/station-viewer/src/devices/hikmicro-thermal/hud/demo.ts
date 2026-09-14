import type { hikmicro } from '@/api/proto.js';

/** Synthetic detector frames, deliberately without calibration or fabricated °C. */
export function createThermalDemo() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return (time: number): hikmicro.IRxEnvelope => {
    const polygon = (points: number[][], color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fill();
    };
    const ellipse = (x: number, y: number, rx: number, ry: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.fillStyle = '#171717';
    ctx.fillRect(0, 0, 256, 192);
    polygon([[0, 0], [112, 28], [112, 130], [0, 192]], '#272727');
    polygon([[256, 0], [192, 28], [192, 130], [256, 192]], '#363636');
    const floor = ctx.createLinearGradient(0, 120, 0, 192);
    floor.addColorStop(0, '#333333');
    floor.addColorStop(1, '#757575');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 132, 256, 60);
    polygon([[0, 132], [112, 113], [112, 130], [0, 191]], '#303030');
    polygon([[192, 118], [256, 139], [256, 191], [192, 130]], '#494949');
    ctx.strokeStyle = '#4c4c4c';
    ctx.lineWidth = 1;
    for (let x = -350; x < 600; x += 64) {
      ctx.beginPath(); ctx.moveTo(154, 114); ctx.lineTo(x, 192); ctx.stroke();
    }
    for (const y of [143, 159, 182]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
    // Receding wall panels, door and a warm radiator.
    polygon([[17, 13], [65, 23], [65, 122], [17, 145]], '#111111');
    polygon([[22, 19], [61, 27], [61, 118], [22, 135]], '#303030');
    ctx.fillStyle = '#686868'; ctx.fillRect(108, 27, 3, 104);
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(122, 32, 57, 95);
    ctx.fillStyle = '#464646'; ctx.fillRect(179, 30, 3, 100);
    polygon([[211, 39], [248, 23], [248, 110], [211, 115]], '#181818');
    for (let x = 215; x < 247; x += 5) {
      const heat = ctx.createLinearGradient(x, 122, x + 4, 122);
      // Synthetic heating/cooling gives the history a changing thermal source.
      const warmth = Math.round(175 + Math.sin(time / 3500) * 50);
      heat.addColorStop(0, '#6a6a6a'); heat.addColorStop(0.5, `rgb(${warmth}, ${warmth}, ${warmth})`); heat.addColorStop(1, '#5a5a5a');
      ctx.fillStyle = heat; ctx.fillRect(x, 122, 4, 26 + (x - 215) * 0.25);
    }
    // Human-shaped heat source. This is scene content, never a detection label.
    const drift = Math.sin(time / 3500) * 9;
    ctx.save(); ctx.translate(drift, Math.sin(time / 1100) * 0.6);
    ctx.filter = 'blur(0.65px)';
    ellipse(149, 176, 27, 5, '#454545');
    polygon([[136, 115], [149, 116], [146, 166], [137, 167]], '#929292');
    polygon([[150, 116], [163, 114], [165, 164], [155, 168]], '#a4a4a4');
    ellipse(140, 169, 9, 4, '#6d6d6d'); ellipse(162, 169, 9, 4, '#727272');
    const torso = ctx.createRadialGradient(149, 77, 2, 149, 83, 44);
    torso.addColorStop(0, '#dedede'); torso.addColorStop(0.5, '#adadad'); torso.addColorStop(1, '#747474');
    ctx.fillStyle = torso;
    ctx.beginPath(); ctx.moveTo(135, 62); ctx.bezierCurveTo(145, 58, 157, 58, 167, 64);
    ctx.lineTo(163, 118); ctx.quadraticCurveTo(150, 125, 134, 116); ctx.closePath(); ctx.fill();
    polygon([[135, 64], [128, 66], [122, 105], [130, 110], [140, 80]], '#a9a9a9');
    polygon([[166, 64], [174, 70], [179, 106], [170, 109], [161, 77]], '#b6b6b6');
    ellipse(126, 111, 4, 8, '#e9e9e9'); ellipse(175, 112, 4, 8, '#f5f5f5');
    ellipse(150, 57, 5, 8, '#d6d6d6');
    const head = ctx.createRadialGradient(151, 44, 1, 149, 46, 14);
    head.addColorStop(0, '#ffffff'); head.addColorStop(0.55, '#eeeeee'); head.addColorStop(1, '#a4a4a4');
    ctx.fillStyle = head; ctx.beginPath(); ctx.ellipse(150, 45, 10, 14, -0.08, 0, Math.PI * 2); ctx.fill();
    ellipse(147, 43, 2, 1, '#adadad'); ellipse(154, 43, 2, 1, '#adadad');
    ctx.restore();
    const pixels = ctx.getImageData(0, 0, 256, 192).data;
    const payload = new Uint8Array(256 * 192 * 2);
    const view = new DataView(payload.buffer);
    for (let i = 0; i < 256 * 192; i++) {
      const grain = ((i * 13 + Math.floor(time / 80) * 7) % 17) - 8;
      view.setUint16(i * 2, 4000 + Math.max(0, pixels[i * 4] + grain) * 80, true);
    }
    return { frames: { frames: [{ payload }] } };
  };
}
