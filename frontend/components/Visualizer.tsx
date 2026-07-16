import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  bars: number[];
  isActive: boolean;
  isListening: boolean;
}

const FRAME_EASE = 0.18;
const MIN_BAR_WIDTH = 2;
const MIN_BAR_GAP = 2;
const WAVEFORM_WIDTH_RATIO = 0.82;

function drawRoundedBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
  context.fill();
}

const Visualizer: React.FC<VisualizerProps> = ({ bars, isActive, isListening }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetBarsRef = useRef<number[]>(bars);
  const displayBarsRef = useRef<number[]>(bars.map(() => 0));

  useEffect(() => {
    targetBarsRef.current = bars;
    if (displayBarsRef.current.length !== bars.length) {
      displayBarsRef.current = bars.map(() => 0);
    }
  }, [bars]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let animationFrame: number | null = null;
    let canvasWidth = 0;
    let canvasHeight = 0;

    const resizeCanvas = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.max(1, Math.floor(bounds.width * pixelRatio));
      const nextHeight = Math.max(1, Math.floor(bounds.height * pixelRatio));

      if (canvas.width === nextWidth && canvas.height === nextHeight) return;

      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvasWidth = bounds.width;
      canvasHeight = bounds.height;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = () => {
      resizeCanvas();
      if (!canvasWidth || !canvasHeight) return;

      context.clearRect(0, 0, canvasWidth, canvasHeight);

      const targetBars = isListening ? targetBarsRef.current : [];
      const displayBars = displayBarsRef.current;
      for (let index = 0; index < displayBars.length; index++) {
        const target = targetBars[index] ?? 0;
        displayBars[index] += (target - displayBars[index]) * FRAME_EASE;
      }

      if (isListening && displayBars.length > 0) {
        const barGap = Math.max(MIN_BAR_GAP, Math.min(5, canvasWidth / 180));
        const waveformWidth = canvasWidth * WAVEFORM_WIDTH_RATIO;
        const maxVisibleBars = Math.max(
          1,
          Math.floor((waveformWidth + barGap) / (MIN_BAR_WIDTH + barGap)),
        );
        const visibleBarCount = Math.min(displayBars.length, maxVisibleBars);
        const barWidth = Math.max(
          MIN_BAR_WIDTH,
          (waveformWidth - barGap * (visibleBarCount - 1)) / visibleBarCount,
        );
        const totalWidth = visibleBarCount * barWidth + (visibleBarCount - 1) * barGap;
        const startX = (canvasWidth - totalWidth) / 2;
        const centerY = canvasHeight / 2;
        const maxHeight = Math.min(38, canvasHeight * 0.82);

        context.fillStyle = isActive ? 'rgb(83, 214, 146)' : 'rgb(145, 113, 245)';
        context.globalAlpha = isActive ? 0.9 : 0.68;

        for (let index = 0; index < visibleBarCount; index++) {
          const sourceIndex = Math.min(
            displayBars.length - 1,
            Math.floor((index * displayBars.length) / visibleBarCount),
          );
          const value = displayBars[sourceIndex];
          const height = Math.max(3, Math.min(maxHeight, value * maxHeight));
          const x = startX + index * (barWidth + barGap);
          drawRoundedBar(context, x, centerY - height / 2, barWidth, height, barWidth / 2);
        }
        context.globalAlpha = 1;
      }

      if (isListening) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(canvas);
    draw();

    return () => {
      resizeObserver.disconnect();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [isActive, isListening]);

  return (
    <div className={`audio-waveform${isListening ? ' audio-waveform--listening' : ''}`}>
      <canvas
        ref={canvasRef}
        className="audio-waveform__canvas"
        role="img"
        aria-label={isListening ? 'Live microphone input level' : 'Microphone input is off'}
      />
    </div>
  );
};

export default Visualizer;
