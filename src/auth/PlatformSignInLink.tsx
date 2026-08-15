import { useState, type MouseEvent, type ReactNode } from 'react';
import { navigateToPlatformAuth, releaseServiceWorkersForPlatformAuth } from '../pwa/platform-auth-navigation';

export interface PlatformSignInLinkProps {
  children: ReactNode;
  className?: string;
  href: string;
  navigate?: (url: string) => void;
  prepareForNavigation?: () => Promise<void>;
}

export function PlatformSignInLink({
  children,
  className,
  href,
  navigate = navigateToPlatformAuth,
  prepareForNavigation = releaseServiceWorkersForPlatformAuth,
}: PlatformSignInLinkProps) {
  const [opening, setOpening] = useState(false);

  const openChatGpt = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (opening) return;
    setOpening(true);
    void prepareForNavigation()
      .catch(() => undefined)
      .then(() => { navigate(href); });
  };

  return (
    <a aria-busy={opening} className={className} href={href} onClick={openChatGpt}>
      {opening ? 'Opening ChatGPT…' : children}
    </a>
  );
}
