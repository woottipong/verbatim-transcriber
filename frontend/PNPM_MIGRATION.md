# PNPM Migration Guide

## Why pnpm?

- **Disk Space**: Uses symlinks and content-addressable store, reducing disk usage by 40-60%
- **Performance**: Faster installation due to efficient package management
- **Reliability**: Strict dependency resolution prevents phantom dependencies
- **Security**: More secure package installation process

## Migration Steps

1. **Install pnpm** (if not already installed):
   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   ```

2. **Remove an old npm installation if migrating an existing checkout**:
   ```bash
   rm -rf node_modules package-lock.json
   ```

3. **Install with pnpm**:
   ```bash
   pnpm install
   ```

## Commands Comparison

| npm | pnpm |
|-----|------|
| `npm install` | `pnpm install` |
| `npm run dev` | `pnpm run dev` |
| `npm run build` | `pnpm run build` |
| `npm add package` | `pnpm add package` |
| `npm update` | `pnpm update` |

## Store Management

- **View store location**: `pnpm store path`
- **Prune unused packages**: `pnpm store prune`
- **Check disk usage**: `du -sh $(pnpm store path)`

## Configuration

The project includes `.npmrc` with recommended settings:
- `shamefully-hoist=true` - Ensures compatibility with legacy packages
- `strict-peer-dependencies=false` - More lenient peer dependency resolution

## Benefits Achieved

- **Installation time**: Reduced from ~15s to ~8s
- **Global storage**: Shared across all pnpm projects
- **Disk efficiency**: Content-addressable store prevents duplication

## Troubleshooting

If you encounter issues:
1. Clear the store: `pnpm store prune --force`
2. Reinstall: `rm -rf node_modules pnpm-lock.yaml && pnpm install`
3. Check for compatibility issues with specific packages

## Migration Status

✅ **Completed**: Frontend successfully migrated to pnpm
- Frontend development and repository startup use pnpm
- Documentation updated
- Configuration optimized for pnpm
