import {
  useEffect,
  useRef,
  type RefObject,
} from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const modalStack: symbol[] = [];

interface ModalSiblingState {
  ariaHidden: string | null;
  element: HTMLElement;
  inert: boolean;
}

export interface UseModalFocusOptions {
  active?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  onEscape: () => void;
  restoreFocusTo: HTMLElement | null;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => (
      !element.hasAttribute('hidden')
      && element.closest('[aria-hidden="true"], [inert]') === null
    ));
}

function makeSiblingsInert(container: HTMLElement): ModalSiblingState[] {
  const parent = container.parentElement;
  if (parent === null) {
    return [];
  }
  return Array.from(parent.children)
    .filter((element): element is HTMLElement => (
      element instanceof HTMLElement && element !== container
    ))
    .map((element) => {
      const state = {
        ariaHidden: element.getAttribute('aria-hidden'),
        element,
        inert: element.hasAttribute('inert'),
      };
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
      return state;
    });
}

function restoreSiblings(states: readonly ModalSiblingState[]): void {
  for (const state of states) {
    if (state.ariaHidden === null) {
      state.element.removeAttribute('aria-hidden');
    } else {
      state.element.setAttribute('aria-hidden', state.ariaHidden);
    }
    if (state.inert) {
      state.element.setAttribute('inert', '');
    } else {
      state.element.removeAttribute('inert');
    }
  }
}

export function useModalFocus({
  active = true,
  containerRef,
  initialFocusRef,
  onEscape,
  restoreFocusTo,
}: UseModalFocusOptions): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const container = containerRef.current;
    if (!active || container === null) {
      return undefined;
    }

    const modalId = Symbol('modal');
    const siblingStates = makeSiblingsInert(container);
    modalStack.push(modalId);
    initialFocusRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== modalId) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const focusable = focusableElements(container);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }

      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !container.contains(focused))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (focused === last || !container.contains(focused))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = modalStack.lastIndexOf(modalId);
      if (stackIndex !== -1) {
        modalStack.splice(stackIndex, 1);
      }
      restoreSiblings(siblingStates);
      if (restoreFocusTo?.isConnected === true) {
        restoreFocusTo.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef, initialFocusRef, restoreFocusTo]);
}
