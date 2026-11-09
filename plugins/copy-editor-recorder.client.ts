/**
 * @module copy-editor-recorder
 * @description Live copy editor (#59, dev only): installs vue-i18n's `postTranslation` hook that remembers which key
 * rendered which text, before the first render. A client plugin and not `i18n.config.ts`, because that file is also
 * bundled into Nitro, where the build constant is not defined and the code would stay in a production server build.
 * `__COPY_EDITOR__` is false in every build without the tool, and the import then goes with it.
 */
export default defineNuxtPlugin({
  name: 'copy-editor-recorder',
  dependsOn: ['i18n:plugin'],
  async setup(nuxtApp) {
    if (!__COPY_EDITOR__) return
    const { recordTranslation } = await import('~/lib/copy-editor/recorder')
    nuxtApp.$i18n.setPostTranslationHandler((translated, key) => (typeof translated === 'string' ? recordTranslation(translated, key) : translated))
  },
})
