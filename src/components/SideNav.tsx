import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { PlusIcon, SearchIcon } from './icons';
import { NAV_ITEMS, type NavTab } from './navItems';

/**
 * Sidebar fija (desktop): logo, navegación primaria, "+ Nueva tarea" y,
 * abajo, buscar + tema. Oculta en mobile vía CSS (ver .side-nav en
 * styles.css) — en mobile la navegación equivalente es <BottomNav>.
 */
export default function SideNav({
  active,
  onSelect,
  onAdd,
  showAdd,
  onSearch,
  themeToggle,
}: {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  onAdd: () => void;
  showAdd: boolean;
  onSearch: () => void;
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
      <div className="side-nav-footer">
        <button type="button" className="side-nav-item" onClick={onSearch}>
          <SearchIcon />
          {t('menu.search')}
        </button>
        {themeToggle}
      </div>
    </nav>
  );
}
