import { ICONS } from './lib/icons'

export default defineAppConfig({
  ui: {
    fonts: {
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
      display: "var(--font-display)",
    },
    colors: {
      primary: 'custom-ink',
      secondary: 'custom-orange',
      success: 'custom-teal',
      info: 'sky',
      warning: 'custom-orange',
      error: 'custom-raspberry',
      neutral: 'stone',
    },
    radius: {
      sm: '0.25rem',
      md: '0.5rem', // 8px as agreed
      lg: '0.75rem',
      xl: '1rem'
    },
    // Nuxt UI defaults to Lucide, which is not installed: those icons would be fetched from
    // api.iconify.design at runtime (blocked by the desktop CSP, ADR 012). Every Nuxt UI default key
    // is mapped (tests/config/nuxt-ui-icons.test.ts guards it). Phosphor is the
    // design system's set and is bundled into the client (nuxt.config.ts `icon.clientBundle`).
    icons: {
      arrowDown: 'i-ph-arrow-down',
      arrowLeft: 'i-ph-arrow-left',
      arrowRight: 'i-ph-arrow-right',
      arrowUp: 'i-ph-arrow-up',
      caution: 'i-ph-warning-circle',
      check: 'i-ph-check',
      chevronDoubleLeft: 'i-ph-caret-double-left',
      chevronDoubleRight: 'i-ph-caret-double-right',
      chevronDown: 'i-ph-caret-down',
      chevronLeft: 'i-ph-caret-left',
      chevronRight: 'i-ph-caret-right',
      chevronUp: 'i-ph-caret-up',
      close: ICONS.close,
      copy: 'i-ph-copy',
      copyCheck: 'i-ph-check-square',
      dark: 'i-ph-moon',
      drag: 'i-ph-dots-six-vertical',
      ellipsis: 'i-ph-dots-three',
      error: 'i-ph-x-circle',
      external: ICONS.external,
      eye: 'i-ph-eye',
      eyeOff: 'i-ph-eye-slash',
      file: 'i-ph-file',
      folder: 'i-ph-folder',
      folderOpen: 'i-ph-folder-open',
      hash: 'i-ph-hash',
      info: 'i-ph-info',
      light: 'i-ph-sun',
      loading: 'i-ph-circle-notch',
      menu: 'i-ph-list',
      minus: 'i-ph-minus',
      panelClose: 'i-ph-sidebar-simple',
      panelOpen: 'i-ph-sidebar-simple',
      plus: 'i-ph-plus',
      reload: 'i-ph-arrow-counter-clockwise',
      search: 'i-ph-magnifying-glass',
      star: 'i-ph-star',
      stop: 'i-ph-square',
      success: 'i-ph-check-circle',
      system: 'i-ph-monitor',
      tip: 'i-ph-lightbulb',
      upload: 'i-ph-upload-simple',
      warning: 'i-ph-warning'
    },
    // Every overlay darkens the page by the shared 12% scrim (DESIGN.md Overlays);
    // only the task sheet opts out (transparent overlay, board-side spotlight).
    modal: {
      slots: {
        // Default width is the "md" step of the shared scale (utils/modalSizes.ts);
        // UModal's own divide-y draws the header/body/footer separators, softened
        // to half strength so sections read as zones, not hard splits.
        content: 'bg-elevated ring-1 ring-default divide-default/50 sm:max-w-lg',
        header: 'px-6 py-4',
        // Every modal title is the display role (Figtree 600, weight explicit so Nuxt UI title classes cannot override) (DESIGN.md Headline); custom
        // in-body titles (task detail) must use `font-display` too.
        title: 'font-display text-lg font-semibold tracking-tight',
        // Standard footer chrome: actions right-aligned. Wizards that need a
        // two-zone layout put a `flex w-full justify-between` div inside.
        footer: 'flex items-center justify-end gap-2 px-6 py-4',
      },
      // The default scrim is the `overlay` variant (`bg-elevated/75`), which beats a slot override.
      // This variant must win over Nuxt UI's default bg-elevated/75; tests/e2e/overlay-scrim.spec.ts guards it.
      variants: {
        overlay: {
          true: { overlay: 'bg-(--overlay-scrim)' },
        },
        // Nuxt UI's `fullscreen: false` variant carries `shadow-lg` and is merged after slot overrides,
        // so the modal elevation (#126) has to override it here, not in `slots.content`.
        fullscreen: {
          false: { content: 'shadow-(--shadow-overlay)' },
        },
      },
    },
    // Task sheet sits above the app bar (z-40); popovers and tooltips opened inside it go above the sheet, toasts above both.
    slideover: {
      slots: {
        overlay: 'z-2100',
        content: 'z-2100 bg-elevated md:shadow-(--shadow-sheet)',
        title: 'font-display text-lg font-semibold tracking-tight',
      }
    },
    drawer: {
      slots: {
        overlay: 'z-2100 bg-(--overlay-scrim)',
        content: 'z-2100 bg-elevated',
        title: 'font-display text-lg font-semibold tracking-tight',
      }
    },
    popover: {
      slots: {
        content: 'z-2200'
      }
    },
    tooltip: {
      slots: {
        content: 'z-2200'
      }
    },
    // Toasts (e.g. a failed save) must stay visible above the open task sheet.
    // `kando-toaster` lifts them above the phone app bar (assets/css/mobile-nav.css).
    toaster: {
      slots: {
        viewport: 'z-2300 kando-toaster'
      }
    },
    // Action buttons (undo for delete, archive, completion) get a 44px target on touch (mobile-nav.css).
    toast: {
      slots: {
        actions: 'kando-toast-actions'
      }
    },
    dropdownMenu: {
      slots: {
        content: 'z-2200 min-w-40',
        item: 'text-sm cursor-pointer'
      }
    },
    collapsible: {
      slots: {
        root: '',
        content: 'data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up overflow-hidden'
      }
    },
    // Central disabled styling for form inputs
    // Nuxt UI default only applies opacity-75, not a distinct background
    // This override adds a muted background to clearly distinguish disabled inputs
    // Placeholders step down through `text-muted`, not Nuxt UI's `text-dimmed` (2.5:1 on the sheet; Receding Text
    // Rule, #646). A disabled field's placeholder keeps `text-dimmed` (Pencil, DESIGN.md).
    input: {
      slots: {
        base: [
          'placeholder:text-muted disabled:placeholder:text-dimmed disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted'
        ]
      }
    },
    select: {
      slots: {
        base: [
          'disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted'
        ]
      }
    },
    selectMenu: {
      slots: {
        content: 'z-2200 min-w-40'
      },
      variants: {
        // Value-as-text trigger of the task sheet's property rows (#161): body text with the dotted
        // rule on hover/focus (task-detail.css), no fill, no caret, no icons. 44px hit area on touch.
        variant: {
          property: {
            value: 'pointer-events-none',
            placeholder: 'text-muted',
            leading: 'hidden',
            trailing: 'hidden'
          }
        }
      },
      // Compound variants merge after the size classes, so the property trigger wins over `size`.
      compoundVariants: [
        {
          variant: 'property',
          class: {
            base: 'task-property-value -ms-2 min-h-8 cursor-pointer rounded-sm px-2 py-0 text-sm text-default max-md:min-h-11 md:text-sm'
          }
        }
      ]
    },
    textarea: {
      slots: {
        base: [
          'placeholder:text-muted disabled:placeholder:text-dimmed disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted'
        ]
      }
    },
    // The button ladder (#552, DESIGN.md "Buttons"): `md` is the default size and siblings in a footer or row stay at
    // it; the one primary of a surface sets `size="lg"`; rows, cards and in-card actions set `sm`; `xs` only sits
    // inside text. On a phone every button is 44 px high (`lg` 48), icon-only ones 44 wide, so no surface applies
    // `.touch-target` by hand (tests/config/button-ladder.test.ts keeps call sites on the ladder).
    button: {
      defaultVariants: {
        size: 'md'
      },
      slots: {
        base: 'max-md:min-h-11'
      },
      variants: {
        size: {
          lg: { base: 'max-md:min-h-12' }
        }
      },
      compoundVariants: [
        // `xs` is a control inside text or one with its own hit area (the stack header close): no floor
        { size: 'xs', class: 'max-md:min-h-0' },
        // Icon-only buttons: a 44 x 44 target with the icon centred
        { square: true, class: 'max-md:min-w-11 max-md:justify-center' },
        // Solid offset ring instead of the 25% halo: WCAG 2.4.11 / 2.4.13 (>= 3:1 vs page, >= 2px)
        {
          color: 'primary',
          variant: 'solid',
          // Deep Ink (button-primary-hover) on hover/press: the base primary/75 blend measures 3.33:1 with white text (#251); enabled: keeps disabled states flat
          class: 'enabled:hover:bg-primary-600 enabled:active:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        },
        // DESIGN.md button-soft: Deep Ink text on Ink Wash; plain primary text on the tint measures 4.41:1 (#152)
        {
          color: 'primary',
          variant: 'soft',
          class: 'text-primary-600'
        },
        // Same for error: the base raspberry-500 text on its 10% tint measures ~4.0:1 (#594); the 700 step is 6.2:1 on the tint
        {
          color: 'error',
          variant: 'soft',
          class: 'text-error-700'
        }
      ]
    },
    // One in-page tab look (#557): the app bar's neutral pill (DESIGN.md "Tabs"): grey track, the active tab a raised
    // white chip, no ink fill. Nuxt UI's neutral pill fills the active tab with `bg-inverted`; the second class on the
    // `before:` selector covers a list without an indicator. Unselected text stays `text-muted` from the base slot.
    tabs: {
      compoundVariants: [
        // Solid offset ring, not Nuxt UI's 25% halo (~1.9:1 on the grey track): DESIGN.md "Focus", WCAG 2.4.11.
        // A compound variant, because Nuxt UI's own neutral compounds carry `focus-visible:outline-3`.
        {
          color: 'neutral',
          class: {
            trigger: 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
          }
        },
        {
          color: 'neutral',
          variant: 'pill',
          class: {
            list: 'bg-muted',
            indicator: 'bg-default',
            trigger: [
              'data-[state=active]:text-highlighted',
              'in-[[data-slot=list]:not(:has([data-slot=indicator]))]:data-[state=active]:before:bg-default'
            ]
          }
        }
      ],
      defaultVariants: {
        color: 'neutral'
      }
    },
    alert: {
      compoundVariants: [
        // Subtle warning/info: the default orange text on the warning/10 wash measures ~2.6:1 (#353); warning-800 meets AA, and the description keeps full opacity
        {
          color: 'warning',
          variant: 'subtle',
          class: {
            root: 'text-warning-800',
            description: 'opacity-100'
          }
        },
        // Same for subtle info: sky-500 on the info/10 wash is below AA (#368)
        {
          color: 'info',
          variant: 'subtle',
          class: {
            root: 'text-info-800',
            description: 'opacity-100'
          }
        }
      ]
    },
    badge: {
      variants: {
        size: {
          // rem instead of Nuxt UI's px chip sizes so chips follow text zoom (WCAG 1.4.4, #66); sm is the DESIGN.md label step (11px, above the detector's floor)
          xs: { base: 'text-[0.5rem]/3' },
          sm: { base: 'text-[0.6875rem]/3' }
        }
      },
      compoundVariants: [
        {
          color: 'neutral',
          variant: 'soft',
          class: 'text-default bg-accented'
        }
      ]
    },
    // Off state of a switch (#683): the stock soft-grey track (neutral-200) is 1.1:1 on the page wash, under the 3:1 of WCAG 1.4.11.
    // An outlined white track with a muted-ink thumb (--ui-text-muted, 5.5:1 on the page wash) reads as off; on stays the filled primary track.
    switch: {
      slots: {
        base: 'data-[state=unchecked]:bg-default data-[state=unchecked]:border-(--ui-text-muted)',
        thumb: 'data-[state=unchecked]:bg-(--ui-text-muted)'
      }
    },
    card: {
      variants: {
        variant: {
          task: {
            root: 'bg-elevated',
            body: 'px-2.5 pt-2 pb-1 sm:px-3 sm:pt-3 sm:pb-1',
            footer: 'px-2.5 pt-1 pb-2 sm:px-3 sm:pt-2 sm:pb-3',
          }
        }
      }
    }
  },
  featureFlags: {
    notionDataSourceSelection: false,
    openColumnAddButton: true,
  },
})