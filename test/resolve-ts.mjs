export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier)) {
    try { return await next(specifier + ".ts", context); } catch { /* jatuh ke default */ }
  }
  return next(specifier, context);
}
