import type { RoverMotion } from '../rover-motion';
type Vector = [number, number, number];

// Original TRX-6 schematic. Sensor/body convention: X forward, Y left, Z up.
// All interpolation is local geometry/numeric telemetry, never envelope strings.
export function renderRoverModel(motion: RoverMotion, index: string): string {
  const pitch = motion.pitch * Math.PI / 180, roll = motion.roll * Math.PI / 180;
    const rotate = ([x,y,z]: Vector): Vector => {
      const ry = y*Math.cos(roll)-z*Math.sin(roll), rz=y*Math.sin(roll)+z*Math.cos(roll);
      return [x*Math.cos(pitch)-rz*Math.sin(pitch), ry, x*Math.sin(pitch)+rz*Math.cos(pitch)];
    };
    // Rear-right elevated view: forward (+X) recedes upward; rover left
    // (+Y) maps to screen left. Apply the same projection to every vector.
    const project = ([x,y,z]: Vector): number[] => [115+x*.65-y*1.22, 76-x*.40-y*.22-z*.84];
    const point = (v: Vector) => project(rotate(v)).join(',');
    const polygon = (vertices: Vector[],fill: string) => `<polygon points="${vertices.map(point).join(' ')}" fill="${fill}"/>`;
    function box(x0: number,x1: number,y0: number,y1: number,z0: number,z1: number,top: string,side: string) {
      return polygon([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],side)
        +polygon([[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]],side)
        +polygon([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],top);
    }
    const tireFace = (x: number,y: number,r: number): Vector[] => Array.from({length:24},(_,i)=>{const t=i*Math.PI/12;return [x+r*Math.cos(t),y,r*Math.sin(t)];});
    function wheel(x: number,y: number) {
      const inner=tireFace(x,y+7,13),outer=tireFace(x,y-7,13);
      const tread=outer.map((v,i)=>polygon([inner[i],inner[(i+1)%24],outer[(i+1)%24],v],i<12?'#303a45':'#121820')).join('');
      const ridges=outer.filter((_,i)=>i%3===0).map((v,i)=>`<polyline points="${point(inner[i*3])} ${point(v)}" stroke="#647080" stroke-width="1.2" opacity=".5"/>`).join('');
      return `<g data-wheel="true" data-side="${y > 0 ? 'left' : 'right'}">${tread}${polygon(tireFace(x,y-7.1,11),'#111923')}${polygon(tireFace(x,y-7.3,7),'#8495a6')}${polygon(tireFace(x,y-7.5,5.7),'#293848')}${polygon(tireFace(x,y-7.7,2.5),'#a7b6c3')}${ridges}</g>`;
    }
    const farWheels=[32,-6,-34].map(x=>wheel(x,27)).join('');
    const nearWheels=[32,-6,-34].map(x=>wheel(x,-27)).join('');
    const chassis = box(-43,43,-20,20,3,19,'#3c4958','#202c3b')
      +box(-41,42,-22,-20,7,12,'#5e6c7b','#344354')
      +box(-46,-43,-23,23,7,11,'#9badba','#4b5d6b')
      +[-17,17].map(y=>polygon([[-43.1,y-3,14],[-43.1,y+3,14],[-43.1,y+3,17],[-43.1,y-3,17]],'#e78b7b')).join('');
    const deck = box(-49,48,-25,25,21,24,'#bdcbd4','#778a9a')
      +polygon([[-46,-22,24.3],[45,-22,24.3],[45,22,24.3],[-46,22,24.3]],'url(#solar-surface)');
    const panelGrid = [-28,-10,8,26].map(x=>`<polyline points="${point([x,-21,24.5])} ${point([x,21,24.5])}" fill="none" stroke="#507789" stroke-width=".45" opacity=".65"/>`).join('')
      + [-7,7].map(y=>`<polyline points="${point([-45,y,24.5])} ${point([44,y,24.5])}" fill="none" stroke="#507789" stroke-width=".45" opacity=".65"/>`).join('');
    const frame = [-22,22].map(y=>box(37,40,y-1.2,y+1.2,24,52,'#e2e8ee','#8a9dac')).join('')
      +box(37,40,-23,23,49,52,'#e2e8ee','#91a4b4');
    // We see the rear of the front-mounted camera housing, not its lenses.
    const camera = box(36,43,-14,14,44,61,'#f1f4f7','#b8c5d0')
      +polygon([[35.9,-8,48],[35.9,8,48],[35.9,8,55],[35.9,-8,55]],'#64748b');
    const forwardCue = `<polyline data-forward-cue="true" points="${point([17,0,24.8])} ${point([27,0,24.8])}" fill="none" stroke="#d5e7ef" stroke-width="1.2"/>`
      +polygon([[30,0,24.8],[23,-3,24.8],[23,3,24.8]],'#d5e7ef');
    const mast = frame+camera;
    const linearAccel: Vector = [motion.accel.x, motion.accel.y, motion.accel.z];
    const vectorAnchor = rotate([0,0,25]);
    const vectorOrigin = project(vectorAnchor);

      // log1p starts at zero, so tiny noise no longer becomes a full arrow.
      // Full length represents 1 g or 90 degrees/s; larger values are capped.
      const vectors = [
        {id:'a',color:'#22d3ee',v:rotate(linearAccel),fullScale:1,maxLength:48},
        {id:'w',color:'#c084fc',v:rotate([motion.gyro.x,motion.gyro.y,motion.gyro.z]),fullScale:90,maxLength:42},
      ].map(vector => {
        const magnitude = Math.hypot(...vector.v);
        const length = vector.maxLength * Math.min(1, Math.log1p(9 * magnitude / vector.fullScale) / Math.LN10);
        return {...vector, length, v:vector.v.map(c => magnitude > 0 ? c / magnitude : 0) as Vector};
      }).filter(vector => vector.length >= 2); // Omit sub-readable arrows and their heads.
      return `<defs><linearGradient id="solar-surface-${index}" x2=".7" y2="1"><stop stop-color="#274659"/><stop offset="1" stop-color="#0c1d2b"/></linearGradient>${vectors.map(v=>`<marker id="motion-${index}-${v.id}" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="${v.color}"/></marker>`).join('')}</defs>`
        + `<ellipse cx="115" cy="94" rx="67" ry="17" fill="#000" opacity=".18"/><g stroke="none">${farWheels}${chassis}${nearWheels}${deck.replace('url(#solar-surface)',`url(#solar-surface-${index})`)}${panelGrid}${forwardCue}${mast}</g>`
        + vectors.map(v=>{const origin=vectorOrigin,end=project(v.v.map((n,i)=>n*v.length+vectorAnchor[i]) as Vector);return `<line x1="${origin[0]}" y1="${origin[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${v.color}" stroke-width="1.8" marker-end="url(#motion-${index}-${v.id})"/>`;}).join('')
        + `<circle cx="${vectorOrigin[0]}" cy="${vectorOrigin[1]}" r="3.5" fill="#0b1924" stroke="#dbeaf2" stroke-width="1"/><circle cx="${vectorOrigin[0]}" cy="${vectorOrigin[1]}" r="1" fill="#fff"/>`;

}
