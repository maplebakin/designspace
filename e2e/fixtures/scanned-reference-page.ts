import { createCanvas } from 'canvas';
import { PDFDocument } from 'pdf-lib';

const WIDTH = 1600;
const HEIGHT = 2200;

const createScannedPageCanvas = () => {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  context.fillStyle = '#e8e8e8';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = '#303030';
  for (let y = 150; y < 500; y += 27) {
    const indent = (y / 27) % 3 * 22;
    for (let x = 120 + indent; x < WIDTH - 120; x += 19) {
      context.fillRect(x, y, 13, 8);
    }
  }

  const leftPhoto = { left: 120, top: 650, width: 620, height: 470 };
  const rightPhoto = { left: 940, top: 930, width: 540, height: 520 };
  for (const photo of [leftPhoto, rightPhoto]) {
    const pixels = context.createImageData(photo.width, photo.height);
    for (let y = 0; y < photo.height; y += 1) {
      for (let x = 0; x < photo.width; x += 1) {
        const offset = (y * photo.width + x) * 4;
        const noise = (x * 17 + y * 31 + x * y) % 43;
        const shade = 42 + noise;
        pixels.data[offset] = shade;
        pixels.data[offset + 1] = shade;
        pixels.data[offset + 2] = shade;
        pixels.data[offset + 3] = 255;
      }
    }
    context.putImageData(pixels, photo.left, photo.top);
  }

  context.fillStyle = '#767676';
  for (let y = 700; y < 1080; y += 23) {
    context.fillRect(160, y, 520 - ((y / 23) % 5) * 24, 7);
  }
  for (let y = 990; y < 1400; y += 25) {
    context.fillRect(980, y, 430 - ((y / 25) % 6) * 23, 8);
  }

  context.fillStyle = '#4d4d4d';
  context.fillRect(120, 1650, 1360, 5);
  for (let y = 1710; y < 2020; y += 29) {
    for (let x = 120; x < 1020; x += 23) {
      context.fillRect(x, y, 15, 9);
    }
  }
  return canvas;
};

export const createScannedReferenceFixture = async () => {
  const canvas = createScannedPageCanvas();
  const png = canvas.toBuffer('image/png');
  const jpeg = canvas.toBuffer('image/jpeg', { quality: 0.82 });
  const pdfDocument = await PDFDocument.create();
  const page = pdfDocument.addPage([600, 825]);
  const image = await pdfDocument.embedJpg(jpeg);
  page.drawImage(image, { x: 0, y: 0, width: 600, height: 825 });
  const pdf = await pdfDocument.save({ useObjectStreams: true });
  return {
    png: Buffer.from(png),
    pdf: Buffer.from(pdf),
    width: WIDTH,
    height: HEIGHT,
  };
};
