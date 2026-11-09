/**
 * @module paletteExtensions
 * @description A registry of extra command-palette groups that code outside the palette can add (#59: the dev-only
 * copy editor registers its one command here, so the palette itself carries no string of it). Empty unless something
 * registers; the palette appends the groups after its own.
 * @responsibility Register, unregister and list extension groups. No UI.
 */
import { shallowRef } from 'vue'
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

type Provider = () => CommandPaletteGroup<CommandPaletteItem>[]

const providers = shallowRef<Provider[]>([])

/** Adds a provider; returns the function that removes it again. */
export function registerPaletteExtension(provider: Provider): () => void {
  providers.value = [...providers.value, provider]
  return () => { providers.value = providers.value.filter(candidate => candidate !== provider) }
}

export const paletteExtensionGroups = (): CommandPaletteGroup<CommandPaletteItem>[] => providers.value.flatMap(provider => provider())
