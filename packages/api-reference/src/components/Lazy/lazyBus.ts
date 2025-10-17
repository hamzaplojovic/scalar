import { type EventBusKey, useEventBus } from '@vueuse/core'
import { ref } from 'vue'

/** Event payload for the lazy bus */
export type LazyEvent = { loading?: string; loaded?: string; save: boolean }

/** Keep track of which elements are loading and which have loaded */
const lazyEventBusKey: EventBusKey<LazyEvent> = Symbol()

/** All aboard the lazy bus! */
export const lazyBus = useEventBus<LazyEvent>(lazyEventBusKey)

/** Ensure we only lazy load once per page load */
export const hasLazyLoaded = ref(false)

/**
 * Resolves to true when the given ID has been loaded,
 * or false if it hasn't loaded within the timeout.
 * @param id - The ID to wait for.
 * @param timeoutMs - Timeout in milliseconds; defaults to 5000ms.
 */
export function waitForLazyLoaded(id: string, timeoutMs = 5000): Promise<boolean> {
  let unsubscribe: () => void = () => null

  return Promise.race([
    new Promise<boolean>((resolve) => {
      unsubscribe = lazyBus.on((ev) => {
        if (ev.loaded === id) {
          unsubscribe()
          resolve(true)
        }
      })
    }),
    new Promise<boolean>((resolve) =>
      setTimeout(() => {
        unsubscribe() // always unsubscribe the listener
        resolve(false)
      }, timeoutMs),
    ),
  ])
}
