declare module 'vsidian-addon-sdk' {
  export function defineAddonPage(addonId: string, factory: (sdk: import('../types/vendor/shared/addonPage').VsidianAddonPageSdk) => void): void
}
