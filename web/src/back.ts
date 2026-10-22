import { useEffect, useRef } from 'react';

// Back (the browser's, a phone's, a mouse's) closes whatever is on top first (a sheet, a panel, a menu, the
// video picker) and only then goes to the previous screen. Each open layer adds a step to the history;
// closing it by hand takes that step back off.
const stack: { close: () => void; id: number }[] = [];
let ids = 0;
let ignorePop = 0;

window.addEventListener('popstate', e => {
    if (ignorePop > 0) { ignorePop--; e.stopImmediatePropagation(); return; }
    const top = stack.pop();
    if (top) { e.stopImmediatePropagation(); top.close(); }
}, true); // before the app's own handler, so a layer's step never changes the screen

/** While `open` is true, Back calls `close` instead of leaving the screen. */
export function useBackClose(open: boolean, close: () => void) {
    const closeRef = useRef(close);
    closeRef.current = close;
    useEffect(() => {
        if (!open) return;
        const id = ++ids;
        stack.push({ id, close: () => closeRef.current() });
        history.pushState({ ...(history.state || {}), layer: id }, '', location.href);
        return () => {
            const i = stack.findIndex(x => x.id === id);
            if (i >= 0) {
                // Closed by hand (or the screen went away): take its history step back off, quietly.
                stack.splice(i, 1);
                if (history.state && history.state.layer === id) { ignorePop++; history.back(); }
            }
        };
    }, [open]);
}
