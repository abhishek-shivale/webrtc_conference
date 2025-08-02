"use client";
import {useContext, useEffect, useRef, useState} from "react";
import Hls from "hls.js";
import {SocketContext} from "@/context/socket-context";
import {
    getStreamer,
    handleNewStreamer,
    handleStreamerDisconnect,
} from "@/app/watch/utils";

interface Streamer {
    id: string;
    url: string;
}

export default function Watch() {
    const {socket} = useContext(SocketContext);
    const [streamer, setStreamer] = useState<Streamer[]>([]);
    const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

    useEffect(() => {
        async function fetchData() {
            if (!socket) return;
            await getStreamer(socket, setStreamer);
            handleNewStreamer(socket, setStreamer);
            handleStreamerDisconnect(socket, setStreamer);
        }

        fetchData();
    }, [socket]);

    useEffect(() => {
        streamer.forEach((stream) => {
            if (!stream.url.endsWith(".m3u8")) return;

            const video = videoRefs.current.get(stream.id);
            if (!video) return;

            if (Hls.isSupported()) {
                const hls = new Hls({enableWorker: true});
                hls.loadSource(stream.url);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch(console.error);
                });

                return () => {
                    hls.destroy();
                };
            }
        });
    }, [streamer]);

    return (
        <div>
            <h1>Live Streamers: {streamer.length} Live</h1>
            {
                streamer.length === 0 ? (
                    <>No Streamer Streaming</>
                ) : (
                    streamer.map((stream) =>
                        stream.url.endsWith(".m3u8") ? (
                            <div key={stream.id}>
                                <p>Streamer ID: {stream.id}</p>
                                <video
                                    ref={(el) => {
                                        if (el) videoRefs.current.set(stream.id, el);
                                    }}
                                    controls
                                    autoPlay
                                    playsInline
                                    style={{width: "20%", marginBottom: "1rem"}}
                                />
                            </div>
                        ) : null
                    )
                )
            }
        </div>
    );
}
