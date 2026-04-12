/**
 * PendingFacesSection — lists unnamed Vision captures awaiting a name.
 *
 * API_SPEC §3b: list / accept / dismiss pending faces. When the list is
 * empty the section renders NOTHING (no generic empty state) so a
 * well-named patient's Faces page stays uncluttered per the task brief.
 *
 * Data: react-query with 15 s stale time. Accept / dismiss mutations
 * invalidate both `['pending-faces', patientId]` and `['faces', patientId]`
 * — a successful accept promotes a pending face into the main registry.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { PendingFaceCard } from './PendingFaceCard';
import { useAuthedFetch } from '../auth/useAuthedFetch';
import {
  acceptPendingFace,
  dismissPendingFace,
  listPendingFaces,
} from '../services/rest_client';
import type {
  PendingFaceAcceptRequest,
  PendingFaceListResponse,
} from '../types/api';

export interface PendingFacesSectionProps {
  patientId: string;
}

export function PendingFacesSection({
  patientId,
}: PendingFacesSectionProps): ReactElement | null {
  const fetcher = useAuthedFetch();
  const qc = useQueryClient();

  const { data } = useQuery<PendingFaceListResponse>({
    queryKey: ['pending-faces', patientId],
    enabled: Boolean(patientId),
    staleTime: 15_000,
    queryFn: () => listPendingFaces(fetcher, patientId),
  });

  const acceptMut = useMutation({
    mutationFn: async (input: {
      pendingFaceId: string;
      body: PendingFaceAcceptRequest;
    }) => acceptPendingFace(fetcher, input.pendingFaceId, input.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pending-faces', patientId] });
      void qc.invalidateQueries({ queryKey: ['faces', patientId] });
    },
  });

  const dismissMut = useMutation({
    mutationFn: async (pendingFaceId: string) =>
      dismissPendingFace(fetcher, pendingFaceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pending-faces', patientId] });
    },
  });

  const pendingFaces = data?.pending_faces ?? [];

  // Avoid clutter on well-named patients — render nothing when empty.
  if (pendingFaces.length === 0) return null;

  return (
    <section
      style={{
        paddingBottom: 28,
        borderBottom: '1px solid var(--rule)',
        marginBottom: 28,
      }}
    >
      <div
        className="flex items-baseline"
        style={{ gap: 10, marginBottom: 16 }}
      >
        <span
          className="font-mono uppercase text-ink-secondary"
          style={{ fontSize: 11, letterSpacing: '0.14em' }}
        >
          Faces awaiting names
        </span>
        <span
          className="font-mono text-ink-secondary"
          style={{ fontSize: 11, letterSpacing: '0.08em' }}
        >
          ({pendingFaces.length})
        </span>
      </div>

      <div className="flex flex-col" style={{ gap: 0 }}>
        {pendingFaces.map((pf, i) => {
          const pendingFaceId = pf.pending_face_id;
          const isBusyForThis =
            (acceptMut.isPending && acceptMut.variables?.pendingFaceId === pendingFaceId) ||
            (dismissMut.isPending && dismissMut.variables === pendingFaceId);
          return (
            <div
              key={pendingFaceId}
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
                paddingTop: i === 0 ? 0 : 16,
                paddingBottom: i === pendingFaces.length - 1 ? 0 : 16,
              }}
            >
              <PendingFaceCard
                pendingFace={pf}
                busy={isBusyForThis}
                onAccept={(body) =>
                  acceptMut.mutate({ pendingFaceId, body })
                }
                onDismiss={() => dismissMut.mutate(pendingFaceId)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
