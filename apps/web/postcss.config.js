import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the Tailwind config by absolute path. The single Aegis server may run
// Vite from a different working directory (apps/server), so relying on cwd-based
// config discovery is not safe.
const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: [tailwindcss(path.join(dir, 'tailwind.config.js')), autoprefixer()],
};
