<script setup lang="ts">
import { provideUseId } from '@headlessui/vue'
import { OpenApiClientButton } from '@scalar/api-client/components'
import { LAYOUT_SYMBOL } from '@scalar/api-client/hooks'
import {
  addScalarClassesToHeadless,
  ScalarColorModeToggleButton,
  ScalarColorModeToggleIcon,
  ScalarSidebarFooter,
} from '@scalar/components'
import { scrollToId } from '@scalar/helpers/dom/scroll-to-id'
import { sleep } from '@scalar/helpers/testing/sleep'
import type { Server } from '@scalar/oas-utils/entities/spec'
import { combineUrlAndPath } from '@scalar/oas-utils/helpers'
import { ScalarSidebar, type SidebarState } from '@scalar/sidebar'
import {
  getThemeStyles,
  hasObtrusiveScrollbars,
  type ThemeId,
} from '@scalar/themes'
import type { ApiReferenceConfigurationRaw } from '@scalar/types'
import { useBreakpoints } from '@scalar/use-hooks/useBreakpoints'
import { useClipboard } from '@scalar/use-hooks/useClipboard'
import { ScalarToasts } from '@scalar/use-toasts'
import type {
  TraversedEntry,
  TraversedTag,
} from '@scalar/workspace-store/schemas/navigation'
import type {
  Workspace,
  WorkspaceDocument,
} from '@scalar/workspace-store/schemas/workspace'
import { useDebounceFn, useResizeObserver } from '@vueuse/core'
import {
  computed,
  nextTick,
  onBeforeMount,
  onMounted,
  onUnmounted,
  provide,
  ref,
  useId,
  watch,
  watchEffect,
} from 'vue'

import ClassicHeader from '@/components/ClassicHeader.vue'
import { Content } from '@/components/Content'
import GettingStarted from '@/components/GettingStarted.vue'
import { hasLazyLoaded, lazyBus } from '@/components/Lazy/lazyBus'
import { useFreezing } from '@/components/Lazy/useFreezing'
import MobileHeader from '@/components/MobileHeader.vue'
import { SearchButton } from '@/features/Search'
import { createPluginManager, PLUGIN_MANAGER_SYMBOL } from '@/plugins'
import type { ReferenceLayoutSlot, ReferenceSlotProps } from '@/types'
import type { SecuritySchemeGetter } from '@/v2/helpers/map-config-to-client-store'

// ---------------------------------------------------------------------------
// Vue Macros

const {
  slug,
  configuration,
  document,
  isDark,
  sidebarState: _sidebarState,
  hash,
} = defineProps<{
  hash: string
  slug: string
  configuration: ApiReferenceConfigurationRaw
  document: WorkspaceDocument | undefined
  activeServer: Server | undefined
  getSecuritySchemes: SecuritySchemeGetter
  xScalarDefaultClient: Workspace['x-scalar-default-client']
  isDark: boolean
  isDevelopment: boolean
  url?: string
  sidebarState: () => SidebarState<TraversedEntry>
}>()

defineEmits<{
  (e: 'changeTheme', { id, label }: { id: ThemeId; label: string }): void
  (e: 'updateContent', value: string): void
  (e: 'loadSwaggerFile'): void
  (e: 'linkSwaggerFile'): void
  (e: 'toggleDarkMode'): void
}>()

defineOptions({
  inheritAttrs: false,
})

defineSlots<
  {
    [x in ReferenceLayoutSlot]: (props: ReferenceSlotProps) => any
  } & { 'document-selector': never } & { 'client-modal': never }
>()

const sidebarState = _sidebarState()

/** We get the sub items for the sidebar based on the configuration/document slug */
const sidebarItems = computed<TraversedEntry[]>(
  () =>
    sidebarState.items.value.find(
      (item): item is TraversedTag => item.id === slug,
    )?.children ?? [],
)

const isSidebarOpen = ref(false)

const scrollTo = (id: string) => {
  const element = window.document.getElementById(id)
  console.log('scrollTo', id, element)
  if (element) {
    element.scrollIntoView({
      block: 'start',
    })
  }
}

/**
 * Find the sidebar entry that represents the introduction section
 */
const infoSectionId = computed(
  () =>
    sidebarItems.value.find(
      (item) => item.type === 'text' && item.title === 'Introduction',
    )?.id,
)

/**
 * Scroll to operation
 *
 * Similar to scrollToId BUT in the case of a section not being open,
 * it uses the lazyBus to ensure the section is open before scrolling to it
 */
const scrollToOperation = (operationId: string, focus?: boolean) => {
  const sectionId = sidebarState.getEntryById(operationId)?.parent?.id

  if (sectionId && sectionId !== operationId) {
    // We use the lazyBus to check when the target has loaded then scroll to it
    if (!sidebarState.isExpanded(sectionId)) {
      const unsubscribe = lazyBus.on((ev) => {
        if (ev.loaded === operationId) {
          scrollTo(operationId)
          unsubscribe()
        }
      })
      sidebarState.setExpanded(sectionId, true)
    } else {
      scrollTo(operationId)
    }
  }
}

/**
 * Depending on the item type we handle a selection event differently:
 *
 * - Tag: If a tag is closed we open it and all its parents and scroll to it
 *        If a tag is open we just close the tag
 * - Operation:
 *        Open all parents and scroll to the operation
 */
const handleSelectItem = async (id: string) => {
  const item = sidebarState.getEntryById(id)
  console.log('handleSelectItem', id, item)

  /** Recursively open all parents of the given item */
  function openParents(currentId: string) {
    const parent = sidebarState.getEntryById(currentId)?.parent
    if (parent) {
      sidebarState.setExpanded(parent.id, true)
      openParents(parent.id)
    }
  }

  if (item?.type === 'tag') {
    const isOpen = sidebarState.isExpanded(id)
    if (isOpen) {
      sidebarState.setExpanded(id, false)
    } else {
      console.log('openParents', id)
      sidebarState.setExpanded(id, true)
      openParents(id)
      await nextTick()
      scrollTo(id)
    }
  }

  if (
    item?.type === 'operation' ||
    item?.type === 'webhook' ||
    item?.type === 'model' ||
    item?.type === 'example' ||
    item?.type === 'text'
  ) {
    sidebarState.setExpanded(id, true)
    openParents(id)
    scrollToOperation(id)
  }
}

const handleToggleTag = (id: string, open: boolean) => {
  sidebarState.setExpanded(id, open)
  console.log('handleToggleTag', id, open, sidebarState.isExpanded(id))
}

const handleToggleSchema = (id: string, open: boolean) => {
  sidebarState.setExpanded(id, open)
  console.log('handleToggleSchema', id, open, sidebarState.isExpanded(id))
}

const handleToggleOperation = (id: string, open: boolean) => {
  sidebarState.setExpanded(id, open)
  console.log('handleToggleOperation', id, open, sidebarState.isExpanded(id))
}
// ---------------------------------------------------------------------------
// Date injection for global state

/**
 * Due to a bug in headless UI, we need to set an ID here that can be shared across server/client
 * TODO remove this once the bug is fixed
 *
 * @see https://github.com/tailwindlabs/headlessui/issues/2979
 */
provideUseId(() => useId())

// Provide the client layout
provide(LAYOUT_SYMBOL, 'modal')

provide(
  PLUGIN_MANAGER_SYMBOL,
  createPluginManager({
    plugins: configuration.plugins,
  }),
)

// ---------------------------------------------------------------------------
// Sync sidebar to active document

// const { isSidebarOpen, setCollapsedSidebarItem, scrollToOperation, items } =

// useFreezing()

/** This is passed into all of the slots so they have access to the references data */
const breadcrumb = computed(() => sidebarState.getEntryById(hash)?.title ?? '')

const referenceSlotProps = computed<ReferenceSlotProps>(() => ({
  breadcrumb: breadcrumb.value,
}))

// Check for Obtrusive Scrollbars
const obtrusiveScrollbars = computed(hasObtrusiveScrollbars)

const { copyToClipboard } = useClipboard()

const getHashedUrl = (
  replacementHash: string,
  url = window.location.href,
  search = window.location.search,
) => {
  const newUrl = new URL(url)

  const base = configuration.pathRouting?.basePath
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

/** Ensure we copy the hash OR path if pathRouting is enabled */
const handleCopyAnchorUrl = (id: string) => {
  console.log('handleCopyAnchorUrl', id)
  return copyToClipboard(getHashedUrl(id))
}

const handleIntersecting = (id: string) => {
  console.log('handleIntersecting', id)
}
// ---------------------------------------------------------------------------
// Scroll management

// Front-end redirect
if (configuration.redirect && typeof window !== 'undefined') {
  const newPath = configuration.redirect(
    (configuration.pathRouting ? window.location.pathname : '') +
      window.location.hash,
  )
  if (newPath) {
    history.replaceState({}, '', newPath)
  }
}

onBeforeMount(() => {
  // Ideally this triggers absolutely first on the client so we can set hash value
  // updateHash()

  // Ensure we add our scalar wrapper class to the headless ui root, mounted is too late
  addScalarClassesToHeadless()
})

// Disables intersection observer and scrolls to section once it has been opened
// const scrollToSection = async (id?: string) => {
//   isIntersectionEnabled.value = false
//   updateHash()

//   if (id) {
//     scrollToOperation(id)
//   } else {
//     documentEl.value?.scrollTo(0, 0)
//   }

//   await sleep(100)
//   isIntersectionEnabled.value = true
// }

// onMounted(() => {
//   // Prevent the browser from restoring scroll position on refresh
//   history.scrollRestoration = 'manual'

//   // This is what updates the hash ref from hash changes
//   window.onhashchange = () => scrollToSection(getReferenceId())

//   // Handle back for path routing
//   window.onpopstate = () =>
//     configuration.pathRouting &&
//     scrollToSection(getPathRoutingId(window.location.pathname))

//   // Add window scroll listener
//   window.addEventListener('scroll', debouncedScroll, { passive: true })
// })

// // To clear hash when scrolled to the top
// const debouncedScroll = useDebounceFn(() => {
//   if (window.scrollY < 50 && hasLazyLoaded.value) {
//     replaceUrlState('')
//   }
// })

// onUnmounted(() => {
//   // Remove window scroll listener
//   window.removeEventListener('scroll', debouncedScroll)
// })

// Open a sidebar tag
// watch(
//   () => document,
//   () => {
//     // Scroll to given hash
//     if (hash.value) {
//       const entry = sidebarState.getEntryById(hash.value)
//       const hashSectionId = entry?.parent?.id ?? entry?.id
//       if (hashSectionId) {
//         sidebarState.setExpanded(hashSectionId, true)
//       }
//     }
//     // Open the first tag if no hash is present
//     else {
//       const firstTag = sidebarItems.value.find((item) => item.type === 'tag')
//       if (firstTag) {
//         sidebarState.setExpanded(firstTag.id, true)
//       }
//     }
//   },
// )

// ---------------------------------------------------------------------------

const themeStyleTag = computed(
  () => `<style>
  ${getThemeStyles(configuration.theme, {
    fonts: configuration.withDefaultFonts,
  })}</style>`,
)

// ---------------------------------------------------------------------------
// TODO: Code below is copied from ModernLayout.vue. Find a better location for this.

const { mediaQueries } = useBreakpoints()

watch(mediaQueries.lg, (newValue, oldValue) => {
  // Close the drawer when we go from desktop to mobile
  if (oldValue && !newValue) {
    isSidebarOpen.value = false
  }
})

watch(
  () => hash,
  (newHash, oldHash) => {
    if (newHash && newHash !== oldHash) {
      isSidebarOpen.value = false
    }
  },
)

// ---------------------------------------------------------------------------
</script>
<template>
  <div v-html="themeStyleTag" />
  <div
    ref="documentEl"
    class="scalar-app scalar-api-reference references-layout"
    :class="[
      {
        'scalar-api-references-standalone-mobile': configuration.showSidebar,
        'scalar-scrollbars-obtrusive': obtrusiveScrollbars,
        'references-editable': configuration.isEditable,
        'references-sidebar': configuration.showSidebar,
        'references-sidebar-mobile-open': isSidebarOpen,
        'references-classic': configuration.layout === 'classic',
      },
      $attrs.class,
    ]">
    <!-- Header -->
    <div class="references-header">
      <MobileHeader
        v-if="configuration.layout === 'modern' && configuration.showSidebar"
        :breadcrumb="referenceSlotProps.breadcrumb"
        :isSidebarOpen="isSidebarOpen"
        @toggleSidebar="() => (isSidebarOpen = !isSidebarOpen)" />
      <slot
        v-bind="referenceSlotProps"
        name="header" />
    </div>
    <!-- Navigation (sidebar) wrapper -->

    <ScalarSidebar
      v-if="configuration.showSidebar && configuration.layout === 'modern'"
      :aria-label="`Sidebar for ${document?.info?.title}`"
      class="sidebar references-navigation t-doc__sidebar sticky top-0 h-dvh"
      :isExpanded="sidebarState.isExpanded"
      :isSelected="sidebarState.isSelected"
      :items="sidebarItems"
      layout="reference"
      :options="{
        operationTitleSource: configuration.operationTitleSource,
      }"
      @selectItem="(id) => handleSelectItem(id)">
      <template #header>
        <!-- Wrap in a div when slot is filled -->
        <slot name="document-selector" />

        <!-- Search -->
        <div
          v-if="!configuration.hideSearch"
          class="scalar-api-references-standalone-search">
          <SearchButton
            :document="document"
            :hideModels="configuration?.hideModels"
            :items="sidebarItems"
            :searchHotKey="configuration?.searchHotKey"
            @toggleSidebarItem="(id) => handleSelectItem(id)" />
        </div>
        <!-- Sidebar Start -->
        <slot
          name="sidebar-start"
          v-bind="referenceSlotProps" />
      </template>
      <template #footer>
        <slot
          v-bind="referenceSlotProps"
          name="sidebar-end">
          <ScalarSidebarFooter class="darklight-reference">
            <OpenApiClientButton
              v-if="!configuration.hideClientButton"
              buttonSource="sidebar"
              :integration="configuration._integration"
              :isDevelopment="isDevelopment"
              :url="url" />
            <!-- Override the dark mode toggle slot to hide it -->
            <template #toggle>
              <ScalarColorModeToggleButton
                v-if="!configuration.hideDarkModeToggle"
                :modelValue="isDark"
                @update:modelValue="$emit('toggleDarkMode')" />
              <span v-else />
            </template>
          </ScalarSidebarFooter>
        </slot>
      </template>
    </ScalarSidebar>

    <!-- Slot for an Editor -->
    <div
      v-show="configuration.isEditable"
      class="references-editor">
      <div class="references-editor-textarea">
        <slot
          v-bind="referenceSlotProps"
          name="editor" />
      </div>
    </div>
    <!-- The Content -->

    <main
      :aria-label="`Open API Documentation for ${document?.info?.title}`"
      class="references-rendered">
      <Content
        :activeServer="activeServer"
        :document="document"
        :expandedItems="sidebarState.expandedItems.value"
        :getSecuritySchemes="getSecuritySchemes"
        :infoSectionId="infoSectionId ?? 'description/asd'"
        :items="sidebarItems"
        :options="{
          headingSlugGenerator:
            configuration.generateHeadingSlug ??
            ((heading) => `description/${heading.slug}`),
          slug: configuration.slug,
          hiddenClients: configuration.hiddenClients,
          layout: configuration.layout,
          persistAuth: configuration.persistAuth,
          showOperationId: configuration.showOperationId,
          hideTestRequestButton: configuration.hideTestRequestButton,
          expandAllResponses: configuration.expandAllResponses,
          hideModels: configuration.hideModels,
          expandAllModelSections: configuration.expandAllModelSections,
          orderRequiredPropertiesFirst:
            configuration.orderRequiredPropertiesFirst,
          orderSchemaPropertiesBy: configuration.orderSchemaPropertiesBy,
          documentDownloadType: configuration.documentDownloadType,
        }"
        :xScalarDefaultClient="xScalarDefaultClient"
        @copyAnchorUrl="handleCopyAnchorUrl"
        @intersecting="handleIntersecting"
        @toggleOperation="handleToggleOperation"
        @toggleSchema="handleToggleSchema"
        @toggleTag="handleToggleTag">
        <template #start>
          <slot
            v-bind="referenceSlotProps"
            name="content-start" />
          <ClassicHeader v-if="configuration.layout === 'classic'">
            <div
              v-if="$slots['document-selector']"
              class="w-64 *:!p-0 empty:hidden">
              <slot name="document-selector" />
            </div>
            <SearchButton
              v-if="!configuration.hideSearch"
              class="t-doc__sidebar max-w-64"
              :hideModels="configuration?.hideModels"
              :items="sidebarItems"
              :searchHotKey="configuration.searchHotKey"
              @toggleSidebarItem="
                (id) =>
                  sidebarState.setExpanded(id, !sidebarState.isExpanded(id))
              " />
            <template #dark-mode-toggle>
              <ScalarColorModeToggleIcon
                v-if="!configuration.hideDarkModeToggle"
                class="text-c-2 hover:text-c-1"
                :mode="isDark ? 'dark' : 'light'"
                style="transform: scale(1.4)"
                variant="icon"
                @click="$emit('toggleDarkMode')" />
            </template>
          </ClassicHeader>
        </template>
        <!-- TODO: Remove this; we no longer directly support an inline editor -->
        <template
          v-if="configuration?.isEditable"
          #empty-state>
          <GettingStarted
            :theme="configuration?.theme || 'default'"
            @changeTheme="$emit('changeTheme', $event)"
            @linkSwaggerFile="$emit('linkSwaggerFile')"
            @loadSwaggerFile="$emit('loadSwaggerFile')"
            @updateContent="$emit('updateContent', $event)" />
        </template>
        <template #end>
          <slot
            v-bind="referenceSlotProps"
            name="content-end" />
        </template>
      </Content>
    </main>
    <div
      v-if="$slots.footer"
      class="references-footer">
      <slot
        v-bind="referenceSlotProps"
        name="footer" />
    </div>
    <slot name="client-modal" />
  </div>
  <ScalarToasts />
</template>
<style>
@import '@/style.css';

/** Used to check if css is loaded */
:root {
  --scalar-loaded-api-reference: true;
}
</style>
<style scoped>
/* Configurable Layout Variables */
@layer scalar-config {
  .scalar-api-reference {
    --refs-sidebar-width: var(--scalar-sidebar-width, 0px);
    /* The header height */
    --refs-header-height: calc(
      var(--scalar-custom-header-height) + var(--scalar-header-height, 0px)
    );
    /* The offset of visible references content (minus headers) */
    --refs-viewport-offset: calc(
      var(--refs-header-height, 0px) + var(--refs-content-offset, 0px)
    );
    /* The calculated height of visible references content (minus headers) */
    --refs-viewport-height: calc(
      var(--full-height, 100dvh) - var(--refs-viewport-offset, 0px)
    );
    --refs-content-max-width: var(--scalar-content-max-width, 1540px);
  }

  .scalar-api-reference.references-classic {
    /* Classic layout is wider */
    --refs-content-max-width: var(--scalar-content-max-width, 1420px);
    min-height: 100dvh;
    --refs-sidebar-width: 0;
  }

  /* When the toolbar is present, we need to offset the content */
  .scalar-api-reference:has(.api-reference-toolbar) {
    --refs-content-offset: 48px;
  }
}

/* ----------------------------------------------------- */
/* References Layout */
.references-layout {
  /* Try to fill the container */
  min-height: 100dvh;
  min-width: 100%;
  max-width: 100%;
  flex: 1;

  /*
  Calculated by a resize observer and set in the style attribute
  Falls back to the viewport height
  */
  --full-height: 100dvh;

  /* Grid layout */
  display: grid;
  grid-template-rows: var(--scalar-header-height, 0px) repeat(2, auto);
  grid-template-columns: auto 1fr;
  grid-template-areas:
    'header header'
    'navigation rendered'
    'footer footer';

  background: var(--scalar-background-1);
}

.references-header {
  grid-area: header;
  position: sticky;
  top: var(--scalar-custom-header-height, 0px);
  z-index: 1000;

  height: var(--scalar-header-height, 0px);
}

.references-editor {
  grid-area: editor;
  display: flex;
  min-width: 0;
  background: var(--scalar-background-1);
}

.references-navigation {
  grid-area: navigation;
}

.references-rendered {
  position: relative;
  grid-area: rendered;
  min-width: 0;
  background: var(--scalar-background-1);
}
.scalar-api-reference.references-classic,
.references-classic .references-rendered {
  height: initial !important;
  max-height: initial !important;
}
.references-navigation-list {
  position: sticky;
  top: var(--refs-header-height);
  height: calc(100dvh - var(--refs-header-height));
  background: var(--scalar-sidebar-background-1, var(--scalar-background-1));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Fix the editor in the middle while allowing the rest of the view to scroll */
.references-editor-textarea {
  position: sticky;
  top: var(--refs-header-height);
  height: calc(var(--full-height) - var(--refs-header-height));
  display: flex;
  min-width: 0;
  flex: 1;
}

.references-editable {
  grid-template-columns: var(--refs-sidebar-width) 1fr 1fr;

  grid-template-areas:
    'header header header'
    'navigation editor rendered'
    'footer footer footer';
}
@layer scalar-config {
  .references-sidebar {
    /* Set a default width if references are enabled */
    --refs-sidebar-width: var(--scalar-sidebar-width, 280px);
  }
}

/* Footer */
.references-footer {
  grid-area: footer;
}
/* ----------------------------------------------------- */
/* Responsive / Mobile Layout */

@media (max-width: 1150px) {
  /* Hide rendered view for tablets */
  .references-layout {
    grid-template-columns: var(--refs-sidebar-width) 1fr 0px;
  }
}

@media (max-width: 1000px) {
  /* Stack view on mobile */
  .references-layout {
    grid-template-columns: auto;
    grid-template-rows: var(--scalar-header-height, 0px) 0px auto auto;

    grid-template-areas:
      'header'
      'navigation'
      'rendered'
      'footer';
  }
  .references-editable {
    grid-template-areas:
      'header'
      'navigation'
      'editor';
  }

  .references-navigation,
  .references-rendered {
    max-height: unset;
  }

  .references-rendered {
    position: static;
  }

  .references-navigation {
    display: none;
    z-index: 10;
  }

  .references-sidebar-mobile-open .references-navigation {
    display: block;
    top: var(--refs-header-height);
    height: calc(100dvh - var(--refs-header-height));
    width: 100%;
    position: sticky;
  }

  .references-navigation-list {
    position: absolute;

    /* Offset by 1px to avoid gap */
    top: -1px;

    /* Add a pixel to cover the bottom of the viewport */
    height: calc(var(--full-height) - var(--refs-header-height) + 1px);
    width: 100%;

    border-top: 1px solid var(--scalar-border-color);
    display: flex;
    flex-direction: column;
  }
}
</style>
<style scoped>
/**
* Sidebar CSS for standalone
* TODO: @brynn move this to the sidebar block OR the ApiReferenceStandalone component
* when the new elements are available
*/
@media (max-width: 1000px) {
  .scalar-api-references-standalone-mobile {
    --scalar-header-height: 50px;
  }
}
</style>
<style scoped>
.scalar-api-references-standalone-search {
  display: flex;
  flex-direction: column;
  padding: 12px 12px 6px 12px;
}
.darklight-reference {
  width: 100%;
  margin-top: auto;
}
</style>
