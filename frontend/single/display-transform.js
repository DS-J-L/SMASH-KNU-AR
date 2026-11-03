// Raw, unmirrored image coordinates -> CSS pixels. Used by video, wrists and targets.
export class DisplayTransform {
  constructor({ imageWidth, imageHeight, width, height, rotation = 0, mirror = false }) {
    if (![imageWidth, imageHeight, width, height].every(v => Number.isFinite(v) && v > 0) ||
        ![0, 90, 180, 270].includes(rotation)) throw new Error('invalid_transform');
    Object.assign(this, { imageWidth, imageHeight, width, height, rotation, mirror });
    const swapped = rotation % 180 !== 0;
    this.rotatedWidth = swapped ? imageHeight : imageWidth;
    this.rotatedHeight = swapped ? imageWidth : imageHeight;
    this.scale = Math.min(width / this.rotatedWidth, height / this.rotatedHeight);
    this.left = (width - this.rotatedWidth * this.scale) / 2;
    this.top = (height - this.rotatedHeight * this.scale) / 2;
    const a = this.toScreen([0, 0]), b = this.toScreen([1, 0]), c = this.toScreen([0, 1]);
    this.matrix = [(b[0]-a[0])/imageWidth, (b[1]-a[1])/imageWidth,
      (c[0]-a[0])/imageHeight, (c[1]-a[1])/imageHeight, a[0], a[1]];
  }
  toScreen([u, v]) {
    let x = u * this.imageWidth, y = v * this.imageHeight;
    if (this.rotation === 90) [x, y] = [this.imageHeight-y, x];
    if (this.rotation === 180) [x, y] = [this.imageWidth-x, this.imageHeight-y];
    if (this.rotation === 270) [x, y] = [y, this.imageWidth-x];
    if (this.mirror) x = this.rotatedWidth-x;
    return [this.left+x*this.scale, this.top+y*this.scale];
  }
  toImage([sx, sy]) {
    let x = (sx-this.left)/this.scale, y = (sy-this.top)/this.scale;
    if (this.mirror) x = this.rotatedWidth-x;
    if (this.rotation === 90) [x, y] = [y, this.imageHeight-x];
    else if (this.rotation === 180) [x, y] = [this.imageWidth-x, this.imageHeight-y];
    else if (this.rotation === 270) [x, y] = [this.imageWidth-y, x];
    return [x/this.imageWidth, y/this.imageHeight];
  }
  contains(point) { return this.toImage(point).every(v => v >= 0 && v <= 1); }
  draw(context, image) {
    context.save(); context.setTransform(...this.matrix);
    context.drawImage(image, 0, 0, this.imageWidth, this.imageHeight); context.restore();
  }
}
