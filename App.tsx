import React, { useState, useRef } from 'react';
import { AppState, GenerationStep, MediaAsset } from './types';
import { 
  generateSceneImage, 
  generateYouTubeMetadata, 
  generateAudio,
  generateScript,
  generateScriptWithScenes,
  transcribeAudio,
  generateSceneDescriptions,
  analyzeYouTubeVoice
} from './services/gemini';

async function decodePCM(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
  const binaryString = atob(base64.split(',')[1] || base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  try { 
    return await ctx.decodeAudioData(bytes.buffer.slice(0)); 
  } catch {
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  }
}

async function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = url;
    video.onloadedmetadata = () => resolve(video.duration);
  });
}

function createWhooshBuffer(ctx: AudioContext): AudioBuffer {
  const duration = 0.4;
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < buffer.length; i++) {
    const t = i / sampleRate;
    // White noise with exponential decay and frequency sweep
    data[i] = (Math.random() * 2 - 1) * Math.exp(-6 * t);
  }
  return buffer;
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    topic: '', script: '', voiceSample: null, userFullAudio: null,
    userImages: [], userVideos: [], youtubeVoiceLink: '',
    step: GenerationStep.IDLE, progressMessage: '', result: null
  });

  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isProducing, setIsProducing] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video' | 'voice' | 'fullAudio') => {
    const files = e.target.files;
    if (!files) return;

    const promises = Array.from(files as FileList).map((file: File) => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(promises).then(results => {
      setState(prev => {
        if (type === 'image') return { ...prev, userImages: [...prev.userImages, ...results].slice(0, 8) };
        if (type === 'video') return { ...prev, userVideos: [...prev.userVideos, ...results].slice(0, 2) };
        if (type === 'voice') return { ...prev, voiceSample: results[0], userFullAudio: null };
        if (type === 'fullAudio') return { ...prev, userFullAudio: results[0], voiceSample: null, youtubeVoiceLink: '' };
        return prev;
      });
    });
  };

  const startGeneration = async () => {
    if (!state.topic && !state.script && state.userImages.length === 0 && state.userVideos.length === 0) return;

    let finalScript = state.script;
    let voiceProfile = null;
    let mixedAssets: MediaAsset[] = [];

    try {
      // 1. Transcription (if audio uploaded but no script)
      if (state.userFullAudio && !finalScript) {
        setState(prev => ({ ...prev, step: GenerationStep.TRANSCRIBING, progressMessage: 'Analyzing vocal artifacts...' }));
        finalScript = await transcribeAudio(state.userFullAudio);
        setState(prev => ({ ...prev, script: finalScript }));
      }

      // 2. Video Scene Partitioning
      setState(prev => ({ ...prev, progressMessage: 'Partitioning video frames...' }));
      if (state.userVideos.length > 0) {
        const videoUrl = state.userVideos[0];
        const duration = await getVideoDuration(videoUrl);
        const segmentsCount = 4;
        const segDuration = duration / segmentsCount;
        for (let i = 0; i < segmentsCount; i++) {
          mixedAssets.push({
            type: 'video',
            url: videoUrl,
            hasAudio: true,
            startTime: i * segDuration,
            endTime: (i + 1) * segDuration
          });
        }
      }

      // 3. Image Generation & Interleaving
      setState(prev => ({ ...prev, step: GenerationStep.GENERATING_IMAGES, progressMessage: 'Synthesizing visual textures...' }));
      const descriptions = await generateSceneDescriptions(state.topic || "Atmospheric", finalScript);
      const userImages = [...state.userImages];
      const finalSequence: MediaAsset[] = [];
      const totalScenes = 8;

      for (let i = 0; i < totalScenes; i++) {
        if (i % 2 === 0 && mixedAssets.length > 0) {
          finalSequence.push(mixedAssets.shift()!);
        } else {
          if (userImages.length > 0) {
            finalSequence.push({ type: 'image', url: userImages.shift()!, hasAudio: false });
          } else {
            const desc = descriptions[i % descriptions.length];
            const url = await generateSceneImage(desc, i);
            finalSequence.push({ type: 'image', url, hasAudio: false });
          }
        }
      }

      // 4. Script & TTS Mastery (Reading out image prompts)
      if (!state.script && !state.userFullAudio) {
        setState(prev => ({ ...prev, step: GenerationStep.GENERATING_SCRIPT, progressMessage: 'Vocalizing visual prompts...' }));
        // Specifically pass generated image descriptions to the script master
        finalScript = await generateScriptWithScenes(state.topic || "Neural Vision", descriptions);
        setState(prev => ({ ...prev, script: finalScript }));
      }

      if (state.youtubeVoiceLink && !state.voiceSample && !state.userFullAudio) {
        setState(prev => ({ ...prev, step: GenerationStep.PROFILING_VOICE, progressMessage: 'Decoding vocal signature...' }));
        voiceProfile = await analyzeYouTubeVoice(state.youtubeVoiceLink);
      }

      let finalAudio = state.userFullAudio;
      if (!finalAudio && finalScript) {
        setState(prev => ({ ...prev, step: GenerationStep.GENERATING_AUDIO, progressMessage: 'Mastering voice resonance...' }));
        finalAudio = await generateAudio(finalScript, state.voiceSample, voiceProfile);
      }
      
      if (!finalAudio) throw new Error("Acoustic synthesis failed.");
      setAudioBase64(finalAudio);

      // Decode audio to get duration for subtitles
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const voiceBuffer = await decodePCM(finalAudio, audioCtx);
      const audioDuration = voiceBuffer.duration;

      setState(prev => ({ ...prev, progressMessage: 'Optimizing metadata...' }));
      const metadata = await generateYouTubeMetadata(finalScript || state.topic || "Untitled");

      // Generate Subtitles (Estimated based on character length)
      const sentences = (finalScript || "").split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      const totalChars = sentences.reduce((acc, s) => acc + s.length, 0);
      let currentOffset = 0;
      const subtitles = sentences.map(s => {
        const duration = (s.length / totalChars) * audioDuration;
        const segment = {
          text: s.trim(),
          start: currentOffset * 1000,
          end: (currentOffset + duration) * 1000
        };
        currentOffset += duration;
        return segment;
      });

      setState(prev => ({
        ...prev,
        step: GenerationStep.COMPLETED,
        progressMessage: 'Master production ready',
        result: { assets: finalSequence, metadata, subtitles }
      }));
    } catch (error: any) {
      setState(prev => ({ ...prev, step: GenerationStep.ERROR, progressMessage: error.message }));
    }
  };

  const compileVideo = async () => {
    if (!state.result || !audioBase64 || !canvasRef.current) return;
    setIsProducing(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const voiceBuffer = await decodePCM(audioBase64, audioCtx);
    const whooshBuffer = createWhooshBuffer(audioCtx);
    
    const audioDestination = audioCtx.createMediaStreamDestination();
    const voiceSource = audioCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    
    // REDUCED NOISE: Ducking source audio significantly to prioritize neural narration
    const bgGainNode = audioCtx.createGain();
    bgGainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);

    voiceSource.connect(audioDestination);
    voiceSource.connect(audioCtx.destination);
    bgGainNode.connect(audioDestination);
    bgGainNode.connect(audioCtx.destination);

    const stream = canvas.captureStream(30);
    const tracks = (stream.getVideoTracks() as MediaStreamTrack[]).concat(audioDestination.stream.getAudioTracks() as MediaStreamTrack[]);
    const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e: any) => chunks.push(e.data);
    recorder.onstop = () => {
      setDownloadUrl(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })));
      setIsProducing(false);
    };

    recorder.start();
    voiceSource.start(audioCtx.currentTime + 0.5);

    const videoElements: Record<string, HTMLVideoElement> = {};
    for (const asset of state.result.assets) {
      if (asset.type === 'video' && !videoElements[asset.url]) {
        const v = document.createElement('video');
        v.src = asset.url;
        v.muted = false;
        v.loop = true;
        v.playsInline = true;
        await v.play();
        videoElements[asset.url] = v;
        const vSource = audioCtx.createMediaElementSource(v);
        vSource.connect(bgGainNode);
      }
    }

    const imageElements: Record<string, HTMLImageElement> = {};
    for (const asset of state.result.assets) {
      if (asset.type === 'image' && !imageElements[asset.url]) {
        const img = new Image();
        img.src = asset.url;
        await new Promise(r => img.onload = r);
        imageElements[asset.url] = img;
      }
    }

    const startTime = Date.now();
    const totalDuration = (voiceBuffer.duration + 1.2) * 1000;
    const sceneDuration = totalDuration / state.result.assets.length;
    let lastIndex = -1;

    const render = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= totalDuration) {
        recorder.stop();
        Object.values(videoElements).forEach(v => v.pause());
        return;
      }

      const index = Math.floor(elapsed / sceneDuration);
      
      // Trigger Whoosh SFX on scene change
      if (index !== lastIndex && index < state.result!.assets.length) {
        const whooshSource = audioCtx.createBufferSource();
        whooshSource.buffer = whooshBuffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, audioCtx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.4);
        
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
        
        whooshSource.connect(filter);
        filter.connect(gain);
        gain.connect(audioDestination);
        gain.connect(audioCtx.destination);
        whooshSource.start();
        lastIndex = index;
      }

      const asset = state.result!.assets[index];
      const w = canvas.width, h = canvas.height;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      if (asset.type === 'video') {
        const v = videoElements[asset.url];
        const sceneProgress = (elapsed % sceneDuration) / sceneDuration;
        const segmentTime = (asset.startTime || 0) + (sceneProgress * ((asset.endTime || 0) - (asset.startTime || 0)));
        v.currentTime = segmentTime;

        const vRatio = v.videoWidth / v.videoHeight;
        const cRatio = w / h;
        let dw, dh, dx = 0, dy = 0;
        if (vRatio > cRatio) {
          dh = h; dw = h * vRatio; dx = (w - dw) / 2;
        } else {
          dw = w; dh = w / vRatio; dy = (h - dh) / 2;
        }
        ctx.drawImage(v, dx, dy, dw, dh);
      } else {
        const img = imageElements[asset.url];
        if (img) {
          const progress = (elapsed % sceneDuration) / sceneDuration;
          const scale = 1.05 + progress * 0.12;
          ctx.save();
          ctx.translate(w/2, h/2);
          ctx.scale(scale, scale);
          ctx.drawImage(img, -w/2, -h/2, w, h);
          ctx.restore();
        }
      }

      // Procedural Artifact Overlays
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      for (let i = 0; i < 60; i++) ctx.fillRect(Math.random()*w, Math.random()*h, 1, 1);
      
      const vignette = ctx.createRadialGradient(w/2, h/2, w/4, w/2, h/2, w);
      vignette.addColorStop(0, 'transparent');
      vignette.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      // Glass Subtitles
      if (state.result?.subtitles) {
        const currentSubtitle = state.result.subtitles.find(s => elapsed >= s.start && elapsed <= s.end);
        if (currentSubtitle) {
          ctx.save();
          
          const fontSize = 48;
          ctx.font = `bold ${fontSize}px Inter`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          const words = currentSubtitle.text.split(' ');
          const lines = [];
          let currentLine = '';
          const maxWidth = w * 0.8;

          for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (ctx.measureText(testLine).width > maxWidth) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          lines.push(currentLine);

          const lineHeight = fontSize * 1.2;
          const totalHeight = lines.length * lineHeight;
          const startY = h * 0.8 - (totalHeight / 2);

          lines.forEach((line, i) => {
            const ly = startY + i * lineHeight;
            
            // Shadow for visibility (The "seen because of shadow" requirement)
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 4;
            
            // Glass effect text
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fillText(line.toUpperCase(), w / 2, ly);
            
            // Secondary stroke for extra definition
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.strokeText(line.toUpperCase(), w / 2, ly);
          });
          
          ctx.restore();
        }
      }

      requestAnimationFrame(render);
    };
    render();
  };

  return (
    <div className="min-h-screen pb-40 overflow-x-hidden selection:bg-blue-600/30">
      {/* Apple-style Blur Nav */}
      <nav className="fixed top-0 w-full z-50 glass border-b px-10 py-6 flex justify-between items-center transition-all">
        <div className="flex items-center gap-5">
          <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center shadow-2xl">
            <div className="w-5 h-5 rounded-full bg-black animate-pulse"></div>
          </div>
          <span className="font-extrabold tracking-tighter text-2xl text-white">SyncShorts</span>
        </div>
        <div className="hidden md:flex gap-10 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
          <span className="text-white cursor-pointer hover:opacity-80 transition-all">Studio</span>
          <span className="hover:text-white cursor-pointer transition-all">Library</span>
          <span className="hover:text-white cursor-pointer transition-all">Settings</span>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="pt-56 pb-20 px-8 text-center max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
        <h1 className="text-7xl md:text-[10rem] font-black tracking-tighter gradient-text leading-[0.85] italic">Artifact Synthesis.</h1>
        <p className="text-xl md:text-2xl text-zinc-500 font-medium max-w-3xl mx-auto leading-relaxed">
          A high-end neural workshop for interspersing artifacts, vocalizing visual prompts, and mastering acoustic resonance.
        </p>
      </header>

      <main className="max-w-[1500px] mx-auto px-10 grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Left: Configuration Station */}
        <div className="lg:col-span-5 space-y-12">
          <section className="glass rounded-[3rem] p-12 space-y-12 shadow-3xl">
            <div className="space-y-8">
              <label className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600 block">Ingest Artifacts</label>
              
              <div className="space-y-5">
                <input 
                  type="text"
                  value={state.topic}
                  onChange={(e) => setState(prev => ({ ...prev, topic: e.target.value }))}
                  placeholder="Cinematic Concept..."
                  className="w-full p-6 text-xl font-bold bg-white/5 border border-white/10 rounded-2xl focus:border-blue-500 outline-none transition-all"
                />
                <textarea 
                  value={state.script}
                  onChange={(e) => setState(prev => ({ ...prev, script: e.target.value }))}
                  placeholder="Master Script (Optional: Leave blank for vocalized prompts)..."
                  className="w-full h-40 p-6 text-sm font-medium bg-white/5 border border-white/10 rounded-2xl focus:border-blue-500 outline-none transition-all resize-none leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-4 gap-4">
                {state.userVideos.map((v, i) => (
                  <div key={i} className="aspect-square rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden relative group hover:scale-105 transition-all">
                    <video src={v} className="w-full h-full object-cover" />
                    <button onClick={() => setState(p => ({...p, userVideos: p.userVideos.filter((_, idx) => idx !== i)}))} className="absolute inset-0 bg-red-600/90 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                    <div className="absolute top-2 left-2 px-2 py-0.5 glass rounded text-[7px] font-black uppercase tracking-tighter">MP4</div>
                  </div>
                ))}
                {state.userImages.map((img, i) => (
                  <div key={i} className="aspect-square rounded-2xl bg-zinc-900 border border-white/10 overflow-hidden relative group hover:scale-105 transition-all">
                    <img src={img} className="w-full h-full object-cover" />
                    <button onClick={() => setState(p => ({...p, userImages: p.userImages.filter((_, idx) => idx !== i)}))} className="absolute inset-0 bg-red-600/90 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
                <label className="aspect-square rounded-2xl border-2 border-dashed border-zinc-800 hover:border-zinc-500 hover:bg-white/5 flex flex-col items-center justify-center cursor-pointer transition-all gap-3 group">
                  <input type="file" multiple accept="image/*,video/*" onChange={(e) => {
                    const isVideo = e.target.files?.[0]?.type.startsWith('video');
                    handleFileUpload(e, isVideo ? 'video' : 'image');
                  }} className="hidden" />
                  <svg className="w-7 h-7 text-zinc-700 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"/></svg>
                </label>
              </div>
            </div>

            <div className="space-y-6">
              <label className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600 block">Vocal Source</label>
              <div className="flex gap-4">
                <button 
                  onClick={() => document.getElementById('narration-up')?.click()}
                  className={`flex-1 py-6 rounded-2xl glass hover:bg-white/10 transition-all text-xs font-black uppercase tracking-[0.2em] border-2 ${state.userFullAudio ? 'border-blue-600' : 'border-white/5'}`}
                >
                  {state.userFullAudio ? 'Audio Locked' : 'Upload Audio'}
                </button>
                <input type="file" id="narration-up" accept="audio/*" onChange={(e) => handleFileUpload(e, 'fullAudio')} className="hidden" />
              </div>
            </div>

            <button 
              disabled={state.step !== GenerationStep.IDLE}
              onClick={startGeneration}
              className="apple-button w-full py-7 text-xl shadow-[0_30px_70px_-15px_rgba(0,113,227,0.5)] disabled:opacity-30 font-black uppercase tracking-widest active:scale-95"
            >
              {state.step === GenerationStep.IDLE ? 'Commence Master' : 'Synthesizing Artifacts...'}
            </button>
          </section>

          {state.step !== GenerationStep.IDLE && state.step !== GenerationStep.COMPLETED && (
            <div className="glass rounded-[2rem] p-10 text-center animate-pulse border-white/5">
              <span className="text-[11px] font-black uppercase tracking-[0.4em] text-zinc-400 leading-relaxed">{state.progressMessage}</span>
            </div>
          )}
        </div>

        {/* Right: Master Viewport */}
        <div className="lg:col-span-7">
          <div className="glass rounded-[4rem] p-8 min-h-[900px] flex flex-col relative overflow-hidden shadow-4xl">
            {!state.result ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-10 grayscale-0 select-none space-y-10 animate-pulse">
                 <svg className="w-48 h-48 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.3" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>
                 <span className="text-6xl font-black uppercase tracking-[1.5em] text-zinc-800">Master</span>
              </div>
            ) : (
              <div className="flex-1 flex flex-col space-y-12 animate-in fade-in duration-1000 slide-in-from-bottom-5">
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                  <div className="space-y-2">
                    <h2 className="text-5xl font-black tracking-tighter text-white uppercase italic">{state.result.metadata.title}</h2>
                    <div className="flex gap-5">
                      <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Neural Final</span>
                      <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Master Studio Copy</span>
                    </div>
                  </div>
                  <button onClick={() => setState(s => ({...s, result: null, step: GenerationStep.IDLE}))} className="p-5 bg-white/5 rounded-full hover:bg-white/15 transition-all">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 p-6 flex-1">
                  <div className="relative group aspect-[9/16] glass rounded-[3rem] overflow-hidden shadow-4xl border-2 border-white/10 ring-1 ring-white/5">
                    <canvas ref={canvasRef} width={720} height={1280} className={`w-full h-full object-contain ${downloadUrl ? 'hidden' : ''}`} />
                    {downloadUrl && <video src={downloadUrl} controls className="w-full h-full object-contain" />}
                    
                    {!downloadUrl && !isProducing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/85 opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm">
                        <button onClick={compileVideo} className="apple-button px-14 py-6 text-xs font-black uppercase tracking-[0.3em]">Master Archive</button>
                      </div>
                    )}
                    
                    {isProducing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-xl">
                        <div className="flex flex-col items-center gap-10">
                           <div className="w-20 h-20 border-[6px] border-blue-500 border-t-transparent rounded-full animate-spin shadow-blue-500/20 shadow-2xl"></div>
                           <span className="text-[12px] font-black uppercase tracking-[0.6em] text-white">Exporting Final Artifact</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-12 overflow-y-auto max-h-[750px] pr-6 custom-scrollbar">
                    <div className="glass p-10 rounded-[2.5rem] space-y-6 border border-white/10">
                      <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em]">Vocalized Logic</span>
                      <p className="text-sm font-medium text-zinc-400 italic leading-[1.8] tracking-tight">
                        {state.script}
                      </p>
                    </div>

                    <div className="space-y-8">
                      <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em]">Sequence Master</span>
                      <div className="grid grid-cols-2 gap-5">
                        {state.result.assets.map((asset, i) => (
                          <div key={i} className="aspect-[9/16] rounded-3xl overflow-hidden border border-white/10 bg-zinc-900 group relative shadow-2xl hover:scale-[1.03] transition-all">
                            {asset.type === 'video' ? <video src={asset.url} className="w-full h-full object-cover" /> : <img src={asset.url} className="w-full h-full object-cover" alt={`Artifact ${i}`} />}
                            <div className="absolute top-3 left-3 px-3 py-1 glass rounded-lg text-[8px] font-black uppercase tracking-widest text-white shadow-lg">{asset.type}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {downloadUrl && (
                      <a href={downloadUrl} download="final_master.webm" className="apple-button w-full py-7 text-center block shadow-2xl font-black uppercase tracking-[0.3em] text-sm hover:scale-105 active:scale-95 transition-all">Export Studio Archive</a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-56 text-center pb-24 space-y-12 opacity-50">
        <div className="text-[10px] font-black tracking-[2em] uppercase text-zinc-600">Organic Artifact Synthesis v4.0</div>
        <p className="text-[11px] font-medium text-zinc-500 max-w-lg mx-auto leading-relaxed uppercase tracking-tighter">Mastered by SyncShorts Neural Workshop. <br/> Apple Pro Studio Architecture 2025.</p>
      </footer>
    </div>
  );
};

export default App;
