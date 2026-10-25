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
import { buildRichQrMatrix, formatQrWidgetPayload } from '@/utils/qrCodeGenerator';

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
      const formattedPayload = formatQrWidgetPayload(wp);
      const ecLevel = wp.qrErrorCorrection || 'M';
      const matrix = buildRichQrMatrix(formattedPayload, ecLevel);
      const dim = matrix.length;
      const quietZone = Math.max(0, Math.min(6, wp.qrQuietZone ?? 1));
      const totalView = dim + quietZone * 2;
      const fgColor = wp.qrForeground || '#0f172a';
      const bgColor = wp.qrBackground || '#f8fafc';
      const eyeColor = wp.qrEyeColor || fgColor;
      const dotStyle = wp.qrDotStyle || 'square';
      const logoEnabled = Boolean(wp.qrLogoEnabled);
      const logoSizePct = Math.max(12, Math.min(34, wp.qrLogoSizePercent ?? 22));
      const logoAsset = wp.qrLogoAssetId
        ? assets.find((a) => a.id === wp.qrLogoAssetId)
        : undefined;
      const logoImgSrc = logoAsset?.dataUrl || wp.qrLogoUrl || '';
      const labelText =
        wp.qrLabelText !== undefined
          ? wp.qrLabelText
          : wp.qrContentType === 'wifi'
            ? `WI-FI: ${wp.qrWifiSsid || 'Guest-WiFi'}`
            : wp.qrContentType === 'contact'
              ? `VCARD: ${wp.qrContactName || 'Contact'}`
              : 'SCAN FOR PASS';

      return (
        <div
          style={{
            ...wrapperStyle,
            background: bgColor,
            borderRadius: '18px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: labelText ? '82%' : '92%',
              height: labelText ? '82%' : '92%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              viewBox={`0 0 ${totalView} ${totalView}`}
              width="100%"
              height="100%"
              style={{ shapeRendering: dotStyle === 'square' ? 'crispEdges' : 'geometricPrecision' }}
            >
              <rect x={0} y={0} width={totalView} height={totalView} fill={bgColor} />
              {matrix.map((row, rIdx) =>
                row.map((cell, cIdx) => {
                  if (!cell.dark) return null;
                  const x = cIdx + quietZone;
                  const y = rIdx + quietZone;
                  const fill = cell.isFinder ? eyeColor : fgColor;

                  if (dotStyle === 'dots' && !cell.isFinder) {
                    return (
                      <circle
                        key={`${rIdx}-${cIdx}`}
                        cx={x + 0.5}
                        cy={y + 0.5}
                        r={0.44}
                        fill={fill}
                      />
                    );
                  }
                  if (dotStyle === 'rounded' && !cell.isFinder) {
                    return (
                      <rect
                        key={`${rIdx}-${cIdx}`}
                        x={x + 0.04}
                        y={y + 0.04}
                        width={0.92}
                        height={0.92}
                        rx={0.28}
                        fill={fill}
                      />
                    );
                  }
                  return (
                    <rect
                      key={`${rIdx}-${cIdx}`}
                      x={x}
                      y={y}
                      width={1}
                      height={1}
                      fill={fill}
                    />
                  );
                })
              )}
            </svg>

            {/* Optional Center Logo Overlay */}
            {logoEnabled && (
              <div
                style={{
                  position: 'absolute',
                  width: `${logoSizePct}%`,
                  height: `${logoSizePct}%`,
                  background: bgColor,
                  border: `2px solid ${eyeColor}`,
                  borderRadius: '22%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
                  padding: '2px',
                }}
              >
                {logoImgSrc ? (
                  <img
                    src={logoImgSrc}
                    alt="QR Center Logo"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      color: eyeColor,
                      fontFamily: 'Inter, sans-serif',
                      textAlign: 'center',
                      lineHeight: 1,
                    }}
                  >
                    {wp.qrLogoText || 'LOGO'}
                  </span>
                )}
              </div>
            )}
          </div>

          {labelText && (
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: fgColor,
                marginTop: '6px',
                fontFamily: 'Inter, sans-serif',
                textAlign: 'center',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {labelText}
            </div>
          )}
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

    // KPI METRIC & SPARKLINE CARD
    if (wp.widgetKind === 'kpi') {
      const points =
        wp.kpiSparklinePoints && wp.kpiSparklinePoints.length >= 2
          ? wp.kpiSparklinePoints
          : [28, 42, 36, 58, 52, 76, 94];
      const maxPt = Math.max(...points, 1);
      const minPt = Math.min(...points, 0);
      const span = Math.max(1, maxPt - minPt);
      const svgCoords = points
        .map((v, i) => {
          const x = (i / (points.length - 1)) * 180;
          const y = 52 - ((v - minPt) / span) * 44;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      const trendColor =
        wp.kpiTrend === 'down' ? '#f43f5e' : wp.kpiTrend === 'neutral' ? '#94a3b8' : '#10b981';
      const trendArrow = wp.kpiTrend === 'down' ? '▼' : wp.kpiTrend === 'neutral' ? '●' : '▲';

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1px solid ${accent}55`,
            borderRadius: '18px',
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', letterSpacing: '1.2px' }}>
              {(wp.kpiTitle || 'LIVE CAMPUS METRIC').toUpperCase()}
            </span>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 700,
                background: `${trendColor}22`,
                color: trendColor,
              }}
            >
              {trendArrow} {wp.kpiDelta || '+18.4%'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '6px 0' }}>
            <span style={{ fontSize: '44px', fontWeight: 800, color: '#f8fafc' }}>
              {wp.kpiValue || '14,820'}
            </span>
            <span style={{ fontSize: '16px', color: accent, fontWeight: 600 }}>
              {wp.kpiUnit || 'visitors'}
            </span>
          </div>
          <svg viewBox="0 0 180 56" style={{ width: '100%', height: '54px', overflow: 'visible' }}>
            <polyline
              fill="none"
              stroke={accent}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={svgCoords}
            />
          </svg>
        </div>
      );
    }

    // BAR / LINE / DONUT CHART WIDGET
    if (wp.widgetKind === 'chart') {
      const rows =
        wp.dataFeedRows && wp.dataFeedRows.length > 0
          ? wp.dataFeedRows
          : [
              { label: '08:00', value: '45' },
              { label: '10:00', value: '78' },
              { label: '12:00', value: '94' },
              { label: '14:00', value: '66' },
              { label: '16:00', value: '85' },
            ];
      const numericVals = rows.map((r) => {
        const parsed = Number.parseFloat(String(r.value).replace(/[^0-9.-]/g, ''));
        return Number.isNaN(parsed) ? 50 : Math.max(0, parsed);
      });
      const maxVal = Math.max(...numericVals, 1);
      const chartStyle = wp.chartType || 'bar';

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1px solid ${accent}44`,
            borderRadius: '18px',
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: accent, letterSpacing: '1.2px' }}>
            {(wp.chartTitle || 'LIVE TELEMETRY & ANALYTICS CHART').toUpperCase()}
          </div>
          {chartStyle === 'horizontal-bar' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, justifyContent: 'center', marginTop: '10px' }}>
              {rows.map((r, i) => {
                const pct = Math.round((numericVals[i] / maxVal) * 100);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '74px', fontSize: '13px', color: '#cbd5e1', fontWeight: 600 }}>
                      {r.label}
                    </span>
                    <div style={{ flex: 1, height: '14px', background: '#1e293b', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: accent, borderRadius: '999px' }} />
                    </div>
                    {wp.chartShowValues !== false && (
                      <span style={{ width: '44px', textAlign: 'right', fontSize: '13px', fontWeight: 700 }}>
                        {r.value}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-around',
                gap: '12px',
                flex: 1,
                marginTop: '14px',
                paddingTop: '12px',
                borderBottom: '1px solid #334155',
              }}
            >
              {rows.map((r, i) => {
                const pct = Math.max(8, Math.round((numericVals[i] / maxVal) * 100));
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '6px',
                    }}
                  >
                    {wp.chartShowValues !== false && (
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#e2e8f0' }}>
                        {r.value}
                      </span>
                    )}
                    <div
                      style={{
                        width: '72%',
                        height: `${pct}%`,
                        background: `linear-gradient(180deg, ${accent}, ${accent}66)`,
                        borderRadius: '6px 6px 0 0',
                      }}
                    />
                    <span style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                      {r.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // WAYFINDING & DIRECTIONAL SIGN WIDGET
    if (wp.widgetKind === 'wayfinding') {
      const dirMap: Record<string, string> = {
        up: '↑',
        'up-right': '↗',
        right: '→',
        'down-right': '↘',
        down: '↓',
        left: '←',
        'up-left': '↖',
        elevator: '🛗',
        accessible: '♿',
      };
      const arrowGlyph = dirMap[wp.wayfindingDirection || 'up-right'] || '↗';

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.94)',
            border: `2px solid ${accent}`,
            borderRadius: '18px',
            padding: '18px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '22px',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div
            style={{
              width: '76px',
              height: '76px',
              borderRadius: '16px',
              background: accent,
              color: '#0f172a',
              fontSize: '46px',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {arrowGlyph}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '0.5px' }}>
              {wp.wayfindingDestination || 'GRAND KEYNOTE AUDITORIUM'}
            </div>
            <div style={{ fontSize: '16px', color: '#cbd5e1', marginTop: '4px' }}>
              {wp.wayfindingSubtext || 'Level 3 • East Concourse'} •{' '}
              <strong style={{ color: accent }}>{wp.wayfindingDistance || '120m (2 min)'}</strong>
            </div>
          </div>
          {wp.wayfindingStatus && (
            <span
              style={{
                padding: '6px 14px',
                borderRadius: '999px',
                background: `${accent}22`,
                border: `1px solid ${accent}`,
                color: accent,
                fontSize: '13px',
                fontWeight: 800,
                letterSpacing: '1px',
              }}
            >
              {wp.wayfindingStatus}
            </span>
          )}
        </div>
      );
    }

    // QUEUE / NOW SERVING TICKET WIDGET
    if (wp.widgetKind === 'queue') {
      const waiting =
        wp.queueWaitingTickets && wp.queueWaitingTickets.length > 0
          ? wp.queueWaitingTickets
          : ['A-205', 'A-206', 'B-104', 'C-019'];

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.94)',
            border: `2px solid ${accent}`,
            borderRadius: '18px',
            padding: '18px 22px',
            display: 'flex',
            gap: '20px',
            alignItems: 'stretch',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div
            style={{
              flex: 1,
              background: `${accent}18`,
              border: `1px solid ${accent}66`,
              borderRadius: '14px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 800, color: accent, letterSpacing: '1.5px' }}>
              {(wp.queueTitle || 'NOW SERVING').toUpperCase()}
            </div>
            <div style={{ fontSize: '48px', fontWeight: 900, margin: '6px 0' }}>
              {wp.queueCurrentTicket || 'A-204'}
            </div>
            <div
              style={{
                padding: '4px 12px',
                borderRadius: '8px',
                background: accent,
                color: '#0f172a',
                fontSize: '14px',
                fontWeight: 800,
              }}
            >
              {wp.queueCounterLabel || 'DESK 03'}
            </div>
          </div>
          <div style={{ width: '42%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, letterSpacing: '1px' }}>
              UP NEXT IN QUEUE
            </div>
            {waiting.slice(0, 4).map((ticket, i) => (
              <div
                key={i}
                style={{
                  padding: '6px 10px',
                  borderRadius: '8px',
                  background: '#1e293b',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '15px',
                  fontWeight: 700,
                }}
              >
                <span>{ticket}</span>
                <span style={{ color: '#94a3b8', fontSize: '12px' }}>Wait #{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // PROGRESS / CAPACITY GAUGE WIDGET
    if (wp.widgetKind === 'progress') {
      const val = wp.progressValue ?? 76;
      const max = Math.max(1, wp.progressMax ?? 100);
      const pct = Math.max(0, Math.min(100, Math.round((val / max) * 100)));
      const radius = 38;
      const circum = 2 * Math.PI * radius;
      const dashOffset = circum - (pct / 100) * circum;

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1px solid ${accent}55`,
            borderRadius: '18px',
            padding: '18px 22px',
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          {wp.progressStyle !== 'linear' && (
            <svg width="96" height="96" viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
              <circle cx="48" cy="48" r={radius} stroke="#1e293b" strokeWidth="9" fill="none" />
              <circle
                cx="48"
                cy="48"
                r={radius}
                stroke={accent}
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circum}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 48 48)"
              />
              <text
                x="48"
                y="53"
                textAnchor="middle"
                fill="#f8fafc"
                fontSize="19"
                fontWeight="800"
              >
                {pct}%
              </text>
            </svg>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: accent, letterSpacing: '1.2px' }}>
              {(wp.progressTitle || 'LIVE OCCUPANCY & CAPACITY').toUpperCase()}
            </div>
            <div style={{ fontSize: '30px', fontWeight: 800, marginTop: '4px' }}>
              {val} <span style={{ fontSize: '16px', color: '#94a3b8' }}>/ {max} {wp.progressUnit || '%'}</span>
            </div>
            {wp.progressStyle === 'linear' && (
              <div style={{ height: '12px', background: '#1e293b', borderRadius: '999px', overflow: 'hidden', marginTop: '8px' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: accent }} />
              </div>
            )}
            <div style={{ fontSize: '14px', color: '#cbd5e1', marginTop: '6px' }}>
              {wp.progressSubtitle || 'Operating within normal threshold'}
            </div>
          </div>
        </div>
      );
    }

    // SOCIAL WALL / SPOTLIGHT POST WIDGET
    if (wp.widgetKind === 'social') {
      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1px solid ${accent}55`,
            borderRadius: '18px',
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: accent,
                  color: '#0f172a',
                  fontWeight: 900,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {(wp.socialAuthor || 'A')[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700 }}>
                  {wp.socialAuthor || 'Apex Innovation Summit'} ✓
                </div>
                <div style={{ fontSize: '13px', color: accent }}>
                  {wp.socialHandle || '@ApexGlobalHQ'}
                </div>
              </div>
            </div>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {wp.socialTimestamp || 'Just now'}
            </span>
          </div>
          <div style={{ fontSize: '18px', lineHeight: 1.4, color: '#e2e8f0', margin: '10px 0' }}>
            “{wp.socialPostText || 'Welcome to the 2026 Digital Signage & Synchronized Display Keynote! Tag #Apex2026 to be featured live.'}”
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#94a3b8' }}>
            <span>♥ {wp.socialLikes || '1.4K'} Likes</span>
            <span style={{ color: accent, fontWeight: 700 }}>
              {(wp.socialPlatform || 'announcement').toUpperCase()}
            </span>
          </div>
        </div>
      );
    }

    // CALENDAR / ROOM BOOKING SCHEDULE WIDGET
    if (wp.widgetKind === 'calendar') {
      const status = wp.calendarRoomStatus || 'available';
      const statusColor =
        status === 'occupied' ? '#f43f5e' : status === 'upcoming' ? '#f59e0b' : '#10b981';
      const statusLabel =
        status === 'occupied' ? 'IN SESSION' : status === 'upcoming' ? 'STARTING SOON' : 'AVAILABLE';

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(15, 23, 42, 0.94)',
            borderLeft: `8px solid ${statusColor}`,
            borderRadius: '16px',
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '1px', color: '#cbd5e1' }}>
              {wp.calendarRoomName || 'BOARDROOM 4B — SKYLINE SUITE'}
            </span>
            <span
              style={{
                padding: '4px 12px',
                borderRadius: '999px',
                background: `${statusColor}25`,
                color: statusColor,
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              ● {statusLabel}
            </span>
          </div>
          <div style={{ margin: '8px 0' }}>
            <div style={{ fontSize: '26px', fontWeight: 800 }}>
              {wp.calendarCurrentEvent || 'Q4 Product Architecture Review'}
            </div>
            <div style={{ fontSize: '15px', color: '#94a3b8', marginTop: '4px' }}>
              {wp.calendarOrganizer || '10:00 AM – 11:30 AM • Hosted by Executive Engineering'}
            </div>
          </div>
        </div>
      );
    }

    // CAP EMERGENCY / SAFETY NOTICE WIDGET
    if (wp.widgetKind === 'alert') {
      const sev = wp.alertSeverity || 'warning';
      const sevColor = sev === 'critical' ? '#ef4444' : sev === 'info' ? '#38bdf8' : '#f59e0b';

      return (
        <div
          style={{
            ...wrapperStyle,
            background: 'rgba(24, 10, 14, 0.95)',
            border: `2px solid ${sevColor}`,
            borderRadius: '16px',
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '8px',
            fontFamily: 'Inter, system-ui, sans-serif',
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: '6px',
                background: sevColor,
                color: '#0f172a',
                fontSize: '12px',
                fontWeight: 900,
                letterSpacing: '1.2px',
              }}
            >
              ▲ {sev.toUpperCase()} ADVISORY
            </span>
            <span style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 700 }}>
              {wp.alertZone || 'ALL CAMPUS ZONES'}
            </span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#fff' }}>
            {wp.alertTitle || 'FACILITY & TRANSIT NOTICE'}
          </div>
          <div style={{ fontSize: '15px', color: '#fde68a', lineHeight: 1.35 }}>
            {wp.alertMessage || 'Please proceed to Concourse B for autonomous shuttle boarding.'}
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
