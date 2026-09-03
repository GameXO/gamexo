import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import logoMark from '@/assests/logo-mark.svg';
import { appName } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <img src={logoMark.src} alt="" className="size-6 rounded-md" />
          {appName}
        </>
      ),
    },
  };
}
