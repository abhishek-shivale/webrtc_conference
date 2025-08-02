import {Socket} from "socket.io-client";
import {Dispatch, SetStateAction} from "react";
import {Streamer} from "@/utils/types";


export const getStreamer = async (socket: Socket, setStreamer: Dispatch<SetStateAction<Streamer[]>>) => {

    const result = await socket.emitWithAck('getStreamer', '');

    if (result?.error) {
        throw new Error(result.error);
    }

    setStreamer(result.streamer)
};


export const handleNewStreamer = (
    socket: Socket,
    setStreamer: Dispatch<SetStateAction<Streamer[]>>
): void => {
    const listener = (stream: Streamer) => {
        setStreamer(prev => {
            const exists = prev.some(s => s.id === stream.id && s.url === stream.url);
            if (!exists) {
                return [...prev, stream];
            }
            return prev;
        });
    };

    socket.on('newStreamer', listener);
};

export const handleStreamerDisconnect = (socket: Socket, setStreamer: Dispatch<SetStateAction<Streamer[]>>) => {
    const listener = (socketId: string) => {
        setStreamer(prev => prev.filter(s => s.id !== socketId));
    }
    socket.on('clientDisconnected', listener);
}