import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { PlusIcon } from './icons';
import { NAV_ITEMS, type NavTab } from './navItems';

/**
 * Sidebar fija (desktop): logo, navegación primaria, "+ Nueva tarea" y,
 * abajo, el cambio de tema. Oculta en mobile vía CSS (ver .side-nav en
 * styles.css) — en mobile la navegación equivalente es <BottomNav>. Buscar
 * vive fuera de la sidebar, como botón flotante arriba del contenido (ver
 * .desktop-search-float en App.tsx).
 */
export default function SideNav({
  active,
  onSelect,
  onAdd,
  showAdd,
  themeToggle,
}: {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  onAdd: () => void;
  showAdd: boolean;
  themeToggle: ReactNode;
}) {
  const t = useT();

  return (
    <nav className="side-nav" aria-label={t('nav.label')}>
      <h1 className="side-nav-brand">pomotion</h1>
      <div className="side-nav-items">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={isActive ? 'side-nav-item active' : 'side-nav-item'}
              onClick={() => onSelect(item.key)}
              aria-current={isActive ? 'page' : undefined}
            >
              <item.Icon active={isActive} />
              {t(item.labelKey)}
            </button>
          );
        })}
      </div>
      {showAdd && (
        <button type="button" className="btn btn-filled fab-desktop" onClick={onAdd}>
          <PlusIcon />
          {t('nav.add')}
        </button>
      )}
      <div className="side-nav-footer">{themeToggle}</div>
    </nav>
  );
}
