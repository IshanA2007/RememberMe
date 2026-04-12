/**
 * PortalHomeCard — glassmorphism card with organic blobs and role selectors.
 *
 * Design:
 *   - Left panel: animated organic blobs + brand lockup + trust signals
 *   - Right panel: "Welcome Back" headline + two role action buttons
 *   - Card: rounded-3xl, glassmorphism (bg-white/70 + blur), subtle ring
 *   - Buttons: Patient (surface-container-low) and Caregiver (primary)
 */

import type { ReactElement } from 'react';
import { Heart, Shield } from 'lucide-react';

export interface PortalHomeCardProps {
  onPatientClick: () => void;
  onCaretakerClick: () => void;
}

interface RoleButtonProps {
  label: string;
  description: string;
  onClick: () => void;
  isPrimary?: boolean;
}

function RoleButton({ label, description, onClick, isPrimary }: RoleButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full group relative flex items-center p-6 transition-all duration-300 rounded-2xl text-left"
      style={{
        background: isPrimary ? 'var(--primary)' : 'var(--surface-container-low)',
        color: isPrimary ? 'white' : 'var(--on-surface)',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (isPrimary) {
          el.style.transform = 'translateY(-2px)';
          el.style.boxShadow = '0 12px 32px rgba(0, 109, 48, 0.2)';
        } else {
          el.style.background = 'white';
          el.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.08)';
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = 'none';
        if (!isPrimary) {
          el.style.background = 'var(--surface-container-low)';
        }
      }}
    >
      <div
        className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center mr-6"
        style={{
          background: isPrimary ? 'rgba(255,255,255,0.2)' : 'white',
          color: isPrimary ? 'white' : 'var(--primary)',
        }}
      >
        {isPrimary ? (
          <Heart size={28} />
        ) : (
          <span style={{ fontSize: 24 }}>👤</span>
        )}
      </div>
      <div className="flex-grow">
        <h3
          className="font-headline font-bold mb-1"
          style={{ fontSize: 18 }}
        >
          {label}
        </h3>
        <p
          style={{
            fontSize: 14,
            opacity: isPrimary ? 0.9 : 0.7,
            margin: 0,
          }}
        >
          {description}
        </p>
      </div>
      <span
        style={{
          fontSize: 20,
          opacity: 0,
          transition: 'all 0.3s ease',
          marginLeft: 'auto',
        }}
        className="group-hover:opacity-100 group-hover:translate-x-1"
      >
        →
      </span>
    </button>
  );
}

export function PortalHomeCard({
  onPatientClick,
  onCaretakerClick,
}: PortalHomeCardProps): ReactElement {
  return (
    <div
      className="w-full max-w-4xl grid md:grid-cols-2 gap-0 overflow-hidden rounded-3xl"
      style={{
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(40px)',
        WebkitBackdropFilter: 'blur(40px)',
        boxShadow: '0 20px 64px rgba(0, 0, 0, 0.08)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        animation: 'scaleIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* Left Panel: Branding with animated blobs */}
      <div
        className="relative hidden md:flex flex-col justify-between p-12 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(0, 109, 48, 0.03) 0%, rgba(0, 168, 77, 0.03) 100%)',
        }}
      >
        {/* Animated organic blobs */}
        <div
          style={{
            position: 'absolute',
            top: '-100px',
            left: '-100px',
            width: '300px',
            height: '300px',
            background: 'rgba(0, 168, 77, 0.15)',
            borderRadius: '50%',
            filter: 'blur(60px)',
            animation: 'drift 20s ease-in-out infinite alternate',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-80px',
            right: '-80px',
            width: '250px',
            height: '250px',
            background: 'rgba(206, 230, 241, 0.2)',
            borderRadius: '50%',
            filter: 'blur(60px)',
            animation: 'drift 25s ease-in-out infinite alternate',
            animationDelay: '-5s',
          }}
        />

        {/* Branding content */}
        <div className="relative z-10">
          <h1
            className="font-headline text-primary font-extrabold tracking-tight mb-3"
            style={{ fontSize: 36 }}
          >
            RememberMe
          </h1>
          <p
            className="text-tertiary font-body leading-relaxed max-w-xs"
            style={{ fontSize: 16 }}
          >
            A clinical sanctuary for memory preservation and professional care coordination.
          </p>
        </div>

        {/* Trust signals */}
        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-4 group">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform"
              style={{
                background: 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                color: 'var(--primary)',
              }}
            >
              <Shield size={24} />
            </div>
            <div>
              <p
                className="font-headline font-bold text-on-surface mb-1"
                style={{ fontSize: 14 }}
              >
                Secure & Private
              </p>
              <p
                className="text-tertiary"
                style={{ fontSize: 12, margin: 0 }}
              >
                HIPAA compliant data architecture.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 group">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform"
              style={{
                background: 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                color: 'var(--tertiary)',
              }}
            >
              <Heart size={24} />
            </div>
            <div>
              <p
                className="font-headline font-bold text-on-surface mb-1"
                style={{ fontSize: 14 }}
              >
                Patient Centered
              </p>
              <p
                className="text-tertiary"
                style={{ fontSize: 12, margin: 0 }}
              >
                Designed for neuro-cognitive accessibility.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel: Role Selection */}
      <div className="p-8 md:p-16 flex flex-col justify-center bg-white/40">
        <div className="mb-12 md:hidden text-center">
          <h1
            className="font-headline text-primary font-extrabold tracking-tight"
            style={{ fontSize: 28 }}
          >
            RememberMe
          </h1>
        </div>

        <div className="space-y-2 mb-10">
          <h2
            className="font-headline font-bold text-on-surface"
            style={{ fontSize: 24 }}
          >
            Welcome Back
          </h2>
          <p className="text-tertiary text-sm">Please select your portal to continue</p>
        </div>

        <div className="space-y-4">
          <RoleButton
            label="I am a Patient"
            description="Access your memories and daily care plan."
            onClick={onPatientClick}
            isPrimary={false}
          />
          <RoleButton
            label="I am a Caregiver"
            description="Manage patient circles and clinical updates."
            onClick={onCaretakerClick}
            isPrimary={true}
          />
        </div>

        <div
          style={{
            marginTop: 32,
            borderTop: '1px solid rgba(0, 0, 0, 0.1)',
            paddingTop: 24,
            textAlign: 'center',
          }}
        >
          <p
            className="text-tertiary text-xs font-label uppercase tracking-widest mb-4"
            style={{ letterSpacing: '0.15em' }}
          >
            New to RememberMe?
          </p>
          <div className="flex justify-center gap-4">
            <button
              type="button"
              className="text-sm font-headline font-bold text-primary hover:opacity-70 transition-opacity bg-none border-none cursor-pointer p-0"
            >
              Request Access
            </button>
            <span className="text-outline-variant">•</span>
            <button
              type="button"
              className="text-sm font-headline font-bold text-tertiary hover:opacity-70 transition-opacity bg-none border-none cursor-pointer p-0"
            >
              Clinical Support
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
