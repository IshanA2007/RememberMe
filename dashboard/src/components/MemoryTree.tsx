/**
 * MemoryTree — concentric SVG layout centered on the patient, with face
 * nodes on an outer ring (FRONTEND_SPEC §2.3 / plan D2.8).
 *
 * Distinctive touches:
 *   - Asymmetric angular spacing via a deterministic jitter (±0.1 rad) so
 *     the ring feels authored, not programmatic.
 *   - Radial lines drawn at 1px on --rule, not a generic grid.
 *   - Center node is a rectangle with a 1px --accent border carrying the
 *     patient's name in Fraunces 32px.
 *   - FaceCards are rendered via <foreignObject> so typography stays HTML.
 *
 * Radius is computed from the SVG viewport (props-supplied width/height),
 * which keeps the tree responsive without a layout pass.
 */

import type { ReactElement } from 'react';
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

// Returns a value in [-0.1, 0.1] rad based on the face id.
function angleJitter(faceId: string): number {
  const h = hashStr(faceId);
  return ((h % 2000) / 10000) - 0.1;
}

// Face card footprint (matches FaceCard surface width).
const NODE_W = 200;
const NODE_H = 96;

export function MemoryTree({
  centerName,
  faces,
  onFaceClick,
  width = 960,
  height = 640,
}: MemoryTreeProps): ReactElement {
  const cx = width / 2;
  const cy = height / 2;

  // Leave a margin so node rectangles don't clip the viewport edge.
  const margin = Math.max(NODE_W, NODE_H) / 2 + 24;
  const radius = Math.max(120, Math.min(cx, cy) - margin);

  const count = Math.max(faces.length, 1);

  // Centre node rectangle dimensions.
  const centerW = Math.max(200, centerName.length * 14 + 40);
  const centerH = 72;

  return (
    <svg
      role="img"
      aria-label="Memory tree"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      style={{ display: 'block' }}
    >
      {/* Radial connecting lines — drawn first so nodes paint on top. */}
      {faces.map((face, i) => {
        const base = (i / count) * Math.PI * 2 - Math.PI / 2;
        const angle = base + angleJitter(face.face_id);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        return (
          <line
            key={`line-${face.face_id}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--rule)"
            strokeWidth={1}
          />
        );
      })}

      {/* Centre node. */}
      <g>
        <rect
          x={cx - centerW / 2}
          y={cy - centerH / 2}
          width={centerW}
          height={centerH}
          fill="var(--bg-elevated)"
          stroke="var(--accent)"
          strokeWidth={1}
          rx={2}
          ry={2}
        />
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fill: 'var(--ink-primary)',
          }}
        >
          {centerName}
        </text>
      </g>

      {/* Face nodes on the ring. */}
      {faces.map((face, i) => {
        const base = (i / count) * Math.PI * 2 - Math.PI / 2;
        const angle = base + angleJitter(face.face_id);
        const x = cx + Math.cos(angle) * radius - NODE_W / 2;
        const y = cy + Math.sin(angle) * radius - NODE_H / 2;
        return (
          <foreignObject
            key={`node-${face.face_id}`}
            x={x}
            y={y}
            width={NODE_W}
            height={NODE_H}
          >
            <div style={{ width: NODE_W, height: NODE_H }}>
              <FaceCard face={face} onClick={() => onFaceClick(face)} />
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}
