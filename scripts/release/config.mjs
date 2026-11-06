/** Shared constants of the release scripts (#225). */

/** Must equal `PLACEHOLDER_PUBKEY` in `src-tauri/src/updater.rs`. */
export const PLACEHOLDER_PUBKEY = 'REPLACE_WITH_UPDATER_PUBLIC_KEY'

/** Keychain items (generic passwords) the script reads the updater signing key and its password from. */
export const KEYCHAIN_KEY_SERVICE = 'kan-do-updater-key'
export const KEYCHAIN_PASSWORD_SERVICE = 'kan-do-updater-key-password'
