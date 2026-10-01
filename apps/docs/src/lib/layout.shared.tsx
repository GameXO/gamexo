import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { asset } from '@/lib/asset';
import { appName } from './shared';

const logoMark = asset('brand/logo-mark.svg');

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <img src={logoMark} alt="" className="size-6 rounded-md" />
          {appName}
        </>
      ),
    },
  };
}
