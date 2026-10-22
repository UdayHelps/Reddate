import { createContext } from 'react';
import type { Meta } from './util';
/** Inside the "change video" picker, a poster picks a title here instead of opening a page. */
export const PickCtx = createContext<((m: Meta) => void) | null>(null);
