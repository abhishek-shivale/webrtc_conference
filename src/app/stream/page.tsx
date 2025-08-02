"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { SocketContext } from "@/context/socket-context";
import {
    consumeStream,
    createConsumerTransport,
    createProducerTransport,
    getLocalStream,
    initializeDevice,
    startStreaming,
} from "./utils";
import RemoteVideo from "@/components/RemoteVideo";
import {RemoteStream} from "@/utils/types";

function page() {
    const { socket } = useContext(SocketContext);
    const [isInitialized, setIsInitialized] = useState(false);
    const [, setError] = useState<string | null>(null);
    const [consumerTransport, setConsumerTransport] = useState<any>(null);
    const [remoteStreams, setRemoteStreams] = useState<any[]>([]);
    const localStreamRef = useRef<HTMLVideoElement>(null);
    const [, setLocalStream] = useState<MediaStream | null>(null);
    const [, setDevice] = useState<any>(null);

    useEffect(() => {
        if (!socket || isInitialized) return;

        const initialize = async () => {
            try {
                console.log("Starting initialization...");
                const stream = await getLocalStream(localStreamRef, setLocalStream);
                console.log("Got local stream");

                const device = await initializeDevice(socket, setDevice);
                console.log("Device initialized");

                const prodTransport = await createProducerTransport(device, socket);
                console.log("Producer transport created");

                const consTransport = await createConsumerTransport(
                    socket,
                    device,
                    setConsumerTransport
                );
                console.log("Consumer transport created");

                await startStreaming(
                    prodTransport,
                    stream,
                    consTransport,
                    socket,
                    setRemoteStreams
                );
                console.log("Streaming started");

                setIsInitialized(true);
            } catch (error) {
                console.error("Initialization error:", error);
                setError(`Initialization failed: ${error}`);
            }
        };

        initialize();
    }, [socket]);

    useEffect(() => {
        if (!socket || !consumerTransport) return;

        const handleNewProducer = ({
                                       producerId,
                                       socketId,
                                   }: {
            producerId: string;
            socketId: string;
        }) => {
            console.log("NEW PRODUCER EVENT:", { producerId, socketId });
            console.log("Current remote streams count:", remoteStreams.length);
            console.log("Consumer transport ready:", !!consumerTransport);

            consumeStream(
                socket,
                producerId,
                socketId,
                consumerTransport,
                setRemoteStreams
            ).catch(console.error);
        };

        socket.on("newProducer", handleNewProducer);
        console.log("🎧 Listening for new producers...");

        return () => {
            socket.off("newProducer", handleNewProducer);
        };
    }, [consumerTransport, remoteStreams.length]);

    socket?.on('clientDisconnected', (socketId: string) => {
        console.log(`Client disconnected: ${socketId}`);
        console.log(remoteStreams)
        setRemoteStreams((prevStreams) =>
            prevStreams.filter((stream) =>
                stream.socketId !== socketId && !stream.id.startsWith(socketId)
            )
        );
    })

    const groupedStreams: Record<string, RemoteStream[]>  = remoteStreams.reduce((acc, stream) => {
        const socketId = stream.socketId || stream.id.split('-')[0];
        if (!acc[socketId]) {
            acc[socketId] = [];
        }
        acc[socketId].push(stream);
        return acc;
    }, {} as Record<string, any[]>);

    return (
        <div>
            <h1>Live Stream</h1>
            <div style={{ marginBottom: "20px" }}>
                <div style={{ marginBottom: "10px" }}>
                    Your ID is: {socket?.id}
                </div>

                <h3>Your Stream</h3>
                <video
                    ref={localStreamRef}
                    autoPlay
                    playsInline
                    controls
                    style={{
                        width: "320px",
                        height: "240px",
                        backgroundColor: "#000",
                        border: "2px solid #ccc",
                        borderRadius: "8px",
                    }}
                />
            </div>

            <h3>Remote Streams ({Object.keys(groupedStreams).length})</h3>
            {Object.keys(groupedStreams).length === 0 ? (
                <p>No other users streaming</p>
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                        gap: "15px",
                    }}
                >
                    {Object.entries(groupedStreams).map(([socketId, streams]) => {
                        if (!streams || streams.length === 0) return null;

                        const primaryStream = streams?.[0] as RemoteStream ;
                        return (
                            <RemoteVideo
                                key={socketId}
                                remoteStream={primaryStream}
                                allStreamsFromSameSocket={streams as RemoteStream[]}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default page;