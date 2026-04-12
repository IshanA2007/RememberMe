/**
 * MemoryTree — radial SVG layout centered on the patient, with face
 * nodes arranged on an outer ring (FRONTEND_SPEC §2.3 / plan D2.8).
 *
 * Layout strategy:
 *   - Radius scales with node count so cards never overlap.
 *   - Node size shrinks slightly when many faces are present.
 *   - Lines connect from the center node edge to each card's nearest edge.
 *   - The SVG fills its container via a responsive viewBox.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { FaceObject } from '../types/api';
import { FaceCard } from './FaceCard';

export interface MemoryTreeProps {
  centerName: string;
  faces: FaceObject[];
  onFaceClick: (face: FaceObject) => void;
  /** Pixel width of the SVG viewport. Defaults to 960. */
  width?: number;
  /** Pixel height of the SVG viewport. Defaults to 640. */
  height?: number;
}

// Deterministic hash so re-renders don't shuffle nodes around.
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// Returns a value in [-0.06, 0.06] rad based on the face id — subtle jitter.
function angleJitter(faceId: string): number {
  const h = hashStr(faceId);
  return ((h % 1200) / 10000) - 0.06;
}

/**
 * Compute the nearest point on the edge of a rectangle to an external point.
 * Used to draw lines from center node edge → outer node edge.
 */
function rectEdgePoint(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = rw / 2;
  const hh = rh / 2;
  // Scale factor to land on the rectangle boundary.
  const sx = hw / Math.abs(dx || 1);
  const sy = hh / Math.abs(dy || 1);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function MemoryTree({
  centerName,
  faces,
  onFaceClick,
}: MemoryTreeProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 960, h: 640 });

  // Observe the container size for responsive layout.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: width, h: height } = dims;
  const cx = width / 2;
  const cy = height / 2;
  const count = faces.length;

  // Adaptive node sizing: shrink cards as count grows.
  const nodeW = count <= 4 ? 180 : count <= 8 ? 150 : 120;
  const nodeH = count <= 4 ? 80 : count <= 8 ? 68 : 56;

  // Compute a minimum radius that prevents overlap. Each node subtends
  // an arc; spacing them requires circumference ≥ count * (nodeW + gap).
  const gap = 32;
  const circumferenceNeeded = count * (nodeW + gap);
  const minRadiusForSpacing = circumferenceNeeded / (2 * Math.PI);

  // Also keep enough margin so nodes don't clip the viewport edge.
  const edgeMargin = Math.max(nodeW, nodeH) / 2 + 16;
  const maxRadiusForViewport = Math.min(cx, cy) - edgeMargin;
  const radius = Math.max(
    140,
    Math.min(minRadiusForSpacing, maxRadiusForViewport),
  );

  // If the required radius exceeds the viewport, expand the viewBox.
  const neededExtent = radius + edgeMargin + 20;
  const vbW = Math.max(width, neededExtent * 2);
  const vbH = Math.max(height, neededExtent * 2);
  const vcx = vbW / 2;
  const vcy = vbH / 2;

  // Centre node dimensions.
  const centerW = Math.max(160, centerName.length * 12 + 40);
  const centerH = 60;
  const centerRx = vcx - centerW / 2;
  const centerRy = vcy - centerH / 2;

  // Pre-compute node positions.
  const nodeCount = Math.max(count, 1);
  const nodes = faces.map((face, i) => {
    const base = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
    const angle = base + angleJitter(face.face_id);
    const nodeCx = vcx + Math.cos(angle) * radius;
    const nodeCy = vcy + Math.sin(angle) * radius;
    return {
      face,
      angle,
      cx: nodeCx,
      cy: nodeCy,
      x: nodeCx - nodeW / 2,
      y: nodeCy - nodeH / 2,
    };
  });

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <svg
        role="img"
        aria-label="Memory tree"
        viewBox={`0 0 ${vbW} ${vbH}`}
        width="100%"
        height="100%"
        style={{ display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Radial connecting lines — edge-to-edge. */}
        {nodes.map((n) => {
          // Line from center node edge → outer node edge.
          const from = rectEdgePoint(
            centerRx,
            centerRy,
            centerW,
            centerH,
            n.cx,
            n.cy,
          );
          const to = rectEdgePoint(n.x, n.y, nodeW, nodeH, vcx, vcy);
          return (
            <line
              key={`line-${n.face.face_id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--rule)"
              strokeWidth={1}
            />
          );
        })}

        {/* Centre node. */}
        <g>
          <rect
            x={centerRx}
            y={centerRy}
            width={centerW}
            height={centerH}
            fill="var(--bg-elevated)"
            stroke="var(--accent)"
            strokeWidth={1}
            rx={2}
            ry={2}
          />
          <text
            x={vcx}
            y={vcy + 8}
            textAnchor="middle"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fill: 'var(--ink-primary)',
            }}
          >
            {centerName}
          </text>
        </g>

        {/* Face nodes on the ring. */}
        {nodes.map((n) => (
          <foreignObject
            key={`node-${n.face.face_id}`}
            x={n.x}
            y={n.y}
            width={nodeW}
            height={nodeH}
          >
            <div style={{ width: nodeW, height: nodeH }}>
              <FaceCard
                face={n.face}
                onClick={() => onFaceClick(n.face)}
                compact={nodeW < 160}
              />
            </div>
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}
