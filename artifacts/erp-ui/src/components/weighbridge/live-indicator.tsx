/**
 * LiveIndicator — real-time weight display panel.
 *
 * Polls /api/commercial-weighbridge/live-weight/?branch_id=<id> every 2 s.
 * Shows the current reading and a stability badge.
 * Calls onCapture(weight) when the user presses "Capture".
 */
import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Reading {
  weight: number | null;
  stable: boolean;
  source: string;
  timestamp: string;
}

interface Props {
  branchId: string | number;
  label?: string;         // "Gross Weight" | "Tare Weight"
  onCapture: (weight: number) => void;
  capturedWeight?: number | null;
  disabled?: boolean;
}

const POLL_MS = 2000;

function fetchLive(branchId: string | number): Promise<Reading> {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/commercial-weighbridge/live-weight/?branch_id=${branchId}`, {
    headers: { Authorization: `Token ${token}` },
  }).then(r => r.json());
}

export default function LiveIndicator({ branchId, label = 'Weight', onCapture, capturedWeight, disabled }: Props) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    const poll = () => {
      fetchLive(branchId)
        .then(r => { if (alive) { setReading(r); setError(false); } })
        .catch(() => { if (alive) setError(true); });
    };
    poll();
    intervalRef.current = setInterval(poll, POLL_MS);
    return () => { alive = false; if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [branchId]);

  const canCapture = !disabled && reading?.stable && reading?.weight != null && reading.weight > 0;

  const handleCapture = () => {
    if (!canCapture || reading?.weight == null) return;
    setCapturing(true);
    onCapture(reading.weight);
    setTimeout(() => setCapturing(false), 600);
  };

  const displayWeight = reading?.weight ?? null;
  const isStable     = reading?.stable ?? false;
  const isConnected  = !error && reading !== null;
  const panelStateClass = !branchId
    ? 'border-border opacity-50'
    : !isConnected
      ? 'border-destructive/30'
      : isStable
        ? 'border-emerald-400 shadow-emerald-100 dark:shadow-none shadow-md'
        : 'border-amber-300';

  return (
    <div className={`rounded-xl border-2 bg-black p-5 text-primary transition-all ${panelStateClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">{label}</span>
        <div className="flex items-center gap-1.5">
          {!branchId ? null : !isConnected ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-destructive uppercase tracking-wide">
              <WifiOff className="h-3 w-3" /> No signal
            </span>
          ) : isStable ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-none block" />
              Stable
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse block" />
              Settling…
            </span>
          )}
          {reading?.source && (
            <span className="text-[10px] text-muted-foreground font-mono ml-1 opacity-60 flex items-center gap-0.5">
              <Wifi className="h-2.5 w-2.5" /> {reading.source}
            </span>
          )}
        </div>
      </div>

      {/* Big weight display */}
      <div className="flex items-end gap-3 mb-4">
        <div className={`font-black tabular-nums transition-all ${
          displayWeight != null && displayWeight > 0 ? 'text-6xl' : 'text-5xl opacity-30'
        } text-primary`}>
          {!branchId ? '—' : displayWeight != null ? displayWeight.toLocaleString() : '···'}
        </div>
        <div className="mb-2 text-2xl font-bold text-primary">kg</div>
      </div>

      {/* Captured value pill */}
      {capturedWeight != null && capturedWeight > 0 && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-primary">Captured</span>
          <span className="font-mono font-black text-primary">{capturedWeight.toLocaleString()} kg</span>
        </div>
      )}

      {/* Capture button */}
      {branchId ? (
        <Button
          type="button"
          onClick={handleCapture}
          disabled={!canCapture || capturing}
          className={`w-full font-bold uppercase tracking-widest transition-all ${
            canCapture
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          }`}
        >
          <Zap className="h-4 w-4 mr-2" />
          {capturing       ? 'Captured!' :
           !isConnected    ? 'Indicator offline' :
           !isStable        ? 'Waiting for stable reading…' :
           displayWeight == null || displayWeight === 0 ? 'No reading on scale' :
                              `Capture ${displayWeight?.toLocaleString()} kg`}
        </Button>
      ) : (
        <div className="py-2 text-center text-xs font-medium text-primary">
          Select a branch to enable the indicator
        </div>
      )}
    </div>
  );
}
