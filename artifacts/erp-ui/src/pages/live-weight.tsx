import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/use-auth';
import { Scale, Wifi, WifiOff, RefreshCw, Radio } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WeightReading {
  weight: number | null;
  unit: string;
  stable: boolean;
  source: string;
  branch_id: number | null;
  timestamp: string;
}

interface Branch {
  id: number;
  name: string;
}

// ── History ring buffer ───────────────────────────────────────────────────────

interface HistoryPoint { t: Date; weight: number | null; stable: boolean; }
const MAX_HISTORY = 60;

// ── Digit display ─────────────────────────────────────────────────────────────

function WeightDisplay({ weight, unit, stable, animating }: {
  weight: number | null; unit: string; stable: boolean; animating: boolean;
}) {
  const text = weight != null ? weight.toLocaleString('en', { minimumFractionDigits: 0 }) : '—';

  return (
    <div className="flex flex-col items-center justify-center select-none">
      {/* Seven-segment style big number */}
      <div
        className={`font-mono font-black tabular-nums tracking-tight transition-colors duration-300 ${
          weight == null
            ? 'text-muted-foreground/30'
            : stable
              ? 'text-emerald-500 dark:text-emerald-400'
              : 'text-foreground'
        } ${animating ? 'opacity-80' : 'opacity-100'}`}
        style={{ fontSize: 'clamp(72px, 14vw, 140px)', lineHeight: 1, letterSpacing: '-0.02em' }}
      >
        {text}
      </div>
      <div className={`text-2xl font-bold tracking-[0.3em] uppercase mt-1 ${
        weight == null ? 'text-muted-foreground/30' : 'text-muted-foreground'
      }`}>
        {unit || 'KG'}
      </div>
    </div>
  );
}

// ── Spark graph (last 60 readings) ────────────────────────────────────────────

function SparkGraph({ history }: { history: HistoryPoint[] }) {
  const validPoints = history.filter(p => p.weight != null) as (HistoryPoint & { weight: number })[];
  if (validPoints.length < 2) {
    return (
      <div className="h-16 flex items-center justify-center text-xs font-mono text-muted-foreground/40 tracking-widest">
        Waiting for readings…
      </div>
    );
  }

  const W = 600, H = 64;
  const weights = validPoints.map(p => p.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;

  const pts = validPoints.map((p, i) => {
    const x = (i / (validPoints.length - 1)) * W;
    const y = H - ((p.weight - min) / range) * (H - 8) - 4;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts.join(' ')}
        className="text-emerald-500"
      />
      <polygon
        fill="url(#spark-grad)"
        points={`0,${H} ${pts.join(' ')} ${W},${H}`}
        className="text-emerald-500"
      />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const POLL_MS = 2000;

export default function LiveWeight() {
  const { token } = useAuth();

  const [branches, setBranches]       = useState<Branch[]>([]);
  const [branchId, setBranchId]       = useState<number | null>(null);
  const [reading, setReading]         = useState<WeightReading | null>(null);
  const [history, setHistory]         = useState<HistoryPoint[]>([]);
  const [connected, setConnected]     = useState<boolean | null>(null); // null = unknown
  const [pollCount, setPollCount]     = useState(0);
  const [animating, setAnimating]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const prevWeight = useRef<number | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Load branches once
  useEffect(() => {
    if (!token) return;
    fetch('/api/commercial-weighbridge/branches/', {
      headers: { Authorization: `Token ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        const list: Branch[] = Array.isArray(json) ? json : json?.results ?? [];
        setBranches(list);
        if (list.length > 0) setBranchId(list[0].id);
      })
      .catch(() => {});
  }, [token]);

  // Poll live weight
  const poll = useCallback(async () => {
    if (!token) return;
    const qs = branchId != null ? `?branch_id=${branchId}` : '';
    try {
      const res = await fetch(`/api/commercial-weighbridge/live-weight/${qs}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: WeightReading = await res.json();
      setReading(data);
      setConnected(data.weight != null);
      setError(null);

      // animate when weight changes
      if (data.weight !== prevWeight.current) {
        setAnimating(true);
        setTimeout(() => setAnimating(false), 200);
        prevWeight.current = data.weight;
      }

      setHistory(prev => {
        const next = [...prev, { t: new Date(data.timestamp), weight: data.weight, stable: data.stable }];
        return next.slice(-MAX_HISTORY);
      });
      setPollCount(c => c + 1);
    } catch (err: any) {
      setConnected(false);
      setError(err?.message ?? 'Connection error');
    }
  }, [token, branchId]);

  // Start/restart polling when branchId changes
  useEffect(() => {
    clearInterval(pollRef.current);
    setHistory([]);
    setPollCount(0);
    prevWeight.current = null;
    poll(); // immediate first fetch
    pollRef.current = setInterval(poll, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [poll]);

  const activeBranch = branches.find(b => b.id === branchId);
  const isOnline     = connected === true;
  const isOffline    = connected === false;

  // Stats from history
  const validWeights = history.map(h => h.weight).filter(w => w != null) as number[];
  const minW = validWeights.length ? Math.min(...validWeights) : null;
  const maxW = validWeights.length ? Math.max(...validWeights) : null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" />
            Live Weight Monitor
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            Auto-polling every {POLL_MS / 1000}s · {pollCount} reads
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest border transition-colors ${
            isOnline  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800' :
            isOffline ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800' :
                        'bg-muted text-muted-foreground border-border'
          }`}>
            {isOnline  ? <Wifi    className="h-3.5 w-3.5" /> :
             isOffline ? <WifiOff className="h-3.5 w-3.5" /> :
                         <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            {isOnline ? 'Online' : isOffline ? 'Offline' : 'Connecting…'}
          </div>
        </div>
      </div>

      {/* Branch selector */}
      {branches.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {branches.map(b => (
            <button
              key={b.id}
              onClick={() => setBranchId(b.id)}
              className={`px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wide border-2 transition-all ${
                b.id === branchId
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      {/* Main weight card */}
      <div className={`relative rounded-2xl border-2 overflow-hidden transition-colors duration-500 ${
        isOnline && reading?.stable
          ? 'border-emerald-400/60 bg-gradient-to-b from-emerald-950/5 to-card dark:from-emerald-950/20'
          : isOnline
            ? 'border-orange-300/60 bg-card'
            : 'border-border bg-card'
      }`}>

        {/* Indicator bar at top */}
        <div className={`h-1.5 w-full transition-colors duration-300 ${
          isOnline && reading?.stable ? 'bg-emerald-500' :
          isOnline                   ? 'bg-orange-400 animate-pulse' :
                                       'bg-muted'
        }`} />

        {/* Source / branch label */}
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          <div className="text-xs font-mono text-muted-foreground/60 uppercase tracking-widest">
            {activeBranch?.name ?? 'All Branches'}
          </div>
          <div className="text-xs font-mono text-muted-foreground/60 uppercase tracking-widest">
            {reading?.source ? `SRC: ${reading.source}` : ''}
          </div>
        </div>

        {/* Big display */}
        <div className="px-6 py-8 flex justify-center">
          <WeightDisplay
            weight={reading?.weight ?? null}
            unit={reading?.unit ?? 'KG'}
            stable={reading?.stable ?? false}
            animating={animating}
          />
        </div>

        {/* Status pills */}
        <div className="flex justify-center gap-4 pb-6">
          {/* Stable/settling */}
          <div className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-black tracking-widest uppercase border-2 transition-all ${
            reading?.stable
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700'
              : 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700'
          }`}>
            <div className={`w-2.5 h-2.5 rounded-full ${
              reading?.stable ? 'bg-emerald-500' : 'bg-orange-500 animate-pulse'
            }`} />
            {reading == null ? 'Waiting' : reading.stable ? 'Stable' : 'Settling'}
          </div>

          {/* Timestamp */}
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-mono text-muted-foreground border-2 border-border bg-muted/40">
            <RefreshCw className={`h-3.5 w-3.5 ${pollCount > 0 && !error ? 'text-emerald-500' : 'text-muted-foreground'}`} />
            {reading?.timestamp
              ? new Date(reading.timestamp).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
              : '--:--:--'}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mb-4 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-mono dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Trend graph */}
      <div className="bg-card border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Reading Trend (last {Math.min(history.length, MAX_HISTORY)} polls)
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
            {minW != null && <span>Min: <strong className="text-foreground">{minW.toLocaleString()} kg</strong></span>}
            {maxW != null && <span>Max: <strong className="text-foreground">{maxW.toLocaleString()} kg</strong></span>}
          </div>
        </div>
        <SparkGraph history={history} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Current', value: reading?.weight != null ? `${reading.weight.toLocaleString()} kg` : '—', accent: isOnline && reading?.stable ? 'emerald' : undefined },
          { label: 'Min (session)', value: minW != null ? `${minW.toLocaleString()} kg` : '—', accent: undefined },
          { label: 'Max (session)', value: maxW != null ? `${maxW.toLocaleString()} kg` : '—', accent: undefined },
          { label: 'Polls', value: pollCount.toString(), accent: undefined },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-xl p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{s.label}</div>
            <div className={`text-xl font-black font-mono ${s.accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent readings table */}
      {history.length > 0 && (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/40 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent Readings</div>
            <div className="text-[10px] font-mono text-muted-foreground/60">newest first</div>
          </div>
          <div className="overflow-y-auto max-h-48">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-bold uppercase tracking-widest text-[10px] text-muted-foreground">Time</th>
                  <th className="px-4 py-2 text-right font-bold uppercase tracking-widest text-[10px] text-muted-foreground">Weight</th>
                  <th className="px-4 py-2 text-center font-bold uppercase tracking-widest text-[10px] text-muted-foreground">State</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 20).map((h, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-1.5 font-mono text-muted-foreground">
                      {h.t.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    </td>
                    <td className={`px-4 py-1.5 font-mono font-bold text-right ${h.weight != null ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                      {h.weight != null ? `${h.weight.toLocaleString()} kg` : '—'}
                    </td>
                    <td className="px-4 py-1.5 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
                        h.stable
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800'
                          : 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${h.stable ? 'bg-emerald-500' : 'bg-orange-400'}`} />
                        {h.stable ? 'Stable' : 'Settling'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
