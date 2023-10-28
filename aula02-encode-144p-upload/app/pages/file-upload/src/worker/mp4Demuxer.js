import { DataStream, createFile } from '../deps/mp4box.0.5.2.js';

export default class MP4Demuxer {
  #onConfig;
  #onChunk;
  #file;

  /**
   * @param {ReadableStream} stream
   * @param {object} options
   * @param {(config: VideoDecoderConfig) => void} options.onConfig
   * @returns {Promise<void>}
   */
  async run(stream, { onConfig, onChunk }) {
    this.#onConfig = onConfig;
    this.#onChunk = onChunk;

    this.#file = createFile();
    this.#file.onReady = this.#onReady.bind(this);
    this.#file.onSamples = this.#onSamples.bind(this);
    this.#file.onError = (error) => {
      console.error('[MP4Demuxer::run] Something went wrong', error);
    };

    return this.#init(stream);
  }

  #onReady(info) {
    const [track] = info.videoTracks;
    this.#onConfig({
      codec: track.codec,
      codedHeight: track.video.height,
      codedWidth: track.video.width,
      description: this.#description(track.id),
      // durationSecs: info.duration / info.timescale,
    });
    this.#file.setExtractionOptions(track.id);
    this.#file.start();
  }

  #onSamples(trackId, ref, samples) {
    for (const sample of samples) {
      this.#onChunk(
        new EncodedVideoChunk({
          data: sample.data,
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (1e6 * sample.cts) / sample.timescale,
          duration: (1e6 * sample.duration) / sample.timescale,
        })
      );
    }
  }

  /**
   * @param {ReadableStream} stream
   * @returns {Promise<void>}
   */
  #init(stream) {
    let _offset = 0;

    const consumeFile = new WritableStream({
      /** @param {Uint8Array} chunk */
      write: (chunk) => {
        const copy = chunk.buffer;
        copy.fileStart = _offset;
        this.#file.appendBuffer(copy);
        _offset += chunk.length;
      },
      close: () => {
        this.#file.flush();
      },
    });

    return stream.pipeTo(consumeFile);
  }

  #description(trackId) {
    const track = this.#file.getTrackById(trackId);
    for (const entry of track.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
      if (box) {
        const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
        box.write(stream);
        return new Uint8Array(stream.buffer, 8);
      }
    }
    throw new Error(
      '[MP4Demuxer::#description] avcC, hvcC, vpcC or av1C box not found'
    );
  }
}
