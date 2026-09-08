import { useRef, useState } from 'react';
import Icon from '@/components/base/Icon';

// Photo upload: drop zone → in-frame circular crop with zoom and drag.
// JPEG/PNG/WebP under 8MB, minimum 256×256. Rejects with the actual reason.
type State = 'empty' | 'dragging' | 'reading' | 'cropping' | 'uploading' | 'failed';

export default function AvatarUpload({ onUse, onCancel }: { onUse: (url: string) => void; onCancel: () => void }) {
  const [state, setState] = useState<State>('empty');
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const readFile = (file: File) => {
    setError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(`Rejected: ${file.type || 'unknown'} is not JPEG, PNG or WebP.`);
      setState('failed');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Rejected: the file is larger than 8MB.');
      setState('failed');
      return;
    }
    setState('reading');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth < 256 || img.naturalHeight < 256) {
        setError(`Rejected: the image is ${img.naturalWidth}×${img.naturalHeight}, below the 256×256 minimum.`);
        setState('failed');
        return;
      }
      setSrc(url);
      setZoom(1);
      setPos({ x: 50, y: 50 });
      setState('cropping');
    };
    img.onerror = () => {
      setError('Rejected: the file could not be read as an image.');
      setState('failed');
    };
    img.src = url;
  };

  const confirmUse = () => {
    if (!src) return;
    setState('uploading');
    setProgress(0);
    const t = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(t);
          onUse(src);
          return 100;
        }
        return p + 20;
      });
    }, 120);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    lastRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastRef.current.x;
    const dy = e.clientY - lastRef.current.y;
    lastRef.current = { x: e.clientX, y: e.clientY };
    setPos(p => ({ x: clamp(p.x + dx * 0.4, 0, 100), y: clamp(p.y + dy * 0.4, 0, 100) }));
  };
  const onPointerUp = () => { draggingRef.current = false; };

  const onKey = (e: React.KeyboardEvent) => {
    if (state !== 'cropping') return;
    if (e.key === 'ArrowLeft') setPos(p => ({ ...p, x: clamp(p.x - 4, 0, 100) }));
    if (e.key === 'ArrowRight') setPos(p => ({ ...p, x: clamp(p.x + 4, 0, 100) }));
    if (e.key === 'ArrowUp') setPos(p => ({ ...p, y: clamp(p.y - 4, 0, 100) }));
    if (e.key === 'ArrowDown') setPos(p => ({ ...p, y: clamp(p.y + 4, 0, 100) }));
    if (e.key === '+' || e.key === '=') setZoom(z => Math.min(2.5, z + 0.1));
    if (e.key === '-') setZoom(z => Math.max(1, z - 0.1));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-upload-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-0/80 p-4"
      onKeyDown={onKey}
    >
      <div className="w-full max-w-md rounded-lg border border-ink-4 bg-ink-1 p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 id="avatar-upload-title" className="font-serif text-h4 font-medium text-ink-10">Photo</h3>
          <button type="button" onClick={onCancel} aria-label="Close" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-8 hover:text-ink-10 cursor-pointer">
            <Icon name="close" size={18} />
          </button>
        </div>

        {state === 'empty' || state === 'dragging' || state === 'reading' || state === 'failed' ? (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setState('dragging'); }}
              onDragLeave={() => setState('empty')}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
              className={`mt-6 flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-md border-2 p-6 text-center ${
                state === 'dragging' ? 'border-dashed border-mint' : 'border-dashed border-ink-5'
              }`}
            >
              <Icon name="upload" size={24} className="text-ink-7" />
              <p className="text-body-sm text-ink-8">Drop a photo, or choose a file.</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
              >
                Choose file
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
              <p className="text-caption text-ink-7">JPEG, PNG or WebP, under 8MB, at least 256×256.</p>
              {state === 'reading' && <p className="text-caption text-ink-8">Reading the file…</p>}
              {state === 'failed' && <p className="text-body-sm text-rose" role="alert">{error}</p>}
            </div>
            {state === 'failed' && (
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setState('empty')} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer">Retry</button>
                <button type="button" onClick={onCancel} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer">Cancel</button>
              </div>
            )}
          </>
        ) : null}

        {state === 'cropping' && src && (
          <>
            <div className="mt-6 flex justify-center">
              <div
                className="relative h-64 w-64 cursor-grab touch-none select-none overflow-hidden rounded-full border border-ink-5 active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                role="application"
                aria-label="Crop the photo. Drag to reposition, use + and − to zoom."
              >
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                  style={{ objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${zoom})` }}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Icon name="crop" size={16} className="text-ink-7" />
              <input
                type="range"
                min={1}
                max={2.5}
                step={0.05}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                aria-label="Zoom"
                className="flex-1 accent-mint"
              />
              <span className="font-mono text-caption text-ink-7">{zoom.toFixed(2)}×</span>
            </div>
            <div className="mt-6 flex gap-2">
              <button type="button" onClick={onCancel} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer">Cancel</button>
              <button type="button" onClick={confirmUse} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer">Use photo</button>
            </div>
          </>
        )}

        {state === 'uploading' && (
          <div className="mt-6">
            <p className="text-body-sm text-ink-8">Uploading…</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-4">
              <div className="h-full rounded-full bg-mint transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 font-mono text-caption tabular-nums text-ink-7">{progress}%</p>
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}