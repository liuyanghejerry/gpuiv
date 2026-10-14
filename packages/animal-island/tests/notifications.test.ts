import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { Notification, NotificationContainer, notificationStore } from '../src/components/Notification.js';
import { mountHost } from './harness.js';

const cleanups: (() => void)[] = [];
function mount() {
    const app = mountHost(defineComponent({ setup: () => () => h(NotificationContainer) }));
    cleanups.push(app.unmount);
    return app;
}
afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    Notification.destroy();
    vi.useRealTimers();
});

describe('Notification lifecycle through native mutation/event protocol', () => {
    it('keeps the last notification mounted until its current native exit completes', async () => {
        const app = mount();
        const closed = vi.fn();
        Notification.success({ message: 'Last card', key: 'last', duration: 0, onClose: closed });
        await app.settle();
        const entered = app.find(node => (node.props.motion as { animate?: { opacity?: number } } | undefined)?.animate?.opacity === 1);
        const enterGeneration = (entered.props.motion as { generation: number }).generation;
        await app.fire(app.find(node => node.props['aria-label'] === 'close'), 'click');
        expect(notificationStore.items).toHaveLength(0);
        expect(closed).toHaveBeenCalledOnce();
        expect(app.text()).toContain('Last card');
        const exiting = app.find(node => (node.props.motion as { isExit?: boolean } | undefined)?.isExit === true);
        await app.fire(exiting, 'motionComplete', { motionGeneration: enterGeneration });
        expect(app.text()).toContain('Last card');
        await app.fire(exiting, 'motionComplete', { motionGeneration: (exiting.props.motion as { generation: number }).generation });
        expect(app.text()).not.toContain('Last card');
    });
    it('cancels destroyed cards timers and cannot invoke onClose twice during exit', async () => {
        vi.useFakeTimers();
        const app = mount();
        const closed = vi.fn();
        Notification.info({ message: 'Expired soon', key: 'old', duration: 0.1, onClose: closed });
        Notification.info({ message: 'Keep group alive', key: 'keep', duration: 0 });
        await app.settle();
        Notification.destroy('old');
        await app.settle();
        expect(closed).toHaveBeenCalledOnce();
        expect(app.text()).toContain('Expired soon');
        await vi.advanceTimersByTimeAsync(200);
        await app.settle();
        expect(closed).toHaveBeenCalledOnce();
        const exiting = app.find(node => (node.props.motion as { isExit?: boolean } | undefined)?.isExit === true);
        const close = exiting.children.flatMap(node => [node, ...node.children]).find(node => node.props['aria-label'] === 'close');
        if (close) await app.fire(close, 'click');
        expect(closed).toHaveBeenCalledOnce();
    });
    it('does not double-close even if destroy happens before a queued timer is patched', async () => {
        vi.useFakeTimers();
        const app = mount();
        const closed = vi.fn();
        Notification.open({ message: 'Queued', key: 'queued', duration: 0.01, onClose: closed });
        await app.settle();
        Notification.destroy('queued');
        vi.advanceTimersByTime(20);
        await app.settle();
        expect(closed).toHaveBeenCalledOnce();
        expect(notificationStore.items).toHaveLength(0);
    });
    it('auto-closes once and releases after exit completion', async () => {
        vi.useFakeTimers();
        const app = mount();
        const closed = vi.fn();
        Notification.warning({ message: 'Automatic', duration: 0.1, onClose: closed });
        await app.settle();
        await vi.advanceTimersByTimeAsync(100);
        await app.settle();
        expect(closed).toHaveBeenCalledOnce();
        expect(notificationStore.items).toHaveLength(0);
        expect(app.text()).toContain('Automatic');
        const exiting = app.find(node => (node.props.motion as { isExit?: boolean } | undefined)?.isExit === true);
        await app.fire(exiting, 'motionComplete', { motionGeneration: (exiting.props.motion as { generation: number }).generation });
        expect(app.text()).not.toContain('Automatic');
        await vi.advanceTimersByTimeAsync(1000);
        expect(closed).toHaveBeenCalledOnce();
    });
    it('updates an existing key and restarts timeout from the updated duration', async () => {
        vi.useFakeTimers();
        const app = mount();
        const oldClosed = vi.fn();
        const newClosed = vi.fn();
        Notification.open({ message: 'Old', key: 'same', duration: 1, onClose: oldClosed });
        await app.settle();
        await vi.advanceTimersByTimeAsync(500);
        Notification.open({ message: 'New', key: 'same', duration: 2, onClose: newClosed });
        await app.settle();
        expect(notificationStore.items).toHaveLength(1);
        expect(app.text()).toContain('New');
        await vi.advanceTimersByTimeAsync(501);
        expect(newClosed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1500);
        await app.settle();
        expect(newClosed).toHaveBeenCalledOnce();
        expect(oldClosed).not.toHaveBeenCalled();
    });
    it('preserves six placements and reverses bottom ordering', async () => {
        const app = mount();
        Notification.open({ message: 'First bottom', position: 'bottom', duration: 0 });
        Notification.open({ message: 'Latest bottom', position: 'bottom', duration: 0 });
        Notification.open({ message: 'Right top', position: 'topRight', duration: 0 });
        await app.settle();
        expect(app.text().indexOf('Latest bottom')).toBeLessThan(app.text().indexOf('First bottom'));
        expect(notificationStore.items.map(item => item.placement)).toEqual(['bottom', 'bottom', 'top']);
        expect(app.all().filter(node => (node.props.style as { position?: string; gap?: number } | undefined)?.position === 'absolute' && (node.props.style as { gap?: number }).gap === 12)).toHaveLength(6);
    });
    it('keeps clickable cards and close controls keyboard-accessible', async () => {
        const app = mount();
        const clicked = vi.fn();
        const closed = vi.fn();
        Notification.error({ message: 'Keyboard card', duration: 0, onClick: clicked, onClose: closed });
        await app.settle();
        const card = app.find(node => node.props.role === 'button' && node.props['aria-label'] !== 'close');
        await app.fire(card, 'keyDown', { key: 'enter' });
        expect(clicked).toHaveBeenCalledOnce();
        await app.fire(app.find(node => node.props['aria-label'] === 'close'), 'keyDown', { key: ' ' });
        expect(closed).toHaveBeenCalledOnce();
        expect(clicked).toHaveBeenCalledOnce();
    });
    it('clears per-entry timeout ownership when the container unmounts', async () => {
        vi.useFakeTimers();
        const app = mount();
        const closed = vi.fn();
        Notification.open({ message: 'Unmounting', duration: 0.1, onClose: closed });
        await app.settle();
        app.unmount();
        cleanups.pop();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(200);
        expect(closed).not.toHaveBeenCalled();
    });
});
