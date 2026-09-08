/** Match the camera's centered object-fit, including letterboxing and cropping. */
export function imageContentRect(imageWidth: number, imageHeight: number, width: number, height: number, fit: 'contain' | 'cover') {
  const scale = (fit === 'cover' ? Math.max : Math.min)(width / imageWidth, height / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  return { left: (width - renderedWidth) / 2, top: (height - renderedHeight) / 2, width: renderedWidth, height: renderedHeight };
}
