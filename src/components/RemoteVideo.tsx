import {RemoteStream} from "@/utils/types";
import {useEffect, useRef, useState} from "react";

export default function RemoteVideo({
                                        remoteStream,
                                        allStreamsFromSameSocket = []
                                    }: {
    remoteStream: RemoteStream;
    allStreamsFromSameSocket?: RemoteStream[];
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const video = videoRef.current;

        setIsPlaying(false);
        setError(null);

        if (!video) {
            console.log("No video element found");
            return;
        }

        // Collect all tracks from the same socket (both audio and video)
        const tracks: MediaStreamTrack[] = [];

        // Get the main stream's track
        if (remoteStream?.consumer?.track) {
            tracks.push(remoteStream.consumer.track);
        }

        // Get tracks from other streams with the same socketId
        allStreamsFromSameSocket.forEach(stream => {
            if (stream.id !== remoteStream.id && stream.consumer?.track) {
                // Make sure we don't add duplicate tracks
                const existingTrack = tracks.find(t => t.id === stream.consumer!.track.id);
                if (!existingTrack) {
                    tracks.push(stream.consumer.track);
                }
            }
        });

        if (tracks.length === 0) {
            console.log("No tracks found");
            setError("No tracks available");
            return;
        }

        // Create MediaStream with all tracks
        const mediaStream = new MediaStream(tracks);
        video.srcObject = mediaStream;

        console.log(`Setting up video for ${remoteStream.id} with ${tracks.length} tracks:`,
            tracks.map(t => `${t.kind}: ${t.id}`));

        const handleCanPlay = () => {
            console.log(`🎬 Video can play for ${remoteStream.id}`);
            video
                .play()
                .then(() => {
                    console.log(`Playback started for ${remoteStream.id}`);
                    setIsPlaying(true);
                })
                .catch((err) => {
                    console.error(`Failed to play video for ${remoteStream.id}:`, err);
                    setError(`Playback failed: ${err.message}`);
                });
        };

        video.addEventListener("canplay", handleCanPlay);

        return () => {
            console.log(`Cleaning up video for ${remoteStream.id}`);
            video.removeEventListener("canplay", handleCanPlay);
            setIsPlaying(false);
            setError(null);
        };
    }, [remoteStream?.consumer, remoteStream?.id, allStreamsFromSameSocket]);

    // Determine the media type for display
    const mediaType = remoteStream?.consumer?.kind || "unknown";
    const hasVideo = allStreamsFromSameSocket.some(s => s.consumer?.kind === "video") ||
        remoteStream?.consumer?.kind === "video";
    const hasAudio = allStreamsFromSameSocket.some(s => s.consumer?.kind === "audio") ||
        remoteStream?.consumer?.kind === "audio";

    return (
        <div style={{textAlign: "center"}}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                controls={hasAudio} // Show controls if there's audio
                style={{
                    width: "300px",
                    height: "200px",
                    backgroundColor: "#000",
                    border: `2px solid ${
                        error ? "#ff4444" : isPlaying ? "#00ff00" : "#007bff"
                    }`,
                }}
            />
            <p>Stream from: {remoteStream?.socketId || remoteStream?.id || "Unknown"}</p>
            <p style={{fontSize: "12px", color: "#666"}}>
                Producer: {remoteStream?.producerId || "Unknown"}
            </p>
            <p style={{fontSize: "10px", color: "#888"}}>
                Media: {hasVideo ? "📹" : ""} {hasAudio ? "🎵" : ""} ({mediaType})
            </p>
            <p
                style={{
                    fontSize: "10px",
                    color: isPlaying ? "#00aa00" : error ? "#ff4444" : "#666",
                }}
            >
                Status: {error || (isPlaying ? "Playing" : "Loading...")}
            </p>
        </div>
    );
}