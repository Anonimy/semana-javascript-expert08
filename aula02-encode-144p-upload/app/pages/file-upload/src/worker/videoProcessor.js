export default class VideoProcessor {
  #mp4Demuxer;

  #webMWriter;

  #service;

  #buffers = [];

  /**
   * @param {object} options
   * @param {import('./mp4Demuxer.js').default} options.mp4Demuxer
   * @param {import('../deps/webm-writer2.js').default} options.webMWriter
   * @param {import('./service.js').default} options.service
   */
  constructor({ mp4Demuxer, webMWriter, service }) {
    this.#mp4Demuxer = mp4Demuxer;
    this.#webMWriter = webMWriter;
    this.#service = service;
  }

  /**
   * @param {ReadableStream<Uint8Array>} stream
   * @returns {ReadableStream<Uint8Array>}
   */
  mp4Decoder(stream) {
    return new ReadableStream({
      start: async (controller) => {
        const decoder = new VideoDecoder({
          /** @param {VideoFrame} frame */
          output(frame) {
            controller.enqueue(frame);
          },
          error(err) {
            console.error('[VideoProcessor::mp4Decoder] Error', err);
            controller.error(err);
          },
        });
        this.#mp4Demuxer.run(stream, {
          /** @param {VideoDecoderConfig} config */
          async onConfig(config) {
            // const { supported } = await VideoDecoder.isConfigSupported(config);
            // if (!supported) {
            //   const msg =
            //     '[VideoProcessor::mp4Decoder] VideoDecoder not supported';
            //   console.error(msg, config);
            //   controller.error(msg);
            //   return;
            // }
            decoder.configure(config);
          },

          /** @param {EncodedVideoChunk} chunk */
          onChunk(chunk) {
            decoder.decode(chunk);
          },
        });
      },
    });
  }

  /** @returns {ReadableWritablePair} */
  encode144p(encoderConfig) {
    let _encoder;
    const readable = new ReadableStream({
      start: async (controller) => {
        const { supported } = await VideoEncoder.isConfigSupported(
          encoderConfig
        );
        if (!supported) {
          const msg = '[VideoProcessor::encode144p] VideoEncoder not supported';
          console.error(msg, encoderConfig);
          controller.error(msg);
          return;
        }
        _encoder = new VideoEncoder({
          /**
           * @param {EncodedVideoChunk} chunk
           * @param {EncodedVideoChunkMetadata} config
           */
          output: (chunk, config) => {
            if (config.decoderConfig) {
              controller.enqueue({
                type: 'config',
                config: config.decoderConfig,
              });
            }
            controller.enqueue(chunk);
          },

          error: (err) => {
            const msg = '[VideoProcessor::encode144p] Error on VideoEncoder';
            console.error(msg, err);
            controller.error(err);
          },
        });

        _encoder.configure(encoderConfig);
      },
    });

    const writable = new WritableStream({
      async write(frame) {
        _encoder.encode(frame);
        frame.close();
      },
    });

    return { readable, writable };
  }

  /** @returns {TransformStream} */
  renderDecodedAndGetEncodedChunks(renderFrame) {
    let _decoder;
    return new TransformStream({
      start(controller) {
        _decoder = new VideoDecoder({
          output(chunk) {
            renderFrame(chunk);
          },

          error(err) {
            const msg = '[VideoProcessor::renderDecodedAndGetEncodedChunk] err';
            console.error(msg, err);
            controller.error(msg);
          },
        });
      },

      /**
       * @param {EncodedVideoChunk} encodedChunk
       * @param {TransformStreamDefaultController} controller
       */
      async transform(encodedChunk, controller) {
        if (encodedChunk.type === 'config') {
          await _decoder.configure(encodedChunk.config);
          return;
        }
        _decoder.decode(encodedChunk);
        controller.enqueue(encodedChunk);
      },
    });
  }

  /** @returns {ReadableWritablePair} */
  transformIntoWebM() {
    const writable = new WritableStream({
      write: (chunk) => {
        this.#webMWriter.addFrame(chunk);
      },
      close() {
        debugger;
      },
    });

    return { readable: this.#webMWriter.getStream(), writable };
  }

  upload(fileName, resolution, type) {
    const buffer = [];
    let byteCount = 0;
    let segmentCount = 0;

    const triggerUpload = async () => {
      const blob = new Blob(buffer, { type: `video/${type}` });
      await this.#service.uploadFile({
        fileName: `${fileName}-${resolution}-${++segmentCount}.${type}`,
        fileBuffer: blob,
      });
      buffer.length = 0;
      byteCount = 0;
    };

    return new WritableStream({
      /**
       * @param {object} chunk
       * @param {Uint8Array} chunk.data
       * @param {number} chunk.position
       */
      async write({ data }) {
        buffer.push(data);
        byteCount += data.byteLength;
        if (byteCount <= 10e6) return;
        await triggerUpload();
      },
      async close() {
        if (buffer.length) {
          await triggerUpload();
        }
      },
    });
  }

  async start({ file, encoderConfig, renderFrame, sendMessage }) {
    const stream = file.stream();
    const fileName = file.name.split('/').pop().replace('.mp4', '');
    await this.mp4Decoder(stream)
      .pipeThrough(this.encode144p(encoderConfig))
      .pipeThrough(this.renderDecodedAndGetEncodedChunks(renderFrame))
      .pipeThrough(this.transformIntoWebM())
      // .pipeThrough(
      // debug purposes only
      // new TransformStream({
      //   transform: (chunk, controller) => {
      //     const { data, position } = chunk;
      //     this.#buffers.push(data);
      //     controller.enqueue(data);
      //   },
      //   flush: () => {
      //     sendMessage({
      //       status: 'done',
      //       buffers: this.#buffers,
      //       fileName: `${fileName}-144p.webm`,
      //     });
      //   },
      // })
      // )
      .pipeTo(this.upload(fileName, '144p', 'webm'));
    sendMessage({ status: 'done' });
  }
}
