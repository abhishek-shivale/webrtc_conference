"use client"
import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

export default function Watch() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    let hls: Hls;

    const initPlayer = () => {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource('http://sample.vodobox.net/skate_phantom_flex_4k/skate_phantom_flex_4k.m3u8')
        if(video instanceof HTMLVideoElement == false) return
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
      } 
    };

    const checkInterval = setInterval(() => {
      fetch('http://sample.vodobox.net/skate_phantom_flex_4k/skate_phantom_flex_4k.m3u8')
        .then(res => {
          if (res.ok) {
            clearInterval(checkInterval);
            initPlayer();
          }
        })
        .catch(console.error);
    }, 2000);

    return () => {
      clearInterval(checkInterval);
      if (hls) hls.destroy();
    };
  }, []);

  return (
    <div>
      <h1>Live Stream</h1>
      <video 
        ref={videoRef} 
        controls 
        autoPlay 
        playsInline 
        style={{ width: '100%' }}
      />
    </div>
  );
}