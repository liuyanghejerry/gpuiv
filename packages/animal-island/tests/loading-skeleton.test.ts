import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Loading } from '../src/components/Loading.js';
import { Modal } from '../src/components/Modal.js';
import { Skeleton, SkeletonAvatar, SkeletonButton, SkeletonInput } from '../src/components/Skeleton.js';
import { mountHost } from './harness.js';

const cleanups: (() => void)[] = [];
function mount(component: Parameters<typeof mountHost>[0], overrides: Parameters<typeof mountHost>[1] = {}) {
    const app = mountHost(component, overrides);
    cleanups.push(app.unmount);
    return app;
}
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); });
const flake = (app: ReturnType<typeof mountHost>) => app.find(node => {
    const style = node.props.style as { position?: string; width?: number; backgroundColor?: string } | undefined;
    return style?.position === 'absolute' && typeof style.width === 'number' && style.width <= 6 && style.backgroundColor === '#fff';
});

describe('Loading snowfall lifecycle', () => {
    it('covers deferred dialogs and releases its occluder while fading out', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent(() => () => [h(Modal, { open: true, typewriter: false }), h(Loading, { active: active.value })]));
        const layer = app.find(node => node.type === 'anchored' && node.props.priority === 3000);
        expect(layer.props.deferred).toBe(true);
        expect(layer.props.occlude).toBe(true);
        await vi.advanceTimersByTimeAsync(240);
        expect(layer.props.style).toMatchObject({ opacity: 1 });
        active.value = false;
        await app.settle();
        expect(layer.props.occlude).toBe(false);
        expect(layer.props.style).toMatchObject({ pointerEvents: 'none' });
    });
    it('animates the default initially active snowfall and clears timers on unmount', async () => {
        vi.useFakeTimers();
        const app = mount(defineComponent({ setup: () => () => h(Loading, { testId: 'loading' }) }));
        await app.settle();
        const before = (flake(app).props.style as { top: number }).top;
        await vi.advanceTimersByTimeAsync(80);
        await app.settle();
        expect((flake(app).props.style as { top: number }).top).not.toBe(before);
        app.unmount();
        cleanups.pop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('cancels a delayed show when active becomes false before the delay', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(Loading, { active: active.value, delay: 100, tip: 'Delayed' }) }));
        await vi.advanceTimersByTimeAsync(50);
        active.value = false;
        await app.settle();
        await vi.advanceTimersByTimeAsync(100);
        expect(app.text()).not.toContain('Delayed');
    });
    it('keeps VNode tips and survives reactivation during fade-out', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(Loading, { active: active.value, fadeDuration: 0.1, tip: h('text', 'Rich tip'), testId: 'loading' }) }));
        expect(app.text()).toContain('Rich tip');
        active.value = false;
        await app.settle();
        expect(app.find('loading').props.style).toMatchObject({ pointerEvents: 'none' });
        for (const node of app.all()) {
            const style = node.props.style as { backgroundColor?: string; pointerEvents?: string } | undefined;
            if (style?.backgroundColor) expect(style.pointerEvents).toBe('none');
        }
        await vi.advanceTimersByTimeAsync(50);
        active.value = true;
        await app.settle();
        await vi.advanceTimersByTimeAsync(100);
        expect(app.text()).toContain('Rich tip');
        expect((app.find('loading').props.style as { pointerEvents?: string }).pointerEvents).toBe('auto');
    });
});

describe('Skeleton public helpers', () => {
    it('shares width polling without emitting JS animation-frame mutations', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        let width = 200;
        const app = mount(defineComponent(() => () => h('div', [0, 1, 2, 3, 4].map(index =>
            h(Skeleton, { key: index, active: active.value, testId: `skeleton-${index}` })
        ))), { getElementBounds: () => ({ x: 0, y: 0, width, height: 40 }) });
        await app.settle();
        expect(vi.getTimerCount()).toBe(1);
        for (const index of [0, 1, 2, 3, 4]) expect(app.find(`skeleton-${index}-shimmer`).props.motion).toMatchObject({
            initial: { left: -200 }, animate: { left: 200 }, transition: { duration: 1.6, ease: 'easeInOut' },
        });
        const apply = vi.spyOn(app.native, 'applyBatch');
        try {
            await vi.advanceTimersByTimeAsync(800);
            await app.settle();
            expect(apply).not.toHaveBeenCalled();
            width = 320;
            await vi.advanceTimersByTimeAsync(100);
            await app.settle();
            expect(apply).toHaveBeenCalledOnce();
            expect(app.find('skeleton-0-shimmer').props.motion).toMatchObject({ initial: { left: -320 }, animate: { left: 320 } });
            active.value = false;
            await app.settle();
            expect(vi.getTimerCount()).toBe(0);
            expect(app.all().some(node => String(node.props.testId).endsWith('-shimmer'))).toBe(false);
            apply.mockClear();
            await vi.advanceTimersByTimeAsync(200);
            await app.settle();
            expect(apply).not.toHaveBeenCalled();
        } finally { apply.mockRestore(); }
    });
    it('repeats independently on native completion and resets on reactivation/reloading', async () => {
        vi.useFakeTimers();
        const secondActive = ref(false), secondLoading = ref(true);
        const app = mount(defineComponent(() => () => h('div', [
            h(Skeleton, { testId: 'first' }),
            h(Skeleton, { testId: 'second', active: secondActive.value, loading: secondLoading.value }, () => h('text', 'loaded second')),
        ])));
        await app.settle();
        const first = app.find('first-shimmer');
        await app.fire(first, 'motionComplete', { motionGeneration: 99 });
        expect(app.find('first-shimmer').id).toBe(first.id);
        await app.fire(first, 'motionComplete', { motionGeneration: 1 });
        expect(app.find('first-shimmer').id).not.toBe(first.id);
        expect(app.find('first-shimmer').props.motion).toMatchObject({ generation: 2 });
        secondActive.value = true;
        await app.settle();
        expect(app.find('second-shimmer').props.motion).toMatchObject({ generation: 1 });
        expect(app.find('first-shimmer').props.motion).toMatchObject({ generation: 2 });
        await app.fire('second-shimmer', 'motionComplete', { motionGeneration: 1 });
        expect(app.find('second-shimmer').props.motion).toMatchObject({ generation: 2 });
        secondActive.value = false;
        await app.settle();
        expect(vi.getTimerCount()).toBe(1);
        secondActive.value = true;
        await app.settle();
        expect(app.find('second-shimmer').props.motion).toMatchObject({ generation: 1 });
        secondLoading.value = false;
        await app.settle();
        expect(app.text()).toContain('loaded second');
        secondLoading.value = true;
        await app.settle();
        expect(app.find('second-shimmer').props.motion).toMatchObject({ generation: 1 });
        app.unmount(); cleanups.pop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('waits for painted positive bounds before starting the band', async () => {
        vi.useFakeTimers();
        let width = 0;
        const app = mount(defineComponent(() => () => h(Skeleton, { testId: 'waiting' })), {
            getElementBounds: () => ({ x: 0, y: 0, width, height: 40 }),
        });
        await app.settle();
        expect(app.all().some(node => node.props.testId === 'waiting-shimmer')).toBe(false);
        width = 180;
        await vi.advanceTimersByTimeAsync(100);
        await app.settle();
        expect(app.find('waiting-shimmer').props.motion).toMatchObject({ initial: { left: -180 }, animate: { left: 180 } });
    });
    it.each([
        [SkeletonButton, 'small', 80, 32, 50],
        [SkeletonButton, 'middle', 100, 45, 50],
        [SkeletonButton, 'large', 130, 48, 50],
        [SkeletonInput, 'small', 160, 32, 50],
        [SkeletonInput, 'middle', 200, 40, 50],
        [SkeletonInput, 'large', 240, 48, 50],
        [SkeletonAvatar, 'small', 32, 32, 999],
        [SkeletonAvatar, 'middle', 44, 44, 999],
        [SkeletonAvatar, 'large', 56, 56, 999],
    ] as const)('preserves original %s %s size', (component, size, width, height, borderRadius) => {
        const app = mount(defineComponent({ setup: () => () => h(component, { size, active: false, testId: 'helper' }) }));
        expect(app.find('helper').props.style).toMatchObject({ width, height, borderRadius, opacity: 1 });
    });
    it('keeps square avatars and consumer style overrides', () => {
        const app = mount(defineComponent({ setup: () => () => h(SkeletonAvatar, { shape: 'square', active: false, testId: 'avatar', style: { width: 64 } }) }));
        expect(app.find('avatar').props.style).toMatchObject({ width: 64, height: 44, borderRadius: 12 });
    });
    it('runs and stops helper animation as active changes', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(SkeletonInput, { active: active.value, testId: 'input' }) }));
        await vi.advanceTimersByTimeAsync(100);
        await app.settle();
        expect(app.find('input-shimmer').props.motion).toMatchObject({ animate: { left: 600 } });
        active.value = false;
        await app.settle();
        expect(app.find('input').props.style).toMatchObject({ opacity: 1 });
        expect(vi.getTimerCount()).toBe(0);
    });
    it('switches normal Skeleton loading to slot content and retains paragraph widths', async () => {
        vi.useFakeTimers();
        const loading = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(Skeleton, { loading: loading.value, variant: 'paragraph', rows: 3, rowWidths: [100, '50%'], testId: 'paragraph' }, () => h('text', 'Loaded content')) }));
        expect(app.find('paragraph').children.filter(node => (node.props.style as { backgroundColor?: string })?.backgroundColor === '#dfd9ce').map(node => (node.props.style as { width: unknown }).width)).toEqual([100, '50%', '50%']);
        loading.value = false;
        await app.settle();
        expect(app.text()).toContain('Loaded content');
        expect(vi.getTimerCount()).toBe(0);
    });
});
