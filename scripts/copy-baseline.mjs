// Copies the default baseline next to the compiled code, so `flarewall init` finds it in dist/.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/modules/security/baseline', { recursive: true });
copyFileSync('src/modules/security/baseline/default.yaml', 'dist/modules/security/baseline/default.yaml');
