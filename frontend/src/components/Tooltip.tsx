/**
 * Tooltip.tsx — Reusable "?" tooltip component
 *
 * Shows a small circle with a "?" icon. On hover, displays a tooltip
 * with a plain-English explanation of a technical term.
 *
 * Usage: <Tooltip text="This removes background music and game sounds" />
 */

import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  text: string;
  size?: number;
}

export default function Tooltip({ text, size = 16 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('above');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // Determine if tooltip should appear above or below based on viewport position
  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // If the trigger is near the top of the viewport, show tooltip below
      setPosition(rect.top < 120 ? 'below' : 'above');
    }
  }, [isVisible]);

  return (
    <span
      ref={triggerRef}
      style={{ position: 'relative', display: 'inline-flex', cursor: 'help' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
      tabIndex={0}
      role="button"
      aria-label="More information"
    >
      <HelpCircle
        size={size}
        style={{
          color: 'var(--text-muted)',
          transition: 'color var(--transition-fast)',
          ...(isVisible ? { color: 'var(--accent-blue)' } : {}),
        }}
      />

      {isVisible && (
        <div
          ref={tooltipRef}
          style={{
            position: 'absolute',
            [position === 'above' ? 'bottom' : 'top']: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-card-solid)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-primary)',
            whiteSpace: 'normal',
            width: '240px',
            maxWidth: '90vw',
            textAlign: 'left',
            boxShadow: 'var(--shadow-md)',
            zIndex: 50,
            lineHeight: 1.5,
            fontWeight: 400,
            animation: 'fadeIn 0.15s ease',
            pointerEvents: 'none',
          }}
        >
          {text}
          {/* Arrow */}
          <div
            style={{
              position: 'absolute',
              [position === 'above' ? 'bottom' : 'top']: '-5px',
              left: '50%',
              transform: `translateX(-50%) rotate(${position === 'above' ? '45deg' : '225deg'})`,
              width: '8px',
              height: '8px',
              background: 'var(--bg-card-solid)',
              borderRight: '1px solid var(--border-default)',
              borderBottom: '1px solid var(--border-default)',
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(${position === 'above' ? '4px' : '-4px'}); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </span>
  );
}
