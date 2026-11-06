declare module '#app' {
  interface PageMeta {
    /** `false` hides the global app bar on this route (welcome, styleguide, error-test, the empty index redirect; #470) */
    appNav?: boolean
    /** `false` drops the visible page header where the app bar already names the page (Einstellungen, Papierkorb; #670): the title stays as a screen-reader-only h1 */
    pageHeader?: boolean
    /** `'narrow'`: the sub-page layout centres one 672 px column (Einstellungen, its sub-pages, Papierkorb; #673); default: the full container (Statistik, Notion) */
    pageWidth?: 'narrow' | 'wide'
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    appNav?: boolean
    pageHeader?: boolean
    pageWidth?: 'narrow' | 'wide'
  }
}

export {}
