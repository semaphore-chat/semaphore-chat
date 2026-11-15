/**
 * The document-level event router. Hosts register what they want to hear; the
 * listeners are added to the document once, when the first host registers, and
 * removed with the last. Sibling `KitProvider`s (side-by-side stories) each own
 * a host and share one router: Escape goes to the host touched most recently,
 * everything else goes to every host.
 */
export interface RouterHandlers {
  /** Bubble phase, so the focused control and React handlers run first. Escape, Tab, F6. */
  keydown?: (event: KeyboardEvent) => void;
  /** Capture phase, so a press is seen even when the page stops it. */
  pointerdown?: (event: PointerEvent) => void;
  pointerup?: (event: PointerEvent) => void;
  pointercancel?: (event: PointerEvent) => void;
  focusin?: (event: FocusEvent) => void;
  focusout?: (event: FocusEvent) => void;
  visibilitychange?: (event: Event) => void;
  /** On the window: it blurred or regained focus. */
  blur?: (event: Event) => void;
  focus?: (event: Event) => void;
}

export interface DocumentRouter {
  register(host: object, handlers: RouterHandlers): () => void;
  /** Escape goes to this host from now on (its stack changed). */
  touch(host: object): void;
}

type Target = 'document' | 'window';
interface Binding {
  name: keyof RouterHandlers;
  target: Target;
  capture: boolean;
  /** Only the touched host hears it. */
  single: boolean;
}

const BINDINGS: Binding[] = [
  { name: 'keydown', target: 'document', capture: false, single: true },
  { name: 'pointerdown', target: 'document', capture: true, single: false },
  { name: 'pointerup', target: 'document', capture: true, single: false },
  { name: 'pointercancel', target: 'document', capture: true, single: false },
  { name: 'focusin', target: 'document', capture: false, single: false },
  { name: 'focusout', target: 'document', capture: false, single: false },
  { name: 'visibilitychange', target: 'document', capture: false, single: false },
  { name: 'blur', target: 'window', capture: false, single: false },
  { name: 'focus', target: 'window', capture: false, single: false },
];

export function createDocumentRouter(win: Window): DocumentRouter {
  const doc = win.document;
  // Registration order; the touched host moves to the end.
  const hosts: Array<{ host: object; handlers: RouterHandlers }> = [];
  const listeners = new Map<Binding, EventListener>();

  function deliver(binding: Binding, event: Event): void {
    const targets = binding.single ? hosts.slice(-1) : [...hosts];
    targets.forEach(({ handlers }) => {
      (handlers[binding.name] as ((e: Event) => void) | undefined)?.(event);
    });
  }

  function attach(): void {
    BINDINGS.forEach((binding) => {
      const listener: EventListener = (event) => deliver(binding, event);
      listeners.set(binding, listener);
      (binding.target === 'document' ? doc : win).addEventListener(binding.name, listener, binding.capture);
    });
  }

  function detach(): void {
    listeners.forEach((listener, binding) => {
      (binding.target === 'document' ? doc : win).removeEventListener(binding.name, listener, binding.capture);
    });
    listeners.clear();
  }

  return {
    register(host, handlers) {
      const entry = { host, handlers };
      hosts.push(entry);
      if (hosts.length === 1) attach();
      return () => {
        const at = hosts.indexOf(entry);
        if (at === -1) return;
        hosts.splice(at, 1);
        if (hosts.length === 0) detach();
      };
    },
    touch(host) {
      const at = hosts.findIndex((entry) => entry.host === host);
      if (at === -1) return;
      hosts.push(...hosts.splice(at, 1));
    },
  };
}

let shared: DocumentRouter | null = null;

/** The one router of this document, created on first use. */
export function documentRouter(): DocumentRouter {
  shared ??= createDocumentRouter(window);
  return shared;
}
