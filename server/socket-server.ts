import {Server} from "socket.io";
import mediasoup from 'mediasoup';
import {
    connectConsumerTransport,
    connectProducerTransport,
    consume,
    createConsumerTransport,
    createProducerTransport,
    // getHLSPlaylist,
    // getHLSStreams,
    getProducers,
    // hlsManager,
    produce,
    resumeConsumer,
    rtpCapabilities, stopLive,
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
            liveConsumers.keys().forEach((key: string) => {
                const url = liveConsumers.get(key)?.url
                if (!url) return;
                streamers.push({id: key, url})
            })
            callback({streamer: streamers ?? []});
        });
        //
        // socket.on("getHLSPlaylist", ({ producerId }, callback) => {
        //     getHLSPlaylist(producerId, callback);
        // });

        socket.on("disconnect", () => {
            stopLive(socket.id);
            producers.delete(socket.id);
            transports.delete(`${socket.id}-producer`);
            transports.delete(`${socket.id}-consumer`);
            consumers.delete(socket.id);
            io.emit("clientDisconnected", socket.id);
            console.log("A client disconnected");
        });
    });
}