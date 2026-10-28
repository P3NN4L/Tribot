/** Module-level handle to the DSH plugin-manager remote (resolved once). */
let pluginManager: any

export function setPluginManager(handle: unknown): void {
  pluginManager = handle ?? undefined
}

export function getPluginManager(): any | undefined {
  return pluginManager
}
