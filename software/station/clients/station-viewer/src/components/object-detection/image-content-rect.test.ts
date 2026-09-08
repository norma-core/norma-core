import { expect, it } from 'vitest';
import { imageContentRect } from './image-content-rect';

it('keeps boxes aligned with a letterboxed image when rotating the viewport', () => {
  expect(imageContentRect(640, 480, 800, 480, 'contain')).toEqual({ left: 80, top: 0, width: 640, height: 480 });
  expect(imageContentRect(640, 480, 400, 800, 'contain')).toEqual({ left: 0, top: 250, width: 400, height: 300 });
});

it('accounts for cropped edges with object-cover', () => {
  expect(imageContentRect(640, 480, 800, 400, 'cover')).toEqual({ left: 0, top: -100, width: 800, height: 600 });
});
