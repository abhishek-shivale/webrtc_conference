import {Server} from "socket.io";
import mediasoup from 'mediasoup';
import {
    connectConsumerTransport,
    connectProducerTransport,
    consume,
    createConsumerTransport,
    createProducerTransport,
    getProducers,
    produce,
    resumeConsumer,
    rtpCapabilities,
    stopLive,
} from "./events";
import {consumers, liveConsumers, producers, transports} from "./constant";
import {Streamer} from "@/utils/types";

declare module "socket.io" {
    interface Socket {
        rtpCapabilities?: mediasoup.types.RtpCapabilities;
    }
}

let io: Server;

const corsOptions = {
    origin: "*",
    methods: ["GET", "POST"],
};

export function initSocketIO(httpServer: any) {
    io = new Server(httpServer, {
        transports: ["websocket"],
        cors: corsOptions,
    });

    io.on("connection", (socket) => {
        console.log("New client connected:", socket.id);

        socket.on("rtpCapabilities", rtpCapabilities);

        socket.on("createProducerTransport", (callback) => {
            createProducerTransport(callback, socket.id);
        });

        socket.on("createConsumerTransport", (callback) => {
            createConsumerTransport(callback, socket.id);
        });

        socket.on(
            "connectProducerTransport",
            async ({dtlsParameters}, callback) => {
                connectProducerTransport(callback, dtlsParameters, socket.id);
            }
        );

        socket.on(
            "connectConsumerTransport",
            async ({dtlsParameters}, callback) => {
                connectConsumerTransport(callback, dtlsParameters, socket.id);
            }
        );

        socket.on("produce", async ({kind, rtpParameters}, callback) => {
            produce(kind, rtpParameters, callback, socket);
        });

        socket.on("consumer", async ({producerId}, callback) => {
            consume(producerId, callback, socket);
        })

        socket.on("resumeConsumer", async ({consumerId}, callback) => {
            resumeConsumer(consumerId, callback, socket.id);
        });

        socket.on("getProducers", (callback) => {
            getProducers(callback, socket.id);
        });

        socket.on("setRtpCapabilities", (rtpCapabilities) => {
            socket.rtpCapabilities = rtpCapabilities;
        });

        socket.on('getStreamer', async (_, callback) => {
            const streamers: Streamer[] = []
            liveConsumers.forEach((consumerData, key) => {
                const url = consumerData.url;
                if (!url) return;

                // Extract socket ID from producer key if possible
                // This assumes the producer key format contains socket info
                let socketId = key;
                for (const [producerKey, producerData] of producers.entries()) {
                    if (producerData.producerId === key) {
                        socketId = producerKey.split('-')[0]; // Extract socket ID from "socketId-kind"
                        break;
                    }
                }

                streamers.push({id: socketId, url});
            });
            callback({streamer: streamers ?? []});
        });

        socket.on("disconnect", () => {
            console.log(`Client ${socket.id} disconnecting, cleaning up...`);

            // Stop HLS streaming
            stopLive(socket.id);

            // Clean up producers for this socket (both audio and video)
            const producersToDelete = [];
            for (const [key, data] of producers.entries()) {
                if (key.startsWith(`${socket.id}-`)) {
                    console.log(`Closing producer ${data.producerId} (${data.kind}) for socket ${socket.id}`);
                    data.producer.close();
                    producersToDelete.push(key);
                }
            }
            producersToDelete.forEach(key => producers.delete(key));

            // Clean up transports
            const producerTransport = transports.get(`${socket.id}-producer`);
            if (producerTransport) {
                producerTransport.close();
                transports.delete(`${socket.id}-producer`);
            }

            const consumerTransport = transports.get(`${socket.id}-consumer`);
            if (consumerTransport) {
                consumerTransport.close();
                transports.delete(`${socket.id}-consumer`);
            }

            // Clean up consumers for this socket
            const consumersToDelete = [];
            for (const [key, data] of consumers.entries()) {
                if (key.startsWith(`${socket.id}-`)) {
                    console.log(`Closing consumer ${data.consumerId} (${data.kind}) for socket ${socket.id}`);
                    data.consumer.close();
                    consumersToDelete.push(key);
                }
            }
            consumersToDelete.forEach(key => consumers.delete(key));

            // Notify other clients about disconnection
            io.emit("clientDisconnected", socket.id);
            console.log(`Client ${socket.id} cleanup completed`);
        });
    });
}