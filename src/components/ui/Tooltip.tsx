import { useState, useEffect, useRef, type ReactNode } from 'react';

interface TooltipProps {
  text: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export function Tooltip({ text, children, side = 'top', align = 'center', className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [overflow, setOverflow] = useState<'left' | 'right' | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const updateOverflow = () => {
      const triggerRect = triggerRef.current!.getBoundingClientRect();
      const tooltipRect = tooltipRef.current!.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      let newOverflow: 'left' | 'right' | null = null;
      if (tooltipRect.left < 8) {
        newOverflow = 'left';
      } else if (tooltipRect.right > viewportWidth - 8) {
        newOverflow = 'right';
      }
      setOverflow(newOverflow);
    };

    updateOverflow();

    window.addEventListener('scroll', updateOverflow, true);
    window.addEventListener('resize', updateOverflow);
    return () => {
      window.removeEventListener('scroll', updateOverflow, true);
      window.removeEventListener('resize', updateOverflow);
    };
  }, [visible]);

  const baseSide = side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';

  const alignStyles: Record<string, string> = {
    center: 'left-1/2 -translate-x-1/2',
    start: 'left-0',
    end: 'right-0',
  };

  const getComputedPosition = (): { positionClass: string; arrowPosition: string } => {
    if (align === 'center' && !overflow) {
      return {
        positionClass: 'left-1/2 -translate-x-1/2',
        arrowPosition: 'left-1/2 -translate-x-1/2',
      };
    }
    if (align === 'start' || (align === 'end' && overflow === 'right')) {
      return { positionClass: 'left-0', arrowPosition: 'left-3' };
    }
    if (align === 'end' || overflow === 'right') {
      return { positionClass: 'right-0', arrowPosition: 'right-3' };
    }
    return { positionClass: 'left-1/2 -translate-x-1/2', arrowPosition: 'left-1/2 -translate-x-1/2' };
  };

  const getArrowClass = (baseArrow: string): string => {
    if (side === 'top') {
      return overflow === 'left'
        ? 'left-3'
        : overflow === 'right'
          ? 'right-3'
          : 'left-1/2 -translate-x-1/2';
    }
    return overflow === 'left'
      ? 'left-3'
      : overflow === 'right'
        ? 'right-3'
        : 'left-1/2 -translate-x-1/2';
  };

  const { positionClass, arrowPosition } = getComputedPosition();
  const arrowClass = getArrowClass(arrowPosition);
  const arrowBorderSide = side === 'top' ? 'border-t-[var(--b3-tooltips-background)]' : 'border-b-[var(--b3-tooltips-background)]';

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => { setVisible(true); setOverflow(null); }}
      onMouseLeave={() => setVisible(false)}
    >
      {children}

      {visible && (
        <span
          ref={tooltipRef}
          role="tooltip"
          className={`absolute z-[9999] pointer-events-none select-none whitespace-nowrap rounded-md px-3 py-1.5 text-xs leading-snug ${baseSide} ${positionClass}`}
          style={{
            backgroundColor: 'var(--b3-tooltips-background)',
            color: 'var(--b3-tooltips-color)',
            boxShadow: 'var(--b3-tooltips-shadow)',
            border: '1px solid var(--border)',
          }}
        >
          {text}
          <span
            className={`absolute w-0 h-0 border-4 border-transparent ${arrowBorderSide} ${arrowClass}`}
            style={side === 'top' ? { top: '100%' } : { bottom: '100%' }}
          />
        </span>
      )}
    </span>
  );
}
