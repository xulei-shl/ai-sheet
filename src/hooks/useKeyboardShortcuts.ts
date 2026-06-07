import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';

export function useKeyboardShortcuts() {
  const {
    toggleLeftSidebar,
    toggleRightSidebar,
    setRightSidebarCollapsed,
    rightSidebarCollapsed,
  } = useUiStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl+K: Focus AI input (only when not in an input field)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const aiInput = document.querySelector<HTMLTextAreaElement>('[data-ai-input]');
        if (aiInput) {
          aiInput.focus();
        } else if (rightSidebarCollapsed) {
          toggleRightSidebar();
          setTimeout(() => {
            document.querySelector<HTMLTextAreaElement>('[data-ai-input]')?.focus();
          }, 250);
        }
        return;
      }

      // Ctrl+B: Toggle left sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleLeftSidebar();
        return;
      }

      // Ctrl+\: Toggle right sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleRightSidebar();
        return;
      }

      // Escape: Close right sidebar
      if (e.key === 'Escape') {
        if (!rightSidebarCollapsed && !isInput) {
          setRightSidebarCollapsed(true);
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleLeftSidebar, toggleRightSidebar, setRightSidebarCollapsed, rightSidebarCollapsed]);
}
