const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// zustand's "exports" field resolves to an ESM build that uses `import.meta`
// on web (Metro's `browser` condition matches its `import`/`module` export
// before `default`). Metro serves bundles as plain scripts, not ES modules,
// so `import.meta` throws at runtime and the app renders a blank screen.
// Force the CJS build (same one used on native) on every platform.
const { resolveRequest } = config.resolver;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'zustand' || moduleName.startsWith('zustand/')) {
    return context.resolveRequest(
      { ...context, isESMImport: false, unstable_conditionNames: ['require'] },
      moduleName,
      platform
    );
  }
  return resolveRequest
    ? resolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
