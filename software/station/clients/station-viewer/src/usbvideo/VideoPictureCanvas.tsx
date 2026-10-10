import { type CSSProperties, type MouseEventHandler, useEffect, useRef } from 'react';

interface VideoPictureCanvasProps {
  picture: ImageBitmap;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLCanvasElement>;
}

/** Draws a decoded frame as is; the bitmap stays its owner's to close. */
export default function VideoPictureCanvas({ picture, className = '', style, onClick }: VideoPictureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    drawPicture(canvasRef.current, picture);
  }, [picture]);

  return <canvas ref={canvasRef} className={className} style={style} onClick={onClick} />;
}

export function drawPicture(canvas: HTMLCanvasElement | null, picture: ImageBitmap): void {
  if (!canvas) {
    return;
  }
  if (canvas.width !== picture.width || canvas.height !== picture.height) {
    canvas.width = picture.width;
    canvas.height = picture.height;
  }
  canvas.getContext('2d')?.drawImage(picture, 0, 0);
}
