import { combineUrlAndPath } from '@scalar/helpers/url/merge-urls'
import type { ApiReferenceConfiguration } from '@scalar/types/api-reference'
import type { Heading } from '@scalar/types/legacy'
import { type InjectionKey, type MaybeRefOrGetter, type Ref, inject, ref, toValue } from 'vue'

export type NavState = {
  /** The URL hash without the #, also the "hash" pulled from pathRouting */
  hash: Ref<string>
  /** Whether the intersection observer is enabled and updating the hash as we scroll */
  isIntersectionEnabled: Ref<boolean>
  basePath: MaybeRefOrGetter<string | undefined>
  generateHeadingSlug: MaybeRefOrGetter<ApiReferenceConfiguration['generateHeadingSlug']>
}
export const NAV_STATE_SYMBOL = Symbol() as InjectionKey<NavState>

/** We inject a backup global refs in case one isn't provided for any integrations not using ApiReference */
const isIntersectionEnabledBackup = ref(false)
const hashBackup = ref('')

/**
 * Hook which provides reactive hash state from the URL
 * Also hash is only readable by the client so keep that in mind for SSR
 *
 * isIntersectionEnabled is a hack to prevent intersection observer from triggering
 * when clicking on sidebar links or going backwards
 *
 */
export const useNavState = () => {
  const { isIntersectionEnabled, hash, basePath, generateHeadingSlug } = inject(NAV_STATE_SYMBOL, {
    isIntersectionEnabled: isIntersectionEnabledBackup,
    hash: hashBackup,
    basePath: undefined,
    generateHeadingSlug: undefined,
  })

  const getPathRoutingId = (pathName: string) => {
    if (!toValue(basePath)) {
      return ''
    }

    const reggy = new RegExp('^' + toValue(basePath) + '/?')
    return decodeURIComponent(pathName.replace(reggy, ''))
  }

  /**
   * Gets the portion of the hash or path used by the references
   *
   * @returns The id without the prefix
   */
  const getReferenceId = () =>
    toValue(basePath)
      ? getPathRoutingId(window.location.pathname)
      : // Must remove the prefix from the hash as the internal hash value should be pure
        decodeURIComponent(window.location.hash.replace(/^#/, ''))

  // Update the reactive hash state
  const updateHash = () => (hash.value = getReferenceId())

  const replaceUrlState = (replacementHash: string, url = window.location.href) => {
    const newUrl = new URL(url)

    const base = toValue(basePath)
    // If we are pathrouting, set path instead of hash
    if (typeof base === 'string') {
      newUrl.pathname = combineUrlAndPath(base, replacementHash)
    } else {
      newUrl.hash = replacementHash
    }

    // Update the hash ref
    hash.value = replacementHash

    // We use replaceState so we don't trigger the url hash watcher and trigger a scroll
    // this is why we set the hash value directly
    window.history.replaceState({}, '', newUrl)
  }

  const getHashedUrl = (replacementHash: string, url = window.location.href, search = window.location.search) => {
    const newUrl = new URL(url)

    const base = toValue(basePath)
    // Path routing
    if (typeof base === 'string') {
      newUrl.pathname = combineUrlAndPath(base, replacementHash)
    }
    // Hash routing
    else {
      newUrl.hash = replacementHash
    }
    newUrl.search = search
    return newUrl.toString()
  }

  /**
   * ID creation methods
   */
  const getHeadingId = (heading: Heading) => {
    const slugGenerator = toValue(generateHeadingSlug)

    if (typeof slugGenerator === 'function') {
      return `${slugGenerator(heading)}`
    }

    if (heading.slug) {
      return `description/${heading.slug}`
    }
    return ''
  }

  return {
    hash,
    /**
     * Gets the hashed url with the prefix
     * @param replacementHash The hash to replace the current hash with
     * @param url The url to get the hashed url from
     * @returns The hashed url
     */
    getHashedUrl,
    /**
     * Replaces the URL state with the new url and hash
     * Replacement is used so that hash changes don't trigger the url hash watcher and cause a scroll
     */
    replaceUrlState,
    getReferenceId,
    getHeadingId,
    getPathRoutingId,
    isIntersectionEnabled,
    updateHash,
  }
}

/** Whats returned from the hook */
export type UseNavState = ReturnType<typeof useNavState>
