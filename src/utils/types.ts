import { Consumer } from "mediasoup-client/types";

export interface RemoteStream {
    id: string;
    socketId?: string;
    producerId?: string;
    consumer?: Consumer;
    tracks?: {
        video?: MediaStreamTrack;
        audio?: MediaStreamTrack;
    };
}

export type Streamer = {
    id: string;
    url: string;
};