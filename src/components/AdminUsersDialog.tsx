import { useCallback, useEffect, useState } from 'react';
import { getAdminUsers, setUserApproval, UnauthorizedError, type AdminUser } from '../api';
import ConfirmDialog from './ConfirmDialog';

function errText(err: unknown): string {
  if (err instanceof UnauthorizedError) return 'La sesión expiró. Recargá la página.';
  return err instanceof Error ? err.message : 'Algo salió mal';
}

function initial(u: AdminUser): string {
  return (u.name?.trim()?.[0] ?? u.email[0] ?? '?').toUpperCase();
}

function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'nunca entró';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'activo hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return `hace ${Math.floor(days / 30)} meses`;
}

/** Panel de admin: aprobar / revocar el login de los usuarios. */
export default function AdminUsersDialog({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<AdminUser | null>(null);

  const reload = useCallback(async () => {
    try {
      setUsers((await getAdminUsers()).users);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pendingRevoke) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, pendingRevoke]);

  async function apply(user: AdminUser, approved: boolean) {
    setBusyId(user.id);
    setError(null);
    try {
      await setUserApproval(user.id, approved);
      await reload();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyId(null);
    }
  }

  const pending = users.filter((u) => !u.approved);
  const approved = users.filter((u) => u.approved);

  function row(u: AdminUser) {
    const busy = busyId === u.id;
    return (
      <li key={u.id} className={u.approved ? 'admin-user' : 'admin-user is-pending'}>
        <span className="admin-user-avatar" aria-hidden="true">
          {initial(u)}
        </span>
        <div className="admin-user-main">
          <span className="admin-user-name">
            {u.name || u.email}
            {u.isAdmin && <span className="admin-user-badge">admin</span>}
          </span>
          <span className="admin-user-sub">
            {u.approved
              ? u.name
                ? `${u.email} · ${lastSeenLabel(u.lastSeenAt)}`
                : lastSeenLabel(u.lastSeenAt)
              : u.name
                ? u.email
                : 'sin actividad'}
          </span>
        </div>
        {!u.approved ? (
          <button
            type="button"
            className="btn btn-tinted btn-small"
            onClick={() => void apply(u, true)}
            disabled={busy}
          >
            {busy ? '…' : 'Aprobar'}
          </button>
        ) : (
          !u.isAdmin && (
            <button
              type="button"
              className="btn btn-plain btn-small admin-user-revoke"
              onClick={() => setPendingRevoke(u)}
              disabled={busy}
            >
              Revocar
            </button>
          )
        )}
      </li>
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--admin"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="admin-title">Usuarios</h2>

        {loading ? (
          <p className="muted">Cargando…</p>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <h3 className="admin-section-title">Pendientes ({pending.length})</h3>
                <ul className="admin-user-list">{pending.map(row)}</ul>
              </>
            )}

            <h3 className="admin-section-title">Con acceso ({approved.length})</h3>
            {approved.length === 0 ? (
              <p className="muted">Nadie todavía.</p>
            ) : (
              <ul className="admin-user-list">{approved.map(row)}</ul>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      {pendingRevoke && (
        <ConfirmDialog
          title={`Revocar a ${pendingRevoke.name || pendingRevoke.email}`}
          message="No va a poder entrar hasta que lo apruebes de nuevo. Sus tareas no se tocan."
          confirmLabel="Revocar"
          destructive
          onConfirm={() => {
            const u = pendingRevoke;
            setPendingRevoke(null);
            void apply(u, false);
          }}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </div>
  );
}
