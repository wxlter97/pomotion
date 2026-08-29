import { useEffect, useRef } from 'react';
import type { FileEntry } from '../types';

/**
 * Selector de "archivo" (Trabajo/Casa/Hábitos, etc.) — un contexto,
 * el valor de `tasks.file`. Se oculta si hay 0 o 1 archivo (modo de un
 * solo contexto).
 */
export default function FileSelector({
  files,
  selectedFileId,
  onSelectFile,
  loading,
}: {
  files: FileEntry[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
  loading?: boolean;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedFileId]);

  if (files.length <= 1) return null;

  return (
    <div className="file-tabs">
      {files.map((file) => (
        <button
          key={file.id}
          ref={file.id === selectedFileId ? activeRef : undefined}
          className={file.id === selectedFileId ? 'file-tab active' : 'file-tab'}
          onClick={() => onSelectFile(file.id)}
          disabled={loading}
          type="button"
        >
          {file.label}
        </button>
      ))}
    </div>
  );
}
