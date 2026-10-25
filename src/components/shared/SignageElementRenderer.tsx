// ============================================================================
// src/components/shared/SignageElementRenderer.tsx
// Hybrid Renderer (DOM/CSS + SVG Vector + Canvas 2D + HTML5 Media)
// Shared between Studio Canvas Preview, Standalone Player & Sync Wall Simulator
// (Architectural Rule 6)
// ============================================================================

import React, { useEffect, useMemo, useRef } from 'react';
import { AssetItem } from '@packages/project-model';
import { ComputedElementState } from '@packages/animation-engine';
import { sha256Bytes } from '@packages/shared';

interface Props {
  element: ComputedElementState;
  assets: AssetItem[];
  currentTimeMs: number;
  deviceName?: string;
  sceneName?: string;
  interactive?: boolean;
  onDoubleClickText?: (elementId: string) => void;
}

function interpolatePlaceholders(
  raw: string,
  now: Date,
  deviceName = 'Lobby Display #01',
  sceneName = 'Active Scene'
): string {
  return raw
    .replace(/\{\{\s*time\s*\}\}/gi, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))
    .replace(/\{\{\s*deviceName\s*\}\}/gi, deviceName)
    .replace(/\{\{\s*sceneName\s*\}\}/gi, sceneName);
}

// Deterministic 15x15 QR-like matrix from payload hash
function buildQrMatrix(payload: string): boolean[][] {
  const hash = sha256Bytes(payload || 'https://digital-signage.local');
  const size = 15;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const border = r === 0 || r === 4 || c === 0 || c === 4;
        const center = r === 2 && c === 2;
        grid[r0 + r][c0 + c] = border || center;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 5);
  drawFinder(size - 5, 0);

  let bitIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inFinder =
        (r < 6 && c < 6) ||
        (r < 6 && c >= size - 6) ||
        (r >= size - 6 && c < 6);
      if (inFinder) continue;
      const byte = hash[Math.floor(bitIdx / 8) % hash.length];
      const bit = (byte >> (bitIdx % 8)) & 1;
      grid[r][c] = bit === 1;
      bitIdx++;
    }
  }
  return grid;
}

export const SignageElementRenderer: React.FC<Props> = ({
  element,
  assets,
  currentTimeMs,
  deviceName,
  sceneName,
  onDoubleClickText,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nowDate = useMemo(() => new Date(Date.now() + (currentTimeMs % 1000)), [Math.floor(currentTimeMs / 500)]);

  // Canvas 2D effect for custom widget or synthetic video visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const phase = currentTimeMs / 400;
    for (let x = 0; x <= w; x += 8) {
      const y = h / 2 + Math.sin(x * 0.025 + phase) * (h * 0.25);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [currentTimeMs, element.type, element.widgetProps?.widgetKind]);

  if (!element.visible) return null;

  const filterStr = element.filters
    ? `brightness(${element.filters.brightness ?? 100}%) contrast(${element.filters.contrast ?? 100}%) blur(${element.filters.blur ?? 0}px) grayscale(${element.filters.grayscale ?? 0}%)`
    : undefined;

  const shadowStr =
    element.shadow && element.shadow.enabled
      ? `${element.shadow.offsetX}px ${element.shadow.offsetY}px ${element.shadow.blur}px ${element.shadow.color}`
      : undefined;

  const clipPathStr =
    typeof element.cropProgress === 'number'
      ? `inset(0 ${(1 - element.cropProgress) * 100}% 0 0)`
      : undefined;

  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    transform: `rotate(${element.rotation || 0}deg) scale(${element.scaleX ?? 1}, ${element.scaleY ?? 1})`,
    transformOrigin: 'center center',
    opacity: element.opacity ?? 1,
    zIndex: element.zIndex ?? 1,
    backgroundColor: element.backgroundColor,
    border:
      element.border && element.border.width > 0
        ? `${element.border.width}px ${element.border.style || 'solid'} ${element.border.color}`
        : undefined,
    borderRadius: element.border?.radius ? `${element.border.radius}px` : undefined,
    boxShadow: shadowStr,
    filter: filterStr,
    clipPath: clipPathStr,
    overflow: 'hidden',
    boxSizing: 'border-box',
    userSelect: 'none',
  };

  // 1. TEXT ELEMENT (DOM / CSS Renderer)
  if (element.type === 'text' && element.textProps) {
    const tp = element.textProps;
    const interpolated = interpolatePlaceholders(tp.text, nowDate, deviceName, sceneName);
    const visibleText =
      typeof element.textRevealRatio === 'number'
        ? interpolated.slice(0, Math.ceil(interpolated.length * element.textRevealRatio))
        : interpolated;

    return (
      <div
        style={{
          ...wrapperStyle,
          display: 'flex',
          alignItems:
            tp.verticalAlign === 'top'
              ? 'flex-start'
              : tp.verticalAlign === 'bottom'
                ? 'flex-end'
                : 'center',
          justifyContent:
            tp.textAlign === 'center'
              ? 'center'
              : tp.textAlign === 'right'
                ? 'flex-end'
                : 'flex-start',
          padding: '6px 10px',
          direction: tp.direction || 'ltr',
        }}
        onDoubleClick={() => onDoubleClickText?.(element.id)}
      >
        <div
          style={{
            width: '100%',
            fontFamily: tp.fontFamily,
            fontSize: `${tp.fontSize}px`,
            fontWeight: tp.fontWeight,
            fontStyle: tp.fontStyle || 'normal',
            color: tp.color,
            textAlign: tp.textAlign,
            letterSpacing: `${tp.letterSpacing || 0}px`,
            lineHeight: tp.lineHeight || 1.2,
            whiteSpace: tp.wrap ? 'pre-wrap' : 'nowrap',
            WebkitTextStroke:
              tp.outlineWidth && tp.outlineWidth > 0
                ? `${tp.outlineWidth}px ${tp.outlineColor || '#000'}`
                : undefined,
            transform: tp.scrolling
              ? `translateX(${-((currentTimeMs * ((tp.scrollSpeed || 80) / 1000)) % (element.width + 400))}px)`
              : undefined,
          }}
        >
          {visibleText}
        </div>
      </div>
    );
  }

  // 2. SHAPE ELEMENT (SVG Vector Graphics Renderer)
  if (element.type === 'shape' && element.shapeProps) {
    const sp = element.shapeProps;
    const gradId = `grad-${element.id}`;

    return (
      <div style={wrapperStyle}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${element.width} ${element.height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={sp.fillColor || '#0284c7'} />
              <stop offset="100%" stopColor={sp.strokeColor || '#1e293b'} />
            </linearGradient>
          </defs>
          {sp.shapeKind === 'circle' || sp.shapeKind === 'ellipse' ? (
            <ellipse
              cx={element.width / 2}
              cy={element.height / 2}
              rx={Math.max(2, element.width / 2 - sp.strokeWidth)}
              ry={Math.max(2, element.height / 2 - sp.strokeWidth)}
              fill={sp.fillColor}
              stroke={sp.strokeColor}
              strokeWidth={sp.strokeWidth}
            />
          ) : sp.shapeKind === 'line' ? (
            <line
              x1={0}
              y1={element.height / 2}
              x2={element.width}
              y2={element.height / 2}
              stroke={sp.strokeColor || sp.fillColor}
              strokeWidth={Math.max(4, sp.strokeWidth)}
            />
          ) : sp.shapeKind === 'polygon' || sp.shapeKind === 'diamond' ? (
            <polygon
              points={`${element.width / 2},4 ${element.width - 4},${element.height / 2} ${element.width / 2},${element.height - 4} 4,${element.height / 2}`}
              fill={sp.fillColor}
              stroke={sp.strokeColor}
              strokeWidth={sp.strokeWidth}
            />
          ) : (
            <rect
              x={0}
              y={0}
              width={element.width}
              height={element.height}
              rx={element.border?.radius ?? (sp.shapeKind === 'roundedRect' ? 20 : 0)}
              fill={sp.fillColor}
              stroke={sp.strokeColor}
              strokeWidth={sp.strokeWidth}
            />
          )}
        </svg>
      </div>
    );
  }

  // 3. IMAGE ELEMENT
  if (element.type === 'image' && element.mediaProps) {
    const asset = assets.find((a) => a.id === element.mediaProps?.assetId);
    const maskRadius =
      element.mediaProps.maskShape === 'circle'
        ? '50%'
        : element.mediaProps.maskShape === 'rounded'
          ? '24px'
          : undefined;

    if (!asset || asset.missing) {
      return (
        <div
          style={{
            ...wrapperStyle,
            backgroundColor: '#1e1b4b',
            border: '2px dashed #f43f5e',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fda4af',
            fontSize: '18px',
            fontFamily: 'sans-serif',
          }}
        >
          <strong>MISSING ASSET</strong>
          <span style={{ fontSize: '14px', opacity: 0.8 }}>{element.mediaProps.assetId}</span>
        </div>
      );
    }

    return (
      <div style={{ ...wrapperStyle, borderRadius: maskRadius ?? wrapperStyle.borderRadius }}>
        <img
          src={asset.optimizedDataUrl || asset.dataUrl}
          alt={element.mediaProps.altText || asset.name}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: element.mediaProps.objectFit || 'cover',
            display: 'block',
          }}
        />
      </div>
    );
  }

  // 4. VIDEO / AUDIO ELEMENT
  if (element.type === 'video' || element.type === 'audio') {
    const asset = assets.find((a) => a.id === element.mediaProps?.assetId);
    const isRealVideo = asset && asset.mimeType.startsWith('video/') && asset.dataUrl.startsWith('data:video');

    return (
      <div style={wrapperStyle}>
        {isRealVideo ? (
          <video
            src={asset.dataUrl}
            muted={element.mediaProps?.muted ?? true}
            loop={element.mediaProps?.loop ?? true}
            autoPlay
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: element.mediaProps?.objectFit || 'cover',
            }}
          />
        ) : (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <canvas
              ref={canvasRef}
              width={Math.max(200, Math.min(800, element.width))}
              height={Math.max(120, Math.min(450, element.height))}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#e2e8f0',
                fontFamily: 'Inter, sans-serif',
                background: 'rgba(15,23,42,0.35)',
              }}
            >
              <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '1px' }}>
                {element.type === 'video' ? 'SYNCHRONIZED VIDEO STREAM' : 'AUDIO TRACK'}
              </div>
              <div style={{ fontSize: '14px', color: '#38bdf8', marginTop: '4px' }}>
                {element.name} • {(currentTimeMs / 1000).toFixed(1)}s
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 5. WIDGET ELEMENTS (Clock, Date, Countdown, QR Code, Ticker, DataFeed, Weather)
  if (element.type === 'widget' && element.widgetProps) {
    const wp = element.widgetProps;
    const accent = wp.accentColor || '#38bdf8';

    if (wp.widgetKind === 'clock' || wp.widgetKind === 'date') {
      const timeStr = nowDate.toLocaleTimeString('en-US', {
        hour12: wp.timeFormat !== '24h',
        hour: '2-digit',
        minute: '2-digit',
        second: wp.showSeconds !== false ? '2-digit' : undefined,
      });
      const dateStr = nowDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.88)',
            border: `1px solid ${accent}44`,
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
            padding: '10px 18px',
          }}
        >
          <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '1.5px', color: accent }}>
            {timeStr}
          </div>
          <div style={{ fontSize: '15px', color: '#94a3b8', marginTop: '2px', fontWeight: 600 }}>
            {dateStr.toUpperCase()}
          </div>
        </div>
      );
    }

    if (wp.widgetKind === 'countdown') {
      const targetMs = wp.countdownTargetIso ? Date.parse(wp.countdownTargetIso) : Date.now() + 7200_000;
      const diffSec = Math.max(0, Math.floor((targetMs - nowDate.getTime()) / 1000));
      const hrs = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(24, 16, 12, 0.9)',
            border: `2px solid ${accent}`,
            borderRadius: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#fff',
            padding: '16px',
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 700, color: accent, letterSpacing: '1.5px' }}>
            {wp.countdownLabel || 'EVENT STARTS IN'}
          </div>
          <div style={{ fontSize: '52px', fontWeight: 800, marginTop: '8px', fontVariantNumeric: 'tabular-nums' }}>
            {hrs.toString().padStart(2, '0')} : {mins.toString().padStart(2, '0')} : {secs.toString().padStart(2, '0')}
          </div>
        </div>
      );
    }

    if (wp.widgetKind === 'qrcode') {
      const matrix = buildQrMatrix(wp.qrPayload || 'https://apex.example');
      const dim = matrix.length;
      return (
        <div
          style={{
            ...wrapperStyle,
            background: wp.qrBackground || '#f8fafc',
            borderRadius: '18px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg viewBox={`0 0 ${dim} ${dim}`} width="82%" height="82%">
            {matrix.map((row, rIdx) =>
              row.map((cell, cIdx) =>
                cell ? (
                  <rect
                    key={`${rIdx}-${cIdx}`}
                    x={cIdx}
                    y={rIdx}
                    width={1}
                    height={1}
                    fill={wp.qrForeground || '#0f172a'}
                  />
                ) : null
              )
            )}
          </svg>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#0f172a',
              marginTop: '6px',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            SCAN FOR PASS
          </div>
        </div>
      );
    }

    if (wp.widgetKind === 'ticker') {
      const items = wp.tickerItems?.length
        ? wp.tickerItems
        : ['LIVE SIGNAGE BROADCAST ACTIVE'];
      const joined = items.join('   •   ');
      const offsetPx = ((currentTimeMs * ((wp.tickerSpeedPxPerSec || 90) / 1000)) % 1400);

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)',
            border: `1px solid ${accent}66`,
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            fontFamily: 'Inter, system-ui, sans-serif',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: accent,
              color: '#090d16',
              fontWeight: 800,
              fontSize: '16px',
              padding: '0 20px',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              zIndex: 2,
              flexShrink: 0,
              letterSpacing: '1px',
            }}
          >
            LIVE BULLETIN
          </div>
          <div
            style={{
              whiteSpace: 'nowrap',
              color: '#f8fafc',
              fontSize: '21px',
              fontWeight: 600,
              paddingLeft: '24px',
              transform: `translateX(${-offsetPx}px)`,
            }}
          >
            {joined}   •   {joined}
          </div>
        </div>
      );
    }

    if (wp.widgetKind === 'datafeed') {
      const rows = wp.dataFeedRows ?? [];
      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid #334155',
            borderRadius: '20px',
            padding: '22px 26px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              fontSize: '17px',
              fontWeight: 800,
              color: accent,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              borderBottom: '1px solid #334155',
              paddingBottom: '10px',
            }}
          >
            {element.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px', flex: 1, justifyContent: 'space-around' }}>
            {rows.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background:
                    r.status === 'highlight'
                      ? `${accent}22`
                      : 'rgba(30, 41, 59, 0.65)',
                  borderLeft: r.status === 'highlight' ? `4px solid ${accent}` : '4px solid transparent',
                }}
              >
                <span style={{ color: '#cbd5e1', fontSize: '18px', fontWeight: 500 }}>{r.label}</span>
                <span style={{ color: '#f8fafc', fontSize: '19px', fontWeight: 700 }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (wp.widgetKind === 'weather') {
      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,58,138,0.85))',
            border: '1px solid #38bdf855',
            borderRadius: '20px',
            padding: '22px 26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div>
            <div style={{ fontSize: '15px', color: '#38bdf8', fontWeight: 700, letterSpacing: '1px' }}>
              LOCAL WEATHER
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px' }}>
              {wp.weatherLocation || 'Pittsburgh, PA'}
            </div>
            <div style={{ fontSize: '16px', color: '#94a3b8', marginTop: '4px' }}>
              {wp.weatherCondition || 'Partly Cloudy'} • Humidity 54%
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '54px', fontWeight: 800, color: '#38bdf8' }}>
              {wp.weatherTempC ?? 19}°C
            </div>
            <div style={{ fontSize: '14px', color: '#cbd5e1' }}>
              {Math.round(((wp.weatherTempC ?? 19) * 9) / 5 + 32)}°F
            </div>
          </div>
        </div>
      );
    }
  }

  // 6. GROUP OR CUSTOM ELEMENT
  return (
    <div
      style={{
        ...wrapperStyle,
        border: element.border ? wrapperStyle.border : '1px dashed #38bdf888',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        fontSize: '14px',
        fontFamily: 'sans-serif',
      }}
    >
      {element.type === 'group' ? null : element.name}
    </div>
  );
};
