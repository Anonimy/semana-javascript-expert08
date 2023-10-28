import WebMWriter from '../deps/webm-writer2.js';
import CanvasRenderer from './canvasRenderer.js';
import MP4Demuxer from './mp4Demuxer.js';
import VideoProcessor from './videoProcessor.js';
import Service from './service.js';

const qvgaConstraints = {
  width: 320,
  height: 240,
};
const vgaConstraints = {
  width: 640,
  height: 480,
};
const hdConstraints = {
  width: 1280,
  height: 720,
};
const fullHdConstraints = {
  width: 1920,
  height: 1080,
};

const encoderConfig = {
  ...qvgaConstraints,
  bitrate: 10e6,

  // WebM
  codec: 'vp09.00.10.08',
  pt: 4,
  hardwareAcceleration: 'prefer-software',

  // MP4
  // codec: 'avc1.42002A',
  // pt: 1,
  // hardwareAcceleration: 'prefer-hardware',
  // avc: { format: 'annexb' },
};

const mp4Demuxer = new MP4Demuxer();
const webMWriter = new WebMWriter({
  codec: 'VP9',
  width: encoderConfig.width,
  height: encoderConfig.height,
  bitrate: encoderConfig.bitrate,
});
const service = new Service({ url: 'http://localhost:3000' });
const videoProcessor = new VideoProcessor({
  mp4Demuxer,
  webMWriter,
  service,
});

onmessage = async ({ data }) => {
  const canvasRenderer = new CanvasRenderer(data.$canvas);

  await videoProcessor.start({
    file: data.file,
    renderFrame: canvasRenderer.getRenderer(),
    encoderConfig,
    sendMessage(message) {
      self.postMessage(message);
    },
  });
};
