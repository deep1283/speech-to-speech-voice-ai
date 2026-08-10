'use client';

import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  micAnalyser: AnalyserNode | null;
  speakerAnalyser: AnalyserNode | null;
  isMicActive: boolean;
  isAISpeaking: boolean;
  width?: number;
  height?: number;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  micAnalyser,
  speakerAnalyser,
  isMicActive,
  isAISpeaking,
  width = 600,
  height = 200,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const micDataArray = new Uint8Array(128);
    const speakerDataArray = new Uint8Array(128);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw background ambient glow
      const centerX = width / 2;
      const centerY = height / 2;

      if (isAISpeaking) {
        const pulse = Math.sin(Date.now() * 0.005) * 15 + 60;
        const grad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, pulse + 80);
        grad.addColorStop(0, 'rgba(168, 85, 247, 0.25)'); // Violet
        grad.addColorStop(0.5, 'rgba(236, 72, 153, 0.1)'); // Pink
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      } else if (isMicActive) {
        const pulse = Math.sin(Date.now() * 0.006) * 10 + 50;
        const grad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, pulse + 60);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.2)'); // Cyan
        grad.addColorStop(0.5, 'rgba(59, 130, 246, 0.08)'); // Blue
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // Render Speaker (AI Output) Wave in Foreground
      if (speakerAnalyser && isAISpeaking) {
        speakerAnalyser.getByteTimeDomainData(speakerDataArray);
        drawWave(ctx, speakerDataArray, width, height, '#c084fc', '#f472b6', 3.5);
      }

      // Render Mic Wave
      if (micAnalyser && isMicActive) {
        micAnalyser.getByteTimeDomainData(micDataArray);
        drawWave(ctx, micDataArray, width, height, '#38bdf8', '#818cf8', 2.5);
      }

      // Fallback ambient static sine wave when idle
      if (!isMicActive && !isAISpeaking) {
        drawIdleWave(ctx, width, height);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [micAnalyser, speakerAnalyser, isMicActive, isAISpeaking, width, height]);

  return (
    <div className="relative flex items-center justify-center w-full max-w-2xl h-48 rounded-2xl bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/80 shadow-2xl overflow-hidden">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-full object-cover"
      />
    </div>
  );
};

function drawWave(
  ctx: CanvasRenderingContext2D,
  dataArray: Uint8Array,
  width: number,
  height: number,
  colorStart: string,
  colorEnd: string,
  lineWidth: number
) {
  ctx.save();
  ctx.lineWidth = lineWidth;
  
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, colorStart);
  gradient.addColorStop(1, colorEnd);
  ctx.strokeStyle = gradient;
  ctx.shadowColor = colorStart;
  ctx.shadowBlur = 12;

  ctx.beginPath();
  const sliceWidth = width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * height) / 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.restore();
}

function drawIdleWave(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(115, 115, 115, 0.3)';
  ctx.beginPath();

  const time = Date.now() * 0.002;
  const centerY = height / 2;

  for (let x = 0; x < width; x += 4) {
    const y = centerY + Math.sin(x * 0.015 + time) * 6;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.restore();
}
