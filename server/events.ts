import {consumers, liveConsumers, producers, router, transports} from "./constant";
import {createTransport} from "./mediasoup";
import mediasoup from "mediasoup";
import {spawn} from "child_process"
import path from "path";
import fs from "fs";

export const rtpCapabilities = (callback: any) => {
    if (!router) {
        console.error("Router is not initialized");
        return;
    }
    const rtpCapabilitie = router.rtpCapabilities;
    if (!rtpCapabilitie) {
        console.error("RTP capabilities not found");
        return;
    }
    callback({rtpCapabilities: rtpCapabilitie});
};

export const createProducerTransport = async (callback: any, id: string) => {
    if (!router) {
        console.error("Router is not initialized");
        return;
    }

    try {
        if (transports.has(`${id}-producer`)) {
            console.log("Transport already exists for this socket");
            transports.delete(`${id}-producer`);
        }
        const transport = await createTransport(router);
        transports.set(`${id}-producer`, transport);

        const transportOption = {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        };
        callback(transportOption);
    } catch (error) {
        console.error("Error creating producer transport:", error);
        callback({error: "Error creating producer transport"});
    }
};

export const createConsumerTransport = async (callback: any, id: string) => {
    try {
        if (transports.has(`${id}-consumer`)) {
            transports.delete(`${id}-consumer`);
            console.log("Transport already exists for this socket");
        }

        const transport = await createTransport(router);
        transports.set(`${id}-consumer`, transport);

        const transportOption = {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        };
        callback(transportOption);
    } catch (error) {
        console.error("Error creating consumer transport:", error);
        callback({error: "Error creating consumer transport"});
    }
};

export const connectProducerTransport = async (
    callback: any,
    dtlsParameters: mediasoup.types.DtlsParameters,
    id: string
) => {
    try {
        console.log(`Connecting producer transport for socket: ${id}`);
        const transport = transports.get(`${id}-producer`);
        if (!transport) {
            throw new Error("Producer transport not found");
        }
        await transport.connect({dtlsParameters});
        console.log(`Producer transport connected successfully for socket: ${id}`);
        callback({success: true});
    } catch (error) {
        console.error("Error connecting producer transport:", error);
        callback({error: `Error connecting producer transport: ${error}`});
    }
};

export const connectConsumerTransport = async (
    callback: any,
    dtlsParameters: mediasoup.types.DtlsParameters,
    id: string
) => {
    try {
        console.log(`Connecting consumer transport for socket: ${id}`);
        const transport = transports.get(`${id}-consumer`);
        if (!transport) {
            throw new Error(`Consumer transport not found for socket: ${id}`);
        }

        await transport.connect({dtlsParameters});

        console.log(`Consumer transport connected successfully for socket: ${id}`);

        callback({success: true});
    } catch (error) {
        console.error(`Error connecting consumer transport for socket ${id}:`, error);
        callback({error: `Error connecting consumer transport: ${error}`});
    }
};

export const produce = async (
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters,
    callback: any,
    socket: any
) => {
    try {
        const transport = transports.get(`${socket.id}-producer`);

        if (!transport) {
            throw new Error("Producer transport not found");
        }

        // Create a unique key for this producer (socket + kind)
        const producerKey = `${socket.id}-${kind}`;

        // Close existing producer of the same kind if it exists
        if (producers.has(producerKey)) {
            console.log(`Producer already exists for ${producerKey}, closing old one`);
            const oldProducer = producers.get(producerKey);
            if (oldProducer?.producer) {
                oldProducer.producer.close();
            }
            producers.delete(producerKey);
        }

        console.log(`Creating ${kind} producer for socket: ${socket.id}`);
        const producer = await transport.produce({kind, rtpParameters});

        if (producer.paused) {
            await producer.resume();
            console.log(`Producer ${producer.id} resumed`);
        }

        console.log(`${kind} producer created: ${producer.id} for ${socket.id}`);

        // Broadcast new producer to other clients
        socket.broadcast.emit("newProducer", {
            producerId: producer.id,
            socketId: socket.id,
            kind: kind
        });

        // Store producer with kind-specific key
        producers.set(producerKey, {producer, producerId: producer.id, kind});

        // Start HLS streaming if this is video
        if (kind === 'video') {
            try {
                await startLive(socket);
                socket.broadcast.emit("newStreamer", {
                    id: socket.id,
                    url: `/hls/${socket.id}/playlist.m3u8`,
                });
            } catch (error) {
                console.error("Error starting HLS stream:", error);
            }
        }

        callback({id: producer.id});
    } catch (error) {
        console.error("Error producing:", error);
        callback({error: `Error producing: ${error}`});
    }
};

export const consume = async (
    producerId: string,
    callback: any,
    socket: any
) => {
    try {
        console.log(`Attempting to consume producer ${producerId} for socket ${socket.id}`);

        // Find the producer data
        const producerEntry = Array.from(producers.entries()).find(
            ([key, data]) => data.producerId === producerId
        );

        if (!producerEntry) {
            throw new Error(`Producer ${producerId} not found`);
        }

        const [producerKey, producerData] = producerEntry;
        const { producer, kind } = producerData;

        // Create a unique consumer key
        const consumerKey = `${socket.id}-${producerId}`;

        // Clean up existing consumer if it exists
        if (consumers.has(consumerKey)) {
            console.log(`Consumer already exists for ${consumerKey}, cleaning up`);
            const oldConsumer = consumers.get(consumerKey);
            if (oldConsumer?.consumer) {
                oldConsumer.consumer.close();
            }
            consumers.delete(consumerKey);
        }

        const transport = transports.get(`${socket.id}-consumer`);

        if (!transport) {
            throw new Error(`Consumer transport not found for socket ${socket.id}`);
        }

        if (!socket.rtpCapabilities) {
            throw new Error(`RTP capabilities not set on socket ${socket.id}`);
        }

        const consumerRtpCapabilities = socket.rtpCapabilities;

        // Check if this router can consume this producer
        const canConsume = router.canConsume({
            producerId: producer.id,
            rtpCapabilities: consumerRtpCapabilities as mediasoup.types.RtpCapabilities,
        });

        if (!canConsume) {
            throw new Error(`Cannot consume producer ${producerId} - incompatible RTP capabilities`);
        }

        console.log(`Router can consume ${kind} producer ${producerId}, creating consumer...`);

        const consumer = await transport.consume({
            producerId: producer.id,
            rtpCapabilities: consumerRtpCapabilities as mediasoup.types.RtpCapabilities,
        });

        consumers.set(consumerKey, {consumer, consumerId: consumer.id, kind});

        console.log(`${kind} consumer created: ${consumer.id} for socket ${socket.id} (producer: ${producerId})`);
        console.log(`Consumer paused state: ${consumer.paused}`);

        callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        });
    } catch (error) {
        console.error(`Error consuming producer ${producerId} for socket ${socket.id}:`, error);
        callback({error: `Error consuming: ${error}`});
    }
};

export const resumeConsumer = async (
    consumerId: string,
    callback: any,
    id: string
) => {
    try {
        console.log(`⏯️ Attempting to resume consumer ${consumerId} for socket ${id}`);

        // Find the consumer by consumerId
        const consumerEntry = Array.from(consumers.entries()).find(
            ([key, data]) => data.consumerId === consumerId
        );

        if (!consumerEntry) {
            throw new Error(`Consumer ${consumerId} not found for socket ${id}`);
        }

        const [consumerKey, consumerData] = consumerEntry;
        const { consumer, kind } = consumerData;

        if (consumer.paused) {
            await consumer.resume();
            console.log(`${kind} consumer ${consumerId} resumed for socket ${id}`);
        } else {
            console.log(`ℹ ${kind} consumer ${consumerId} was already resumed for socket ${id}`);
        }

        callback({success: true});
    } catch (error) {
        console.error(`Error resuming consumer ${consumerId} for socket ${id}:`, error);
        callback({error: `Error resuming consumer: ${error}`});
    }
};

export const getProducers = async (callback: any, id: string) => {
    try {
        console.log(`Getting producers list for socket ${id}`);

        // Get all producers except those from the requesting socket
        const producerList = Array.from(producers.entries())
            .filter(([key, data]) => {
                // Extract socket ID from the key (format: socketId-kind)
                const socketId = key.split('-')[0];
                return socketId !== id;
            })
            .map(([key, data]) => ({
                producerId: data.producerId,
                socketId: key.split('-')[0], // Extract socket ID from key
                kind: data.kind
            }));

        console.log(`Returning ${producerList.length} producers for socket ${id}:`,
            producerList.map(p => `${p.producerId} (${p.kind} from ${p.socketId})`));

        callback({producerList});
    } catch (error) {
        console.error(`Error getting producers for socket ${id}:`, error);
        callback({error: `Error getting producers: ${error}`});
    }
};

export async function startLive(socket: any) {
    try {
        const publicDir = path.join(process.cwd(), 'public');
        const hlsDir = path.join(publicDir, 'hls');
        const socketDir = path.join(hlsDir, socket.id);

        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }

        if (!fs.existsSync(hlsDir)) {
            fs.mkdirSync(hlsDir, { recursive: true });
        }

        if (!fs.existsSync(socketDir)) {
            fs.mkdirSync(socketDir, { recursive: true });
        }

        // Look for video producer
        const videoProducerKey = `${socket.id}-video`;
        const videoProd = producers.get(videoProducerKey);

        if (!videoProd) {
            throw new Error(`No video producer found for socket ${socket.id}`);
        }

        const connection = await router.createPlainTransport({
            listenIp: { ip: '127.0.0.1' },
            rtcpMux: false,
            comedia: false,
            enableSctp: false
        });

        const routerRtpCapabilities = router.rtpCapabilities;

        const consumer = await connection.consume({
            producerId: videoProd.producerId,
            paused: true,
            rtpCapabilities: routerRtpCapabilities
        });

        liveConsumers.set(`${videoProd.producerId}`, {
            consumer: consumer,
            consumerId: consumer.id,
            connection: connection,
            url: `/hls/${socket.id}/playlist.m3u8`,
        });

        const ffmpegListenIp = '127.0.0.1';
        const ffmpegListenRtpPort = Math.floor(Math.random() * (65535 - 20000)) + 20000;
        const ffmpegListenRtcpPort = ffmpegListenRtpPort + 1;

        await connection.connect({
            ip: ffmpegListenIp,
            port: ffmpegListenRtpPort,
            rtcpPort: ffmpegListenRtcpPort
        });

        console.log(`Transport connected: ${ffmpegListenIp}:${ffmpegListenRtpPort}`);
        console.log(`Consumer RTP parameters:`, {
            payloadType: consumer.rtpParameters.codecs[0]?.payloadType,
            mimeType: consumer.rtpParameters.codecs[0]?.mimeType,
            clockRate: consumer.rtpParameters.codecs[0]?.clockRate
        });

        const codec = consumer.rtpParameters.codecs[0];
        const payloadType = codec.payloadType;
        const mimeType = codec.mimeType;
        const clockRate = codec.clockRate;

        const sdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=MediaSoup Stream
c=IN IP4 127.0.0.1
t=0 0
m=video ${ffmpegListenRtpPort} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${mimeType.split('/')[1]}/${clockRate}
a=sendonly
`;

        const sdpPath = path.join(socketDir, 'stream.sdp');
        fs.writeFileSync(sdpPath, sdpContent);
        console.log(`SDP file created at: ${sdpPath}`);

        let ffmpegArgs = [
            '-loglevel', 'debug',
            '-protocol_whitelist', 'file,udp,rtp',
            '-fflags', '+genpts',
            '-thread_queue_size', '1024',
            '-i', sdpPath,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-profile:v', 'baseline',
            '-level', '3.0',
            '-pix_fmt', 'yuv420p',
            '-r', '25',
            '-g', '50',
            '-keyint_min', '25',
            '-sc_threshold', '0',
            '-b:v', '1000k',
            '-maxrate', '1000k',
            '-bufsize', '2000k',
            '-an', // No audio for video-only HLS
            '-f', 'hls',
            '-hls_time', '2',
            '-hls_list_size', '5',
            '-hls_flags', 'delete_segments+append_list',
            '-hls_allow_cache', '0',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', path.join(socketDir, 'segment_%03d.ts'),
            '-start_number', '0',
            path.join(socketDir, 'playlist.m3u8')
        ];

        console.log(`Starting FFmpeg for video stream from socket ${socket.id}`);
        console.log(`FFmpeg args:`, ffmpegArgs.join(' '));

        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        ffmpeg.stdout.on('data', (data) => {
            console.log(`FFmpeg stdout [${socket.id}]: ${data.toString().trim()}`);
        });

        ffmpeg.stderr.on('data', (data) => {
            const output = data.toString().trim();
            console.log(`FFmpeg stderr [${socket.id}]: ${output}`);
        });

        ffmpeg.on('close', (code) => {
            console.log(`FFmpeg process for socket ${socket.id} exited with code ${code}`);
            const consumerData = liveConsumers.get(`${videoProd.producerId}`);
            if (consumerData) {
                consumerData.consumer?.close();
                consumerData.connection?.close();
                liveConsumers.delete(`${videoProd.producerId}`);
            }
        });

        ffmpeg.on('error', (error) => {
            console.error(`FFmpeg error for socket ${socket.id}:`, error);
        });

        setTimeout(async () => {
            try {
                console.log(`Resuming consumer for producer ${videoProd.producerId}`);
                await consumer.resume();
                console.log(`Consumer resumed successfully for socket ${socket.id}`);

                setTimeout(async () => {
                    try {
                        const stats = await consumer.getStats();
                        console.log(`Consumer stats for ${socket.id}:`, stats);
                    } catch (error) {
                        console.error(`Error getting consumer stats:`, error);
                    }
                }, 5000);

            } catch (error) {
                console.error(`Error resuming consumer for socket ${socket.id}:`, error);
            }
        }, 3000);

        console.log(`HLS stream started for socket ${socket.id}`);
        console.log(`Playlist available at: /public/hls/${socket.id}/playlist.m3u8`);
        console.log(`RTP endpoint: ${ffmpegListenIp}:${ffmpegListenRtpPort}`);

        return {
            connection,
            consumer,
            ffmpeg,
            playlistPath: `/hls/${socket.id}/playlist.m3u8`,
            hlsDirectory: socketDir,
            socketId: socket.id,
            mediaType: 'video'
        };

    } catch (e) {
        console.error('Error startLive:', e);
        throw e;
    }
}

export function stopLive(socketId: string) {
    try {
        for (const [producerId, consumerData] of liveConsumers.entries()) {
            if (producerId.includes(socketId)) {
                consumerData.consumer?.close();
                consumerData.connection?.close();
                liveConsumers.delete(producerId);
                console.log(`Stopped live stream for socket ${socketId}`);
                break;
            }
        }
    } catch (e) {
        console.error(`Error stopping live stream for socket ${socketId}:`, e);
    }
}

export async function stopAllLiveStreams() {
    try {
        liveConsumers.forEach(({ consumer, connection }) => {
            consumer?.close();
            connection?.close();
        });
        liveConsumers.clear();
        console.log('All live streams stopped');
    } catch (e) {
        console.error('Error stopping all live streams:', e);
    }
}