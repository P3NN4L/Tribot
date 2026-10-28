import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from './api.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Entry { name: string; path: string; dir: boolean; size: number; }

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['md', 'markdown', 'txt'].includes(ext)) return '📄';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h'].includes(ext)) return '⌘';
  if (['json', 'yaml', 'yml', 'toml', 'ini'].includes(ext)) return '{}';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return '🖼';
  if (['pdf'].includes(ext)) return 'PDF';
  return '·';
}

export function FileTree({ sessionId, onOpen }: { sessionId: string; onOpen: (path: string) => void }) {
  const [roots, setRoots] = useState<string[]>([]);
  const [nodes, setNodes] = useState<Record<string, Entry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState('');

  const load = async (dir?: string) => {
    setLoading(dir ?? 'root');
    try {
      const r = await api.files(sessionId, dir);
      if (!dir) {
        setRoots(r.roots);
        if (r.roots[0]) {
          const first = await api.files(sessionId, r.roots[0]);
          setNodes((prev) => ({ ...prev, [r.roots[0]]: first.entries }));
          setOpen((prev) => ({ ...prev, [r.roots[0]]: true }));
        }
      } else {
        setNodes((prev) => ({ ...prev, [dir]: r.entries }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoading('');
    }
  };

  useEffect(() => {
    setRoots([]); setNodes({}); setOpen({});
    void load();
  }, [sessionId]);

  const toggle = async (dir: string) => {
    const next = !open[dir];
    setOpen((prev) => ({ ...prev, [dir]: next }));
    if (next && !nodes[dir]) await load(dir);
  };

  const renderDir = (dir: string, depth: number) => {
    const entries = nodes[dir] ?? [];
    return (
      <div className="file-children">
        {entries.map((e) => {
          const label = e.name;
          if (e.dir) {
            return (
              <div key={e.path}>
                <button className="file-row dir" style={{ paddingLeft: depth * 12 + 8 }} onClick={() => void toggle(e.path)}>
                  <span className="file-caret">{open[e.path] ? '▾' : '▸'}</span>
                  <span className="file-ico">▢</span>
                  <span className="file-name">{label}</span>
                </button>
                {open[e.path] && renderDir(e.path, depth + 1)}
              </div>
            );
          }
          return (
            <button key={e.path} className="file-row" style={{ paddingLeft: depth * 12 + 22 }} onClick={() => onOpen(e.path)} title={e.path}>
              <span className="file-ico">{fileIcon(label)}</span>
              <span className="file-name">{label}</span>
            </button>
          );
        })}
        {loading === dir && <div className="file-loading">加载中…</div>}
      </div>
    );
  };

  if (roots.length === 0) return <p className="file-empty">这个会话还没有工作区目录。</p>;
  type Row = { key: string; label: string; path: string; dir: boolean; depth: number; root: boolean };
  const rows: Row[] = [];
  const pushDir = (dir: string, depth: number, isRoot: boolean) => {
    rows.push({
      key: `${isRoot ? 'root' : 'dir'}:${dir}`,
      label: isRoot ? (dir.split(/[\\/]/).filter(Boolean).pop() ?? dir) : (dir.split(/[\\/]/).filter(Boolean).pop() ?? dir),
      path: dir,
      dir: true,
      depth,
      root: isRoot,
    });
    if (!open[dir]) return;
    for (const e of nodes[dir] ?? []) {
      if (e.dir) pushDir(e.path, depth + 1, false);
      else rows.push({ key: `file:${e.path}`, label: e.name, path: e.path, dir: false, depth: depth + 1, root: false });
    }
  };
  for (const root of roots) pushDir(root, 0, true);
  return (
    <div className="file-tree">
      {rows.map((row) => (
        <button
          key={row.key}
          className={`file-row ${row.root ? 'root' : ''}`}
          style={{ paddingLeft: row.depth * 12 + (row.root ? 8 : 22) }}
          title={row.path}
          onClick={() => (row.dir ? void toggle(row.path) : onOpen(row.path))}
        >
          <span className="file-caret">{row.dir ? (open[row.path] ? '▾' : '▸') : ''}</span>
          <span className="file-ico">{row.dir ? '▢' : fileIcon(row.label)}</span>
          <span className="file-name">{row.label}</span>
        </button>
      ))}
      {loading && <div className="file-loading">加载中…</div>}
    </div>
  );
}

function PdfViewer({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDoc(null); setPage(1); setNumPages(0); setError('');
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) { (pdf as any).destroy?.(); return; }
        setDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await doc.getPage(page);
        const viewport = p.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current!;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await p.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [doc, page]);

  if (error) return <p className="file-empty">PDF 加载失败：{error}</p>;
  return (
    <div className="pdf-view">
      <div className="pdf-bar">
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
        <span>{numPages ? `${page} / ${numPages}` : '加载中…'}</span>
        <button disabled={!numPages || page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}>下一页</button>
      </div>
      <div className="pdf-page"><canvas ref={canvasRef} /></div>
    </div>
  );
}

export function FilePreview({ sessionId, path, onClose }: { sessionId: string; path: string; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.file>> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api.file(sessionId, path).then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, [sessionId, path]);

  return (
    <aside className="file-preview" aria-label="文件预览">
      <div className="fp-head">
        <span className="fp-name" title={path}>{path.split(/[\\/]/).pop()}</span>
        <span className="fp-size">{data ? `${(data.size / 1024).toFixed(1)} KB` : ''}</span>
        <button className="fp-close" onClick={onClose} aria-label="关闭预览">×</button>
      </div>
      <div className="fp-body">
        {error && <p className="file-empty">{error}</p>}
        {!data && !error && <p className="file-loading">读取中…</p>}
        {data?.kind === 'image' && data.dataUrl && <img className="fp-image" src={data.dataUrl} alt={data.name} />}
        {data?.kind === 'pdf' && <PdfViewer url={api.fileUrl(sessionId, path)} />}
        {data?.kind === 'binary' && <p className="file-empty">二进制文件，暂不预览。</p>}
        {data?.kind === 'text' && ['md', 'markdown'].includes(data.ext.replace('.', '')) && (
          <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{data.text ?? ''}</ReactMarkdown></div>
        )}
        {data?.kind === 'text' && !['md', 'markdown'].includes(data.ext.replace('.', '')) && (
          <pre className="fp-text">{data.text}</pre>
        )}
      </div>
    </aside>
  );
}
