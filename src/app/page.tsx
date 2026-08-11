'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Mic,
  MicOff,
  Radio,
  Settings,
  Zap,
  Activity,
  AlertCircle,
  Volume2,
  VolumeX,
  Sparkles,
} from 'lucide-react';
import { AudioManager } from '@/lib/audio-manager';
import { MoshiClient, ConnectionState } from '@/lib/moshi-client';
import { SettingsModal, AppConfig } from '@/components/SettingsModal';

// Dynamically import AudioVisualizer to avoid SSR issues with canvas
const AudioVisualizer = dynamic(
  () => import('@/components/AudioVisualizer').then(mod => ({ default: mod.AudioVisualizer })),
  { ssr: false }
);

function MoshiVoiceClientInner() {
  // Application Configuration
  const [config, setConfig] = useState<AppConfig>({
    // Use the loopback IP instead of `localhost`: browsers may attach large
    // localhost cookie headers that exceed Moshi's aiohttp header limit.
    wsUrl: 'ws://127.0.0.1:8998/api/chat',
    sampleRate: 24000,
    format: 'int16',
    talkMode: 'continuous',
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });

  // Client States
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(false);
  const [isAISpeaking, setIsAISpeaking] = useState<boolean>(false);
  const [isPushingToTalk, setIsPushingToTalk] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [aiText, setAiText] = useState<string>('');

  // Audio Manager & WS Client References
  const audioManagerRef = useRef<AudioManager | null>(null);
  const moshiClientRef = useRef<MoshiClient | null>(null);

  // Stable references for state checks in callbacks
  const isSpeakerMutedRef = useRef(isSpeakerMuted);
  useEffect(() => {
    isSpeakerMutedRef.current = isSpeakerMuted;
  }, [isSpeakerMuted]);

  const isMicMutedRef = useRef(isMicMuted);
  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  // Do not allow Moshi's own output to become its next microphone input. This
  // is especially important on devices where hardware AEC is unavailable.
  const isAISpeakingRef = useRef(isAISpeaking);
  useEffect(() => {
    isAISpeakingRef.current = isAISpeaking;
  }, [isAISpeaking]);

  // Analyser nodes for visualizer
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const [speakerAnalyser, setSpeakerAnalyser] = useState<AnalyserNode | null>(null);

  // Clean error banner after delay
  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 8000);
  }, []);

  // Handle incoming binary audio chunks from Moshi backend
  const handleAudioReceived = useCallback((chunk: ArrayBuffer) => {
    if (!isSpeakerMutedRef.current && audioManagerRef.current) {
      audioManagerRef.current.playChunk(chunk);
    }
  }, []);

  // Handle incoming text from Moshi
  const handleTextReceived = useCallback((text: string) => {
    setAiText(prev => prev + text);
  }, []);

  // Initialize Moshi WebSocket Client
  useEffect(() => {
    const client = new MoshiClient({
      url: config.wsUrl,
      autoReconnect: false,
      onStateChange: (state) => {
        setConnectionState(state);
      },
      onAudioReceived: handleAudioReceived,
      onTextReceived: handleTextReceived,
      onError: (err) => showError(`WebSocket Error: ${err.message}`),
    });

    moshiClientRef.current = client;

    return () => {
      client.disconnect();
    };
  }, [config.wsUrl, handleAudioReceived, handleTextReceived, showError]);

  // Initialize unified AudioManager
  const getAudioManager = useCallback(async (): Promise<AudioManager> => {
    if (!audioManagerRef.current) {
      const manager = new AudioManager({
        echoCancellation: config.echoCancellation,
        noiseSuppression: config.noiseSuppression,
        autoGainControl: config.autoGainControl,
        onAudioChunk: (chunk) => {
          if (!isMicMutedRef.current && moshiClientRef.current) {
            moshiClientRef.current.sendAudioChunk(chunk);
          }
        },
        onSpeakingStateChange: (speaking) => {
          isAISpeakingRef.current = speaking;
          setIsAISpeaking(speaking);
        },
        shouldSuppressMicrophone: () => isAISpeakingRef.current,
        onError: (err) => {
          showError(`Audio Engine Error: ${err.message}`);
        },
      });
      await manager.init();
      audioManagerRef.current = manager;
      setSpeakerAnalyser(manager.getSpeakerAnalyser());
    }
    return audioManagerRef.current;
  }, [config.echoCancellation, config.noiseSuppression, config.autoGainControl, showError]);

  // Start Microphone capture
  const startMicrophone = useCallback(async () => {
    try {
      const manager = await getAudioManager();
      await manager.startMicrophone();
      setMicAnalyser(manager.getMicAnalyser());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      showError(`Mic Access Denied: ${error.message}`);
    }
  }, [getAudioManager, showError]);

  // Stop Microphone capture
  const stopMicrophone = useCallback(() => {
    if (audioManagerRef.current) {
      audioManagerRef.current.stopMicrophone();
      setMicAnalyser(null);
    }
  }, []);

  // Toggle Connect / Disconnect
  const handleToggleConnection = useCallback(async () => {
    if (connectionState === 'CONNECTED' || connectionState === 'CONNECTING') {
      moshiClientRef.current?.disconnect();
      stopMicrophone();
      if (audioManagerRef.current) {
        audioManagerRef.current.stop();
        audioManagerRef.current = null;
        setSpeakerAnalyser(null);
      }
    } else {
      // Clear previous AI text
      setAiText('');

      // Initialize audio engine (user gesture)
      await getAudioManager();

      // Connect WebSocket
      moshiClientRef.current?.connect();

    }
  }, [connectionState, stopMicrophone, getAudioManager]);

  // The Moshi server sends the handshake. Starting capture only after it
  // arrives prevents initial audio from being dropped or associated with an
  // incomplete session.
  useEffect(() => {
    if (connectionState === 'CONNECTED' && config.talkMode === 'continuous') {
      void startMicrophone();
    }
  }, [connectionState, config.talkMode, startMicrophone]);

  // Handle Push-to-Talk mouse down / touch start
  const handlePushToTalkStart = () => {
    if (config.talkMode !== 'pushtotalk' || connectionState !== 'CONNECTED') return;
    setIsPushingToTalk(true);
    startMicrophone();
  };

  // Handle Push-to-Talk mouse up / touch end
  const handlePushToTalkEnd = () => {
    if (config.talkMode !== 'pushtotalk' || connectionState !== 'CONNECTED') return;
    setIsPushingToTalk(false);
    stopMicrophone();
  };

  // Save new configuration
  const handleSaveConfig = (newConfig: AppConfig) => {
    setConfig(newConfig);
    if (moshiClientRef.current) {
      moshiClientRef.current.setUrl(newConfig.wsUrl);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioManagerRef.current?.stop();
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col justify-between p-6 relative overflow-hidden font-sans selection:bg-indigo-500 selection:text-white">
      
      {/* Background Decorative Gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[450px] h-[450px] bg-purple-600/10 rounded-full blur-[160px] pointer-events-none" />

      {/* Header Bar */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between z-10 py-2">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-neutral-200 to-indigo-300 bg-clip-text text-transparent">
              Sam AI Speech
            </h1>
            <p className="text-xs text-neutral-400 flex items-center gap-1.5">
              <span>Native Speech-to-Speech</span>
              <span>•</span>
              <span className="text-neutral-500">24kHz Opus</span>
            </p>
          </div>
        </div>

        {/* Status Indicators & Settings Button */}
        <div className="flex items-center space-x-3">
          {/* Connection State Badge */}
          <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-neutral-900/90 border border-neutral-800 text-xs font-medium">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                connectionState === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]'
                  : connectionState === 'CONNECTING'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-rose-500'
              }`}
            />
            <span className="uppercase tracking-wider text-[11px] text-neutral-300">
              {connectionState}
            </span>
          </div>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 rounded-full bg-neutral-900/90 border border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
            title="Audio & Server Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="w-full max-w-2xl mx-auto z-20 mt-4 p-4 rounded-2xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-sm flex items-start space-x-3 shadow-xl backdrop-blur-md">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-rose-300">Connection Error</div>
            <div className="text-xs text-rose-200/90 mt-0.5">{errorMessage}</div>
          </div>
        </div>
      )}

      {/* Main Interactive Stage */}
      <section className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center z-10 space-y-8 my-auto">
        
        {/* Status Activity Banner */}
        <div className="flex items-center space-x-4">
          <div className={`flex items-center space-x-2 px-4 py-1.5 rounded-full border text-xs font-medium transition ${
            micAnalyser && !isMicMuted
              ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
              : 'bg-neutral-900/50 border-neutral-800 text-neutral-500'
          }`}>
            <Mic className="w-3.5 h-3.5" />
            <span>{micAnalyser && !isMicMuted ? 'Mic Capturing' : 'Mic Off'}</span>
          </div>

          <div className={`flex items-center space-x-2 px-4 py-1.5 rounded-full border text-xs font-medium transition ${
            isAISpeaking
              ? 'bg-purple-500/10 border-purple-500/40 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
              : 'bg-neutral-900/50 border-neutral-800 text-neutral-500'
          }`}>
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isAISpeaking ? 'Sam Speaking...' : 'AI Idle'}</span>
          </div>
        </div>

        {/* Dual Canvas Audio Waveform Visualizer */}
        <AudioVisualizer
          micAnalyser={micAnalyser}
          speakerAnalyser={speakerAnalyser}
          isMicActive={!!micAnalyser && !isMicMuted}
          isAISpeaking={isAISpeaking}
          width={640}
          height={180}
        />

        {/* AI Text Output */}
        {aiText && (
          <div className="w-full max-w-lg mx-auto p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-neutral-400 font-medium uppercase tracking-wider">Sam says</span>
            </div>
            <p className="text-sm text-neutral-200 leading-relaxed">{aiText}</p>
          </div>
        )}

        {/* Main Central Action Control */}
        <div className="flex flex-col items-center space-y-5">
          {config.talkMode === 'continuous' ? (
            /* Continuous Mode Button */
            <button
              onClick={handleToggleConnection}
              className={`relative group w-32 h-32 rounded-full flex flex-col items-center justify-center font-bold text-sm tracking-wider transition-all duration-300 shadow-2xl border ${
                connectionState === 'CONNECTED'
                  ? 'bg-gradient-to-br from-indigo-600 to-purple-700 text-white border-indigo-400/50 hover:scale-105 animate-pulse-glow'
                  : connectionState === 'CONNECTING'
                  ? 'bg-neutral-800 text-amber-300 border-amber-500/30 animate-pulse'
                  : 'bg-neutral-900 hover:bg-neutral-850 text-neutral-300 border-neutral-700 hover:border-indigo-500/60 hover:scale-105'
              }`}
            >
              {connectionState === 'CONNECTED' ? (
                <>
                  <Activity className="w-8 h-8 mb-1 text-indigo-200" />
                  <span>CONNECTED</span>
                  <span className="text-[10px] text-indigo-200/80 font-normal">Click to Stop</span>
                </>
              ) : connectionState === 'CONNECTING' ? (
                <>
                  <Radio className="w-8 h-8 mb-1 animate-spin text-amber-400" />
                  <span>CONNECTING</span>
                </>
              ) : (
                <>
                  <Mic className="w-8 h-8 mb-1 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <span>CONNECT</span>
                  <span className="text-[10px] text-neutral-400 font-normal">Start Voice</span>
                </>
              )}
            </button>
          ) : (
            /* Push to Talk Mode Button */
            <div className="flex flex-col items-center space-y-3">
              <button
                onMouseDown={handlePushToTalkStart}
                onMouseUp={handlePushToTalkEnd}
                onTouchStart={handlePushToTalkStart}
                onTouchEnd={handlePushToTalkEnd}
                disabled={connectionState !== 'CONNECTED'}
                className={`w-36 h-36 rounded-full flex flex-col items-center justify-center font-bold text-sm tracking-wider transition-all duration-200 border ${
                  connectionState !== 'CONNECTED'
                    ? 'bg-neutral-900 text-neutral-600 border-neutral-800 cursor-not-allowed'
                    : isPushingToTalk
                    ? 'bg-rose-600 text-white border-rose-400 scale-110 shadow-[0_0_35px_rgba(225,29,72,0.6)]'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 hover:scale-105 shadow-xl shadow-indigo-600/30'
                }`}
              >
                <Mic className="w-9 h-9 mb-1" />
                <span>{isPushingToTalk ? 'SPEAKING' : 'HOLD TO TALK'}</span>
              </button>

              {connectionState !== 'CONNECTED' && (
                <button
                  onClick={handleToggleConnection}
                  className="px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 hover:text-white"
                >
                  Connect WebSocket First
                </button>
              )}
            </div>
          )}

          {/* Quick Mute Action Bar */}
          {connectionState === 'CONNECTED' && (
            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={() => setIsMicMuted(!isMicMuted)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl border text-xs font-medium transition ${
                  isMicMuted
                    ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                <span>{isMicMuted ? 'Mic Muted' : 'Mute Mic'}</span>
              </button>

              <button
                onClick={() => setIsSpeakerMuted(!isSpeakerMuted)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl border text-xs font-medium transition ${
                  isSpeakerMuted
                    ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                {isSpeakerMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span>{isSpeakerMuted ? 'Sam Muted' : 'Mute Speaker'}</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Footer Info & Instructions */}
      <footer className="w-full max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between text-xs text-neutral-500 border-t border-neutral-900 pt-4 z-10">
        <div>
          <span>Target Backend: </span>
          <code className="text-neutral-400 font-mono bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
            {config.wsUrl}
          </code>
        </div>
        <div className="mt-2 md:mt-0">
          <span>Browser Context: </span>
          <span className="text-neutral-400">Echo Cancellation & Noise Suppression Active</span>
        </div>
      </footer>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSaveConfig={handleSaveConfig}
      />
    </main>
  );
}

// Wrap in a dynamic-no-SSR boundary to prevent all hydration mismatches
export default function MoshiVoiceClient() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // SSR placeholder - matches basic structure without dynamic content
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Radio className="w-10 h-10 text-indigo-400 animate-pulse" />
          <p className="text-neutral-400 text-sm">Loading Sam Voice Client...</p>
        </div>
      </main>
    );
  }

  return <MoshiVoiceClientInner />;
}
