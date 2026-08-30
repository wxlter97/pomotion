import { useCallback, useEffect, useState } from 'react';
import { getAdminUsers, setUserApproval, UnauthorizedError, type AdminUser } from '../api';
import ConfirmDialog from './ConfirmDialog';
import { useT, type TFn } from '../i18n';

function errText(err: unknown, t: TFn): string {
  if (err instanceof UnauthorizedError) return t('goals.sessionExpired');
  return err instanceof Error ? err.message : t('common.somethingWrong');
}

function initial(u: AdminUser): string {
  return (u.name?.trim()?.[0] ?? u.email[0] ?? '?').toUpperCase();
}

function lastSeenLabel(iso: string | null, t: TFn): string {
  if (!iso) return t('admin.neverSignedIn');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return t('admin.activeToday');
  if (days === 1) return t('meta.chipYesterday');
  if (days < 30) return t('admin.agoDays', { n: days });
  return t('admin.agoMonths', { n: Math.floor(days / 30) });
}

/** Panel de admin: aprobar / revocar el login de los usuarios. */
export default function AdminUsersDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<AdminUser | null>(null);

  const reload = useCallback(async () => {
    try {
      setUsers((await getAdminUsers()).users);
    } catch (err) {
      setError(errText(err, t));
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
      setError(errText(err, t));
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
            {u.isAdmin && <span className="admin-user-badge">{t('admin.adminBadge')}</span>}
          </span>
          <span className="admin-user-sub">
            {u.approved
              ? u.name
                ? `${u.email} · ${lastSeenLabel(u.lastSeenAt, t)}`
                : lastSeenLabel(u.lastSeenAt, t)
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
            {busy ? t('feeds.syncBusy') : t('admin.approve')}
          </button>
        ) : (
          !u.isAdmin && (
            <button
              type="button"
              className="btn btn-plain btn-small admin-user-revoke"
              onClick={() => setPendingRevoke(u)}
              disabled={busy}
            >
              {t('admin.revoke')}
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
        <h2 id="admin-title">{t('admin.title')}</h2>

        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <h3 className="admin-section-title">{t('admin.pendingN', { n: pending.length })}</h3>
                <ul className="admin-user-list">{pending.map(row)}</ul>
              </>
            )}

            <h3 className="admin-section-title">{t('admin.withAccessN', { n: approved.length })}</h3>
            {approved.length === 0 ? (
              <p className="muted">{t('admin.none')}</p>
            ) : (
              <ul className="admin-user-list">{approved.map(row)}</ul>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-plain" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>

      {pendingRevoke && (
        <ConfirmDialog
          title={t('admin.revokeAria', { name: pendingRevoke.name || pendingRevoke.email })}
          message={t('admin.revokeBody')}
          confirmLabel={t('admin.revoke')}
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
